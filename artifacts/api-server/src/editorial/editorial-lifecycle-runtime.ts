import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sql, desc } from "drizzle-orm";
import { db, pool, valoContentVersions } from "@workspace/db";
import { digest, evaluatePublication, publicationSchema, sha256 } from "@workspace/valo-core";
import {
  validateOperationalVersionInTransaction,
  publishOperationalVersion,
  withdrawOperationalVersion,
  type ReleaseAttestations,
} from "./publication-publisher";
import { getPublicationArtifact } from "./publication-artifacts";
import { publicationWorkspaceRoot } from "./operational-policy";
import {
  liveReleasedVersions,
  releasedCatalogue,
  releasedTemplate,
  readReleasedMaster,
  createReleasedTemplateDraft,
} from "../lib/valo-released-content";
import { getDocument } from "../lib/valo-store";
import { lockSourceState, sourceTargetAllowed } from "../lib/valo-source-state";
import {
  recordSourceImpact,
  processSourceDependencyJob,
  processSourceImpact,
} from "../lib/valo-source-corrections";
import { scheduleSourceChecks, claimSourceCheck, completeSourceCheck } from "../lib/valo-source-monitor";
import { readSourceText } from "./source-storage";
import { readEditorialRun } from "./run-storage";
import { assertBlindReviewInputs } from "./operational-review-contract";
import { releasedRegistry } from "../lib/valo-assessments";
import { assertLifecycleRunDatabase } from "./editorial-lifecycle-sandbox";
import type { LifecycleResult } from "./editorial-lifecycle-dispatch";
import { workspaceActorFromRecord } from "../platform/workspace-context";
import { environment, setting } from "../platform/settings";

class Prerequisite extends Error {}
const ROLLBACK = Symbol("read-only publisher validation");
async function validate(id: string, time?: Date) {
  let result: Awaited<ReturnType<typeof validateOperationalVersionInTransaction>> | undefined;
  try {
    await db.transaction(async (tx) => {
      result = await validateOperationalVersionInTransaction(tx, id, time);
      throw ROLLBACK;
    });
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  }
  assert.ok(result);
  return result;
}
async function genuineBaseline(requireSources = false) {
  const rows = await db
    .select()
    .from(valoContentVersions)
    .orderBy(desc(valoContentVersions.createdAt))
    .limit(100);
  for (const row of rows) {
    const parsed = publicationSchema.safeParse(row.bundle);
    if (
      !parsed.success ||
      !["candidate", "published"].includes(row.status) ||
      evaluatePublication(parsed.data).decision !== "eligible" ||
      (requireSources && !parsed.data.sources.length)
    )
      continue;
    try {
      await validate(row.id);
      return { row, bundle: parsed.data };
    } catch {
      /* Missing or stale retained bytes cannot satisfy admission. */
    }
  }
  throw new Prerequisite(
    requireSources
      ? "GENUINE_ELIGIBLE_SOURCE_BOUND_BASELINE_UNAVAILABLE"
      : "GENUINE_ELIGIBLE_RETAINED_BASELINE_UNAVAILABLE",
  );
}
async function rejectedMutation(statement: ReturnType<typeof sql>) {
  let reason = "";
  try {
    await db.transaction(async (tx) => {
      await tx.execute(statement);
      throw Error("MUTATION_NOT_REJECTED");
    });
  } catch (error) {
    let e: unknown = error;
    for (let n = 0; n < 5 && e; n++) {
      const item = e as { message?: string; cause?: unknown };
      if (item.message?.includes("immutable") || item.message?.includes("append-only")) {
        reason = item.message;
        break;
      }
      e = item.cause;
    }
  }
  assert.ok(reason, "Exact retained evidence immutability must reject the attempted change");
  return reason;
}
async function sourceRows(id: string) {
  return (
    await db.execute(sql`select b.*,s.text_checksum,s.raw_object_key,s.text_object_key
 from valo_source_release_bindings b join valo_source_snapshots s on s.id=b.snapshot_id where b.target_kind='content' and b.target_id=${id}::uuid`)
  ).rows;
}
async function ensurePublished(id: string) {
  return publishOperationalVersion(id);
}
async function audit(id: string) {
  return (
    await db.execute(
      sql`select action,actor,reason from valo_publication_audit where version_id=${id}::uuid order by created_at,id`,
    )
  ).rows;
}
async function syntheticOwner() {
  const actor = { workspaceId: randomUUID(), identityId: `synthetic-editorial-lifecycle-${randomUUID()}` };
  await db.execute(
    sql`insert into valo_workspaces(id,owner_identity_id) values(${actor.workspaceId}::uuid,${actor.identityId})`,
  );
  await db.execute(
    sql`insert into valo_memberships(id,workspace_id,identity_id,role,active) values(${randomUUID()}::uuid,${actor.workspaceId}::uuid,${actor.identityId},'owner','yes')`,
  );
  return actor;
}
async function pendingLock() {
  const until = Date.now() + 5000;
  while (Date.now() < until) {
    const rows = (
      await db.execute(
        sql`select count(*) n from pg_locks where locktype='advisory' and objid=7502601 and not granted`,
      )
    ).rows;
    if (Number(rows[0]?.n) >= 2) return;
    await new Promise<void>((r) => setImmediate(r));
  }
  throw Error("EXPECTED_PUBLICATION_LOCK_WAIT_NOT_OBSERVED");
}
async function sourceChangeCase() {
  if (
    (await db.execute(sql`select id from valo_source_impacts where phase<>'complete' limit 1`)).rows.length ||
    (await db.execute(sql`select id from valo_source_dependency_jobs where status='pending' limit 1`)).rows
      .length ||
    (await db.execute(sql`select id from valo_source_check_jobs where status='running' limit 1`)).rows.length
  )
    throw new Prerequisite("ISOLATED_BASELINE_HAS_UNSETTLED_SOURCE_WORK");
  const rules = (
    await db.execute(
      sql`select * from valo_rule_releases where status='published' order by published_at desc limit 100`,
    )
  ).rows;
  const current = await releasedRegistry(db, new Date());
  let selected: (typeof rules)[number] | undefined;
  for (const r of rules) {
    const p = publicationSchema.safeParse(r.publication_bundle);
    if (
      !p.success ||
      !current.rules.some((rule) => rule.id === r.rule_id && rule.version === r.version) ||
      !p.data.sources.length
    )
      continue;
    let genuine = true;
    for (const review of p.data.reviews) {
      const runs = (
        await db.execute(sql`select * from valo_editorial_runs where provider_response_id=${review.runId} and role=${review.role}
    and status='succeeded' and candidate_hash=${p.data.candidate.hash} and model=${review.model} and prompt_version=${review.promptVersion}`)
      ).rows;
      if (runs.length !== 1 || !runs[0]!.output_hash) {
        genuine = false;
        break;
      }
      try {
        const saved = await readEditorialRun(String(runs[0]!.id), String(runs[0]!.output_hash));
        assertBlindReviewInputs(saved.input);
        const output = saved.output as { verdict?: string; findings?: unknown[] };
        if (
          saved.providerResponseId !== review.runId ||
          saved.candidateHash !== p.data.candidate.hash ||
          saved.model !== review.model ||
          saved.role !== review.role ||
          output.verdict !== "pass" ||
          digest(output.findings) !== digest(review.findings)
        ) {
          genuine = false;
          break;
        }
      } catch {
        genuine = false;
        break;
      }
    }
    if (genuine && p.data.reviews.length === 2) {
      selected = r;
      break;
    }
  }
  if (!selected) throw new Prerequisite("GENUINE_CURRENT_SOURCE_BOUND_RULE_REQUIRED");
  const b = publicationSchema.parse(selected.publication_bundle),
    ruleId = String(selected.id),
    ruleKey = String(selected.rule_id),
    version = Number(selected.version);
  const bindings = (
    await db.execute(sql`select b.*,s.text_checksum from valo_source_release_bindings b join valo_source_snapshots s on s.id=b.snapshot_id
  where b.target_kind='rule' and b.target_id=${ruleId}::uuid`)
  ).rows;
  let pair: { binding: (typeof bindings)[number]; next: Record<string, unknown> } | undefined;
  for (const binding of bindings) {
    const next = (
      await db.execute(sql`select * from valo_source_snapshots where source_id=${String(binding.source_id)} and status='retrieved_unreviewed'
   and raw_checksum<>${String(binding.raw_hash)} and raw_object_key is not null and text_object_key is not null order by fetched_at desc limit 5`)
    ).rows;
    for (const snapshot of next) {
      try {
        await readSourceText(String(snapshot.id), String(snapshot.text_checksum));
        pair = { binding, next: snapshot };
        break;
      } catch {
        // Expected: this retained text is unreadable or fails its checksum; try the next snapshot.
      }
    }
    if (pair) break;
  }
  if (!pair) throw new Prerequisite("SECOND_RETAINED_CHANGED_OFFICIAL_SNAPSHOT_REQUIRED");
  const actors = await Promise.all([syntheticOwner(), syntheticOwner(), syntheticOwner()]),
    assessments: string[] = [],
    tasks: string[] = [];
  for (let n = 0; n < 3; n++) {
    const actor = actors[n]!,
      assessmentId = randomUUID(),
      taskId = randomUUID(),
      key = n < 2 ? ruleKey : `unrelated-${randomUUID()}`;
    const result = { items: [{ ruleId: key, ruleVersion: version, requirementVersionId: b.candidate.id }] };
    assessments.push(assessmentId);
    tasks.push(taskId);
    await db.execute(sql`insert into valo_assessments(id,workspace_id,facts,facts_hash,result,result_hash,ruleset_version,as_of_date,consent_version,actor_id)
   values(${assessmentId}::uuid,${actor.workspaceId}::uuid,'{}',${digest({})},${JSON.stringify(result)}::jsonb,${digest(result)},'isolated-genuine-lifecycle',current_date,'synthetic-explicit-opt-in',${actor.identityId})`);
    await db.execute(sql`insert into valo_tasks(id,workspace_id,title,notes,assessment_id,rule_id,rule_version,actor_id) values
   (${taskId}::uuid,${actor.workspaceId}::uuid,'Isolated lifecycle task','Synthetic user fixture',${assessmentId}::uuid,${key},${version},${actor.identityId})`);
    await db.execute(sql`insert into valo_reminder_preferences(workspace_id,enabled,offsets,revision,consent_version,actor_id)
   values(${actor.workspaceId}::uuid,true,'[0]',1,'synthetic-explicit-opt-in',${actor.identityId})`);
    await db.execute(sql`insert into valo_reminder_outbox(id,workspace_id,task_id,idempotency_key,scheduled_at,status)
   values(${randomUUID()}::uuid,${actor.workspaceId}::uuid,${taskId}::uuid,${taskId},now(),'pending')`);
  }
  const before = (
    await db.execute(
      sql`select id,facts_hash,result_hash,result from valo_assessments where id in (${sql.join(
        assessments.map((x) => sql`${x}::uuid`),
        sql`,`,
      )}) order by id`,
    )
  ).rows;
  const now = new Date();
  await db.execute(
    sql`update valo_source_watches set next_check_at=${now} where source_id=${String(pair.binding.source_id)}`,
  );
  await scheduleSourceChecks(now);
  // Reorder only this isolated fixture's newly scheduled job. Never manufacture
  // outcomes for unrelated queued captures merely to reach our own test target.
  await db.execute(sql`update valo_source_check_jobs set created_at='1970-01-01' where source_id=${String(pair.binding.source_id)}
  and day=${now.toISOString().slice(0, 10)}::date and status='pending'`);
  const claim = await claimSourceCheck(now);
  if (!claim || claim.source_id !== pair.binding.source_id)
    throw new Prerequisite("OWN_SOURCE_CHECK_COULD_NOT_BE_CLAIMED");
  assert.equal(await completeSourceCheck(claim, String(pair.next.id), now), true);
  assert.equal(
    await sourceTargetAllowed(db, "rule", ruleId, b, now),
    false,
    "Current read must stop before fan-out",
  );
  let work = 0;
  while (work++ < 200 && ((await processSourceDependencyJob()) || (await processSourceImpact()))) {}
  if (work >= 200) throw Error("LIFECYCLE_CORRECTION_FANOUT_LIMIT");
  const taskRows = (
    await db.execute(
      sql`select id,needs_review from valo_tasks where id in (${sql.join(
        tasks.map((x) => sql`${x}::uuid`),
        sql`,`,
      )})`,
    )
  ).rows;
  assert.equal(taskRows.find((x) => x.id === tasks[0])?.needs_review, true);
  assert.equal(taskRows.find((x) => x.id === tasks[1])?.needs_review, true);
  assert.equal(taskRows.find((x) => x.id === tasks[2])?.needs_review, false);
  assert.deepEqual(
    (
      await db.execute(
        sql`select id,facts_hash,result_hash,result from valo_assessments where id in (${sql.join(
          assessments.map((x) => sql`${x}::uuid`),
          sql`,`,
        )}) order by id`,
      )
    ).rows,
    before,
  );
  assert.equal(
    Number(
      (
        await db.execute(
          sql`select count(*) n from valo_reminder_outbox where task_id in (${tasks[0]!}::uuid,${tasks[1]!}::uuid) and status='pending'`,
        )
      ).rows[0]?.n,
    ),
    0,
  );
  const notices = (
    await db.execute(
      sql`select workspace_id,entity_kind,entity_id from valo_correction_notices where workspace_id in (${sql.join(
        actors.map((x) => sql`${x.workspaceId}::uuid`),
        sql`,`,
      )})`,
    )
  ).rows;
  assert.ok(notices.some((x) => x.workspace_id === actors[0]!.workspaceId));
  assert.ok(notices.some((x) => x.workspace_id === actors[1]!.workspaceId));
  assert.ok(!notices.some((x) => x.workspace_id === actors[2]!.workspaceId));
  return {
    baselineId: ruleId,
    oldSnapshotId: pair.binding.snapshot_id,
    newSnapshotId: pair.next.id,
    currentRuleDeniedBeforeFanout: true,
    historyPreserved: true,
    affectedWorkspaces: 2,
    unrelatedWorkspacesNotNotified: 1,
    noticeDelivery: "saved_in_authenticated_workspace",
    externalMessages: 0,
  };
}

export async function runEditorialLifecycle(caseId: string, runId: string): Promise<LifecycleResult> {
  const common = { formalCaseAccepted: false as const, actualProviderCalls: 0 as const };
  assertLifecycleRunDatabase(
    setting("DATABASE_URL"),
    (await pool.query("select current_database() as name")).rows[0].name,
  );
  try {
    if (caseId === "EVAL-EDP-C057")
      return { ...common, status: "control_pass", boundaryEvidence: await sourceChangeCase() };
    const { row, bundle } = await genuineBaseline(caseId === "EVAL-EDP-C047"),
      a = row.attestations as ReleaseAttestations;
    const evidence: Record<string, unknown> = {
      evaluationRunId: runId,
      baselineId: row.id,
      baselineCandidateHash: row.candidateHash,
      baselineBundleHash: digest(bundle),
      manifestHash: digest(bundle.manifest),
      genuinePublisherValidationPassed: true,
    };
    switch (caseId) {
      case "EVAL-EDP-C046": {
        const changed = structuredClone(bundle);
        changed.candidate.body += "\nUnreviewed lifecycle mutation";
        evidence.denial = await rejectedMutation(
          sql`update valo_content_versions set bundle=${JSON.stringify(changed)}::jsonb where id=${row.id}::uuid`,
        );
        await validate(row.id);
        evidence.originalEvidenceUnchanged = true;
        break;
      }
      case "EVAL-EDP-C047": {
        await ensurePublished(row.id);
        const bindings = await sourceRows(row.id);
        if (!bindings.length) throw new Prerequisite("RETAINED_SOURCE_BINDING_REQUIRED");
        const selected = bindings[0]!;
        evidence.immutabilityDenial = await rejectedMutation(
          sql`update valo_source_snapshots set raw_checksum=${sha256("controlled corrupt replacement")} where id=${String(selected.snapshot_id)}::uuid`,
        );
        await db.execute(
          sql`update valo_source_watches set failure_code='ISOLATED_LIFECYCLE_CHANGED_SOURCE' where source_id=${String(selected.source_id)}`,
        );
        await assert.rejects(
          validate(row.id),
          /SOURCE_CURRENT_CAPTURE_REQUIRED|SOURCE_RELEASE_CURRENTNESS_HELD/,
        );
        evidence.originalSnapshotPreserved = true;
        evidence.changedCurrentnessDenied = true;
        break;
      }
      case "EVAL-EDP-C048": {
        const cwd = process.cwd(),
          root = publicationWorkspaceRoot(),
          temp = await mkdtemp(join(tmpdir(), "valo-policy-lifecycle-"));
        try {
          for (const path of [
            "docs/specification/master-execution-prompt.txt",
            "docs/valo/policies/operational-publication-authority.md",
          ]) {
            await mkdir(dirname(join(temp, path)), { recursive: true });
            await copyFile(join(root, path), join(temp, path));
          }
          await writeFile(
            join(temp, "docs/valo/policies/operational-publication-restrictions.json"),
            JSON.stringify({
              version: "isolated-lifecycle-scope-reduction",
              reason:
                "Controlled isolated evaluation narrows one existing permitted class; this is not a new production approval.",
              excludedClasses: [bundle.candidate.contentClass],
            }),
          );
          process.chdir(temp);
          await assert.rejects(validate(row.id), /POLICY_NOT_TRUSTED/);
          evidence.narrowedClass = bundle.candidate.contentClass;
          evidence.stalePolicyDenied = true;
        } finally {
          process.chdir(cwd);
          await rm(temp, { recursive: true, force: true });
        }
        break;
      }
      case "EVAL-EDP-C049": {
        const changed = structuredClone(bundle);
        changed.reviews[0]!.verdict = "hold";
        evidence.denial = await rejectedMutation(
          sql`update valo_content_versions set bundle=${JSON.stringify(changed)}::jsonb where id=${row.id}::uuid`,
        );
        await assert.rejects(
          getPublicationArtifact({ ...a.reviews[0]!, hash: "0".repeat(64) }),
          /HASH_MISMATCH/,
        );
        evidence.alteredReviewBytesRejected = true;
        break;
      }
      case "EVAL-EDP-C050": {
        await assert.rejects(
          getPublicationArtifact({ ...a.exports.pdf, hash: "0".repeat(64) }),
          /HASH_MISMATCH/,
        );
        const altered = structuredClone(a);
        altered.exports.pdf.hash = "0".repeat(64);
        evidence.denial = await rejectedMutation(
          sql`update valo_content_versions set attestations=${JSON.stringify(altered)}::jsonb where id=${row.id}::uuid`,
        );
        evidence.uninspectedExportRejected = true;
        break;
      }
      case "EVAL-EDP-C055": {
        const realClock = new Date(),
          expired = new Date(Math.max(+realClock, +row.reviewBy) + 1);
        await assert.rejects(validate(row.id, expired), /STALE_RELEASE|PUBLICATION_HELD/);
        evidence.realClock = realClock.toISOString();
        evidence.testClock = expired.toISOString();
        evidence.clockDirection = "forward_only";
        break;
      }
      case "EVAL-EDP-C056": {
        await ensurePublished(row.id);
        const actor = await syntheticOwner();
        let original: Awaited<ReturnType<typeof createReleasedTemplateDraft>>,
          file: Awaited<ReturnType<typeof readReleasedMaster>>;
        try {
          original = await createReleasedTemplateDraft(workspaceActorFromRecord(actor), row.id);
          file = await readReleasedMaster(row.id, "pdf", workspaceActorFromRecord(actor));
        } catch {
          throw new Prerequisite("GENUINE_ELIGIBLE_FREE_OR_OWNED_TEMPLATE_REQUIRED");
        }
        const folder = await mkdtemp(join(tmpdir(), "valo-owned-file-")),
          path = join(folder, "customer-saved.pdf");
        try {
          await writeFile(path, file.bytes);
          const beforeHash = sha256(await readFile(path));
          assert.ok((await liveReleasedVersions()).some((x) => x.id === row.id));
          await withdrawOperationalVersion(
            row.id,
            "Isolated original-case material defect exercise; native release unchanged.",
          );
          assert.ok(!(await liveReleasedVersions()).some((x) => x.id === row.id));
          assert.ok(!(await releasedCatalogue({ q: row.slug })).items.some((x) => x.id === row.id));
          await assert.rejects(releasedTemplate(row.slug), /withdrawn|unavailable/i);
          await assert.rejects(
            readReleasedMaster(row.id, "pdf", workspaceActorFromRecord(actor)),
            /withdrawn|expired|unavailable/i,
          );
          assert.deepEqual(await getDocument(workspaceActorFromRecord(actor), original.id), original);
          assert.equal(sha256(await readFile(path)), beforeHash);
          evidence.savedDraftAndDownloadedFileUnchanged = true;
          evidence.discoveryAndNewDownloadsStopped = true;
          evidence.audit = await audit(row.id);
        } finally {
          await rm(folder, { recursive: true, force: true });
        }
        break;
      }
      case "EVAL-EDP-C058": {
        if (row.status !== "candidate")
          throw new Prerequisite("GENUINE_ELIGIBLE_UNPUBLISHED_CRASH_BASELINE_REQUIRED");
        const child = fork(
          fileURLToPath(new URL("../scripts/editorial-lifecycle-release-child.ts", import.meta.url)),
          [row.id],
          {
            execArgv: ["--import", import.meta.resolve("tsx")],
            env: environment(),
            stdio: ["ignore", "ignore", "ignore", "ipc"],
          },
        );
        try {
          const marker = await new Promise<{ phase: string }>((resolve, reject) => {
            const timer = setTimeout(() => reject(Error("LIFECYCLE_COMMIT_MARKER_TIMEOUT")), 45000);
            child.once("message", (m) => {
              clearTimeout(timer);
              resolve(m as { phase: string });
            });
            child.once("error", (e) => {
              clearTimeout(timer);
              reject(e);
            });
          });
          assert.equal(marker.phase, "committed_before_application_acknowledgement");
          child.kill("SIGKILL");
          const exit = await once(child, "exit");
          assert.equal(exit[1], "SIGKILL");
          const retry = await publishOperationalVersion(row.id);
          assert.equal(retry.idempotent, true);
          const records = await audit(row.id);
          assert.equal(records.filter((x) => x.action === "published").length, 1);
          evidence.realProcessDeath = "SIGKILL";
          evidence.retry = retry;
          evidence.audit = records;
        } finally {
          if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        }
        break;
      }
      case "EVAL-EDP-C059": {
        let held!: () => void, commit!: () => void;
        const ready = new Promise<void>((r) => (held = r)),
          release = new Promise<void>((r) => (commit = r));
        const hold = db.transaction(async (tx) => {
          await lockSourceState(tx, true);
          await recordSourceImpact(tx, {
            kind: "content",
            id: row.id,
            reason: "Isolated race introduced mandatory invalidation.",
            actor: "synthetic-editorial-lifecycle",
            dedupe: `lifecycle:${runId}`,
          });
          held();
          await release;
        });
        await ready;
        const attempts = [publishOperationalVersion(row.id), publishOperationalVersion(row.id)].map((p) =>
          p.then(
            () => ({ published: true }),
            () => ({ published: false }),
          ),
        );
        try {
          await pendingLock();
        } finally {
          commit();
        }
        await hold;
        assert.deepEqual(await Promise.all(attempts), [{ published: false }, { published: false }]);
        assert.ok(!(await liveReleasedVersions()).some((x) => x.id === row.id));
        await assert.rejects(publishOperationalVersion(row.id), /SOURCE_RELEASE_CURRENTNESS_HELD/);
        evidence.twoConcurrentPublishesDenied = true;
        evidence.staleRetryDenied = true;
        evidence.retainedImpacts = (
          await db.execute(
            sql`select action,actor_id,reason from valo_source_impacts where target_kind='content' and target_id=${row.id}::uuid`,
          )
        ).rows;
        break;
      }
      default:
        throw Error("UNKNOWN_LIFECYCLE_CASE");
    }
    return { ...common, status: "control_pass", baselineId: row.id, boundaryEvidence: evidence };
  } catch (error) {
    return {
      ...common,
      status: error instanceof Prerequisite ? "blocked" : "fail",
      reason:
        error instanceof Prerequisite ? error.message : "ISOLATED_TARGET_CONTROL_FAILED_NO_SUCCESS_INFERRED",
    };
  }
}
