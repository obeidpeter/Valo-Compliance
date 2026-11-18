import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";
import { sql } from "drizzle-orm";
import { allSourceLeads, checkerFactsSchema, digest, evaluatePublication } from "@workspace/valo-core";
import { heldSourceBundle } from "./valo-source-controls.fixtures";
import { workspaceActorFromRecord } from "../platform/workspace-context";

/** Drizzle reports database errors as "Failed query: ..." with the database's own error
 * as the cause; match the database message anywhere in that chain. */
const databaseMessage = (pattern: RegExp) => (error: unknown) => {
  for (let e: unknown = error, depth = 0; e && depth < 5; depth++) {
    const item = e as { message?: unknown; cause?: unknown };
    if (pattern.test(String(item.message ?? ""))) return true;
    e = item.cause;
  }
  return false;
};

test(
  "real PostgreSQL source correction, staff boundaries, abandoned jobs and final-dispatch ordering",
  {
    skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only",
    timeout: 90000,
  },
  async (t) => {
    const { assertDevelopmentRuntime } = await import("./valo-development-runtime");
    assertDevelopmentRuntime();
    assert.ok(
      process.env.DATABASE_URL &&
        ["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL).hostname),
    );
    const { db, pool } = await import("@workspace/db");
    const controls = await import("./valo-source-controls"),
      monitor = await import("./valo-source-monitor");
    const state = await import("./valo-source-state"),
      corrections = await import("./valo-source-corrections");
    const now = new Date(),
      prefix = `synthetic-source-${randomUUID()}`,
      contentId = randomUUID(),
      ruleId = randomUUID(),
      unaffectedId = randomUUID();
    const staff = { identityId: `${prefix}-content`, recentMfa: true, verifiedAt: Date.now() };
    const system = { identityId: `${prefix}-system`, recentMfa: true, verifiedAt: Date.now() };
    const fresh = <T extends { verifiedAt: number }>(actor: T) => ({ ...actor, verifiedAt: Date.now() });
    const activeSources = (await db.execute(sql`select source_id from valo_source_watches`)).rows.map(
      (r) => r.source_id,
    );
    const lead = allSourceLeads.find((s) => !activeSources.includes(s.id));
    assert.ok(lead, "An unused allowlisted fixture source is required");
    const b = heldSourceBundle(now);
    b.candidate.id = prefix;
    b.sources[0]!.url = lead.url;
    assert.equal(evaluatePublication(b, now).decision, "hold", "Never manufacture a released/legal fixture");
    const policyId = `${prefix}-unapproved`;
    await db.execute(
      sql`insert into valo_publication_policies(id,hash,policy,authority) values(${policyId},${digest(b.policy)},${JSON.stringify(b.policy)}::jsonb,'{"synthetic":true,"approved":false}')`,
    );
    for (const id of [contentId, unaffectedId])
      await db.execute(sql`insert into valo_content_versions(id,template_id,version,slug,policy_id,candidate_hash,bundle,attestations,status,review_by)
  values(${id}::uuid,${id === contentId ? prefix : prefix + "-unaffected"},1,${id},${policyId},${b.candidate.hash},${JSON.stringify(b)}::jsonb,'{}','candidate',${new Date(+now + 86400000)})`);
    await db.execute(sql`insert into valo_rule_releases(id,rule_id,version,status,rule,publication_bundle,manifest_hash,published_at)
  values(${ruleId}::uuid,${prefix},1,'held',${JSON.stringify({ requirementVersionId: prefix, provenance: "synthetic_fixture" })}::jsonb,${JSON.stringify(b)}::jsonb,${digest("not a release")},${now})`);
    for (const [actor, area] of [
      [staff, "content"],
      [system, "system"],
    ] as const)
      await db.execute(
        sql`insert into valo_staff_assignments(id,identity_id,role,active,granted_by,reason) values(${randomUUID()}::uuid,${actor.identityId},${area},true,'synthetic-ci','Controlled CI fixture only')`,
      );
    const actors = [0, 1, 2].map((n) => ({
      workspaceId: randomUUID(),
      identityId: `${prefix}-workspace-${n}`,
    }));
    for (const actor of actors) {
      await db.execute(
        sql`insert into valo_workspaces(id,owner_identity_id) values(${actor.workspaceId}::uuid,${actor.identityId})`,
      );
      await db.execute(
        sql`insert into valo_memberships(id,workspace_id,identity_id,role,active) values(${randomUUID()}::uuid,${actor.workspaceId}::uuid,${actor.identityId},'owner','yes')`,
      );
    }
    const reason = "Synthetic source correction boundary exercise, not a legal finding.";
    const watch = { action: "watch_source", sourceId: lead.id, requestKey: randomUUID(), reason };
    await t.test("write-time area/MFA and idempotency are enforced before effects", async () => {
      await assert.rejects(controls.actOnSourceControls(fresh(system), watch), /active role/);
      await assert.rejects(
        controls.actOnSourceControls({ ...fresh(staff), recentMfa: false }, watch),
        /fresh multi-factor verification \(MFA\)/,
      );
      await assert.rejects(
        controls.actOnSourceControls({ ...staff, verifiedAt: Date.now() - 31000 }, watch),
        /fresh multi-factor verification \(MFA\)/,
      );
      const saved = await controls.actOnSourceControls(fresh(staff), watch);
      assert.equal((await controls.actOnSourceControls(fresh(staff), watch)).auditId, saved.auditId);
      await assert.rejects(
        controls.actOnSourceControls(fresh(staff), { ...watch, reason: reason + " changed" }),
        /another request/,
      );
      await assert.rejects(
        db.execute(
          sql`update valo_safety_control_audit set reason='altered' where id=${saved.auditId}::uuid`,
        ),
        databaseMessage(/append only/),
      );
    });
    const snapshot = async (raw: string) => {
      const id = randomUUID();
      await db.execute(sql`insert into valo_source_snapshots(id,source_id,url,attempted_at,fetched_at,status,http_status,mime,raw_checksum,text_checksum,raw_object_key,text_object_key,bytes,extraction_version,metadata)
   values(${id}::uuid,${lead.id},${lead.url},${now},${now},'retrieved_unreviewed',200,'text/plain',${digest(raw)},${b.sources[0]!.hash},
    ${"synthetic-ci-not-a-retained-file/" + id + "/raw"},${"synthetic-ci-not-a-retained-file/" + id + "/text"},10,'controlled-no-extraction','{"synthetic":true,"publication":"held"}')`);
      return id;
    };
    // The watch was registered during the first subtest, after `now`; schedule the first
    // check as of a time after that registration, and keep later steps relative to it.
    const checkedAt = new Date();
    await monitor.scheduleSourceChecks(checkedAt);
    const initial = await monitor.claimSourceCheck(checkedAt);
    assert.ok(initial);
    assert.equal(initial.source_id, lead.id);
    const first = await snapshot("controlled bytes v1");
    assert.equal(await monitor.completeSourceCheck(initial, first, checkedAt), true);
    for (const [kind, id] of [
      ["content", contentId],
      ["rule", ruleId],
    ] as const)
      await db.execute(sql`insert into valo_source_release_bindings(target_kind,target_id,source_id,bundle_source_id,source_hash,snapshot_id,raw_hash)
  values(${kind},${id}::uuid,${lead.id},${b.sources[0]!.id},${b.sources[0]!.hash},${first}::uuid,${digest("controlled bytes v1")})`);
    const assessmentIds: string[] = [],
      taskIds: string[] = [];
    for (let n = 0; n < 3; n++) {
      const actor = actors[n]!,
        id = randomUUID(),
        result = {
          items: [
            {
              ruleId: n < 2 ? prefix : prefix + "-unaffected",
              ruleVersion: 1,
              requirementVersionId: n < 2 ? prefix : prefix + "-unaffected",
            },
          ],
        };
      assessmentIds.push(id);
      await db.execute(sql`insert into valo_assessments(id,workspace_id,facts,facts_hash,result,result_hash,ruleset_version,as_of_date,consent_version,actor_id)
   values(${id}::uuid,${actor.workspaceId}::uuid,'{}',${digest({})},${JSON.stringify(result)}::jsonb,${digest(result)},'synthetic-source-boundary',${now.toISOString().slice(0, 10)}::date,'synthetic',${actor.identityId})`);
      const count = n === 0 ? 201 : 1;
      for (let j = 0; j < count; j++) {
        const taskId = randomUUID();
        taskIds.push(taskId);
        await db.execute(sql`insert into valo_tasks(id,workspace_id,title,notes,assessment_id,rule_id,rule_version,actor_id)
    values(${taskId}::uuid,${actor.workspaceId}::uuid,'Controlled task','No legal recommendation',${id}::uuid,${n < 2 ? prefix : prefix + "-unaffected"},1,${actor.identityId})`);
        await db.execute(
          sql`insert into valo_reminder_outbox(id,workspace_id,task_id,idempotency_key,scheduled_at,status) values(${randomUUID()}::uuid,${actor.workspaceId}::uuid,${taskId}::uuid,${taskId},${now},'pending')`,
        );
      }
    }
    const historyBefore = (
      await db.execute(
        sql`select id,facts_hash,result_hash,result from valo_assessments where id in (${sql.join(
          assessmentIds.map((id) => sql`${id}::uuid`),
          sql`,`,
        )}) order by id`,
      )
    ).rows;
    await t.test(
      "changed capture blocks immediately; bounded fan-out resumes and preserves historical hashes",
      async () => {
        assert.equal(await state.sourceTargetAllowed(db, "rule", ruleId, b, checkedAt), true);
        const later = new Date(+checkedAt + 86400000);
        await monitor.scheduleSourceChecks(later);
        const changed = await monitor.claimSourceCheck(later);
        assert.ok(changed);
        const next = await snapshot("controlled bytes v2");
        assert.equal(await monitor.completeSourceCheck(changed, next, later), true);
        assert.equal(
          await state.sourceTargetAllowed(db, "rule", ruleId, b, later),
          false,
          "No dependency on fan-out completion",
        );
        assert.equal(
          await monitor.completeSourceCheck(changed, next, later),
          false,
          "Completed job cannot repeat impacts",
        );
        while (await corrections.processSourceDependencyJob()) {}
        await corrections.processDerivedImpact();
        const count = Number(
          (
            await db.execute(
              sql`select count(*) n from valo_source_impacts where target_id in (${contentId}::uuid,${ruleId}::uuid)`,
            )
          ).rows[0]!.n,
        );
        assert.equal(
          count,
          2,
          "The guide-to-rule and direct-source edges converge on one impact per version",
        );
        // First wake-up stops mid-corpus. A fresh call resumes from the durable DB cursor.
        await corrections.processSourceImpact();
        await corrections.processSourceImpact();
        for (let i = 0; i < 15; i++) if (!(await corrections.processSourceImpact())) break;
        const marked = Number(
          (await db.execute(sql`select count(*) n from valo_tasks where rule_id=${prefix} and needs_review`))
            .rows[0]!.n,
        );
        assert.equal(marked, 202);
        assert.equal(
          (await db.execute(sql`select needs_review from valo_tasks where id=${taskIds.at(-1)!}::uuid`))
            .rows[0]!.needs_review,
          false,
        );
        assert.equal(
          Number(
            (
              await db.execute(
                sql`select count(*) n from valo_reminder_outbox o join valo_tasks t on t.id=o.task_id where t.rule_id=${prefix} and o.status='pending'`,
              )
            ).rows[0]!.n,
          ),
          0,
        );
        assert.deepEqual(
          (
            await db.execute(
              sql`select id,facts_hash,result_hash,result from valo_assessments where id in (${sql.join(
                assessmentIds.map((id) => sql`${id}::uuid`),
                sql`,`,
              )}) order by id`,
            )
          ).rows,
          historyBefore,
        );
        const own = await controls.correctionNotices(workspaceActorFromRecord(actors[0]!));
        assert.equal(own.notices.length, 50);
        assert.equal(own.hasMore, true);
        assert.equal(
          (await controls.correctionNotices(workspaceActorFromRecord(actors[2]!))).notices.length,
          0,
        );
        assert.ok(!JSON.stringify(own).includes(actors[1]!.workspaceId));
        assert.equal(
          Number(
            (
              await db.execute(
                sql`select count(*) n from valo_source_impacts where target_id=${unaffectedId}::uuid`,
              )
            ).rows[0]!.n,
          ),
          0,
        );
      },
    );
    await t.test(
      "actual child death consumes an attempt; expired lease is recoverable and stale owner cannot complete",
      async () => {
        const day = new Date(+now + 2 * 86400000).toISOString().slice(0, 10);
        await db.execute(
          sql`insert into valo_source_check_jobs(id,source_id,day,status) values(${randomUUID()}::uuid,${lead.id},${day}::date,'pending')`,
        );
        const code = `const m=await import(${JSON.stringify(new URL("./valo-source-monitor.ts", import.meta.url).href)});process.stdout.write(JSON.stringify(await m.claimSourceCheck())+'\\n');setInterval(()=>{},1000);`;
        const child = spawn(
          process.execPath,
          ["--import", import.meta.resolve("tsx"), "--input-type=module", "-e", code],
          { env: process.env, stdio: ["ignore", "pipe", "pipe"] },
        );
        let text = "",
          errors = "";
        child.stderr.on("data", (d) => {
          errors += d;
        });
        const old = await new Promise<{ id: string; source_id: string; token: string }>((resolve, reject) => {
          const timer = setTimeout(() => {
            child.kill("SIGKILL");
            reject(Error("Child claim timeout: " + errors));
          }, 10000);
          child.stdout.on("data", (d) => {
            text += d;
            if (text.includes("\n")) {
              clearTimeout(timer);
              resolve(JSON.parse(text.split("\n")[0]!));
            }
          });
          child.on("error", reject);
        });
        assert.ok(old);
        child.kill("SIGKILL");
        await once(child, "exit");
        const after = new Date(Date.now() + 301000),
          recovered = await monitor.claimSourceCheck(after);
        assert.ok(recovered);
        assert.equal(recovered.id, old.id);
        assert.notEqual(recovered.token, old.token);
        assert.equal(await monitor.completeSourceCheck(old, first, after), false);
        assert.equal(await monitor.completeSourceCheck(recovered, null, after), true);
        assert.equal(
          (await db.execute(sql`select attempts,result from valo_source_check_jobs where id=${old.id}::uuid`))
            .rows[0]!.attempts,
          2,
        );
      },
    );
    await t.test("dispatches beyond the database pool size all finish", { timeout: 20000 }, async () => {
      // Each stand-in provider call also uses the database, as the budget ledger does.
      // Holding a pooled connection for every admitted call let ten of them exhaust the
      // pool, after which no request could get a connection.
      const n = 25;
      assert.ok(n > (pool.options.max ?? 10));
      const seen = await Promise.all(
        Array.from({ length: n }, (_, i) =>
          state.withSafetyDispatch("ai", async () => {
            await new Promise((r) => setTimeout(r, 20));
            return Number((await db.execute(sql`select ${i}::int as i`)).rows[0]!.i);
          }),
        ),
      );
      assert.deepEqual(
        seen,
        Array.from({ length: n }, (_, i) => i),
      );
    });
    await t.test(
      "a pause refuses later dispatch without waiting for admitted calls; revoked/stale staff cannot resume",
      async () => {
        let entered!: () => void, finish!: () => void;
        const enteredPromise = new Promise<void>((r) => (entered = r)),
          finishPromise = new Promise<void>((r) => (finish = r));
        let calls = 0,
          connectionsHeldDuringCall = -1;
        const dispatch = state.withSafetyDispatch("ai", async () => {
          calls++;
          // No pooled connection is held while the provider works, so no transaction
          // or source-state lock is held either.
          connectionsHeldDuringCall = pool.totalCount - pool.idleCount;
          entered();
          await finishPromise;
          return "controlled provider acknowledged";
        });
        await enteredPromise;
        assert.equal(connectionsHeldDuringCall, 0);
        // The pause commits while the admitted call is still in flight. If it waited for
        // that call, this await would never finish.
        await controls.actOnSourceControls(fresh(system), {
          action: "pause_service",
          service: "ai",
          requestKey: randomUUID(),
          reason,
        });
        await assert.rejects(
          state.withSafetyDispatch("ai", async () => {
            calls++;
          }),
          /temporarily paused/,
        );
        // An admitted call cannot be recalled; it completes normally.
        finish();
        assert.equal(await dispatch, "controlled provider acknowledged");
        assert.equal(calls, 1);
        await db.execute(
          sql`update valo_staff_assignments set active=false where identity_id=${system.identityId}`,
        );
        await assert.rejects(
          controls.actOnSourceControls(fresh(system), {
            action: "resume_service",
            service: "ai",
            requestKey: randomUUID(),
            reason,
          }),
          /active role/,
        );
        await db.execute(
          sql`update valo_staff_assignments set active=true where identity_id=${system.identityId}`,
        );
        await controls.actOnSourceControls(fresh(system), {
          action: "resume_service",
          service: "ai",
          requestKey: randomUUID(),
          reason,
        });
      },
    );
    await t.test(
      "a checkout pause stops checkout but not AI or free guidance, and records its reason, actor and customer impact",
      async () => {
        const released = await import("./valo-released-content");
        const catalogue = await released.releasedCatalogue(),
          resources = await released.releasedResources();
        const paused = await controls.actOnSourceControls(fresh(system), {
          action: "pause_service",
          service: "checkout",
          requestKey: randomUUID(),
          reason,
        });
        try {
          await assert.rejects(
            state.withSafetyDispatch("checkout", async () => "not reached"),
            /temporarily paused/,
          );
          // Each switch is independent: AI still runs while checkout is paused.
          assert.equal(await state.withSafetyDispatch("ai", async () => "AI still runs"), "AI still runs");
          // Free guidance reads the same with checkout and AI both paused.
          await controls.actOnSourceControls(fresh(system), {
            action: "pause_service",
            service: "ai",
            requestKey: randomUUID(),
            reason,
          });
          assert.deepEqual(await released.releasedCatalogue(), catalogue);
          assert.deepEqual(await released.releasedResources(), resources);
          const [audit] = (
            await db.execute(
              sql`select actor_id,area,action,target,reason,current from valo_safety_control_audit where id=${paused.auditId}::uuid`,
            )
          ).rows as {
            actor_id: string;
            area: string;
            action: string;
            target: string;
            reason: string;
            current: {
              customerImpact: { refused: string; unaffected: string; ordersAwaitingPayment: unknown };
            };
          }[];
          assert.equal(audit?.actor_id, system.identityId);
          assert.deepEqual(
            [audit.area, audit.action, audit.target, audit.reason],
            ["system", "pause_service", "checkout", reason],
          );
          assert.equal(audit.current.customerImpact.refused, "new orders and checkout");
          assert.match(audit.current.customerImpact.unaffected, /free guidance/);
          assert.equal(typeof audit.current.customerImpact.ordersAwaitingPayment, "number");
          const [switched] = (
            await db.execute(
              sql`select enabled,reason,actor_id from valo_safety_switches where key='checkout'`,
            )
          ).rows;
          assert.deepEqual(
            [switched?.enabled, switched?.reason, switched?.actor_id],
            [false, reason, system.identityId],
          );
        } finally {
          for (const service of ["checkout", "ai"] as const)
            await controls.actOnSourceControls(fresh(system), {
              action: "resume_service",
              service,
              requestKey: randomUUID(),
              reason,
            });
        }
        assert.equal(await state.withSafetyDispatch("checkout", async () => "resumed"), "resumed");
      },
    );
    await t.test("held versions cannot be manually restored or approved", async () => {
      await assert.rejects(
        controls.actOnSourceControls(fresh(staff), {
          action: "publish",
          kind: "content",
          id: contentId,
          version: 1,
          requestKey: randomUUID(),
          reason,
        }),
      );
      assert.equal(
        (await db.execute(sql`select status from valo_content_versions where id=${contentId}::uuid`)).rows[0]!
          .status,
        "candidate",
      );
      assert.equal(
        (
          await db.execute(
            sql`select count(*) n from valo_publication_audit where version_id=${contentId}::uuid and action='published'`,
          )
        ).rows[0]!.n,
        "0",
      );
    });
    await t.test("staff role revocation committed while an action waits wins before mutation", async () => {
      const blocker = await pool.connect();
      await blocker.query("BEGIN");
      await blocker.query("select pg_advisory_xact_lock(7502601)");
      const queued = controls.actOnSourceControls(fresh(staff), {
        action: "hold_version",
        kind: "content",
        id: unaffectedId,
        version: 1,
        requestKey: randomUUID(),
        reason,
      });
      // Attach the rejection observer before releasing the waiter.
      const denied = assert.rejects(queued, /active role/);
      await db.execute(
        sql`update valo_staff_assignments set active=false where identity_id=${staff.identityId}`,
      );
      await blocker.query("COMMIT");
      blocker.release();
      await denied;
      assert.equal(
        Number(
          (
            await db.execute(
              sql`select count(*) n from valo_source_impacts where target_id=${unaffectedId}::uuid`,
            )
          ).rows[0]!.n,
        ),
        0,
      );
      await db.execute(
        sql`update valo_staff_assignments set active=true where identity_id=${staff.identityId}`,
      );
    });
    await t.test(
      "actual task and assessment mutations recheck queued revocation and privacy tombstones",
      async () => {
        const { createTask } = await import("./valo-tasks"),
          { createAssessment } = await import("./valo-assessments");
        const actor = actors[2]!,
          task = {
            title: "A personal task",
            notes: "Synthetic authorization boundary",
            dueDate: null,
            dateConfirmed: false,
            assessmentId: null,
            ruleId: null,
          };
        const facts = checkerFactsSchema.parse({
          legalForm: "company",
          registrationStatus: "registered",
          activities: ["retail"],
          state: "Lagos",
          lga: "unknown",
          employees: "unknown",
          turnoverBand: "unknown",
          turnoverYear: "unknown",
          turnoverMetric: "gross_revenue",
          turnoverCurrency: "NGN",
          premises: "unknown",
          manufacturing: "no",
          importing: "no",
          personalData: "unknown",
        });
        const assessment = { facts, saveConsent: true, asOfDate: now.toISOString().slice(0, 10) };
        const counts = async () =>
          (
            await db.execute(sql`select (select count(*) from valo_tasks where workspace_id=${actor.workspaceId}::uuid) tasks,
   (select count(*) from valo_assessments where workspace_id=${actor.workspaceId}::uuid) assessments,
   (select count(*) from valo_events where workspace_id=${actor.workspaceId}::uuid) events`)
          ).rows;
        const before = await counts();
        for (const action of [
          () => createTask(workspaceActorFromRecord(actor), task),
          () => createAssessment(workspaceActorFromRecord(actor), assessment),
        ]) {
          const blocker = await pool.connect();
          await blocker.query("BEGIN");
          await blocker.query("select id from valo_workspaces where id=$1 for update", [actor.workspaceId]);
          const queued = action(),
            denied = assert.rejects(queued, /Active workspace membership/);
          await db.execute(
            sql`update valo_memberships set active='no' where workspace_id=${actor.workspaceId}::uuid`,
          );
          await blocker.query("COMMIT");
          blocker.release();
          await denied;
          await db.execute(
            sql`update valo_memberships set active='yes' where workspace_id=${actor.workspaceId}::uuid`,
          );
        }
        // A synthetic retained quarantine marker is sufficient for fail-closed access;
        // this does not simulate completion of erasure or produce a privacy receipt.
        // Record it under the current pinned signing key, as real erasure does. A row
        // left on the legacy default version with no signed legacy event would make
        // every later workspace resolution in this shared database fail closed.
        const { privacySigner } = await import("./valo-privacy-keys");
        await db.transaction(async (tx) => {
          const { version } = await privacySigner(tx);
          await tx.execute(sql`insert into valo_privacy_tombstones(id,workspace_id,case_id,identity_hash,phase,key_version)
   values(${randomUUID()}::uuid,${actor.workspaceId}::uuid,${randomUUID()}::uuid,${digest(actor.identityId)},'synthetic-quarantine-only',${version})`);
        });
        await assert.rejects(
          createTask(workspaceActorFromRecord(actor), task),
          /Workspace deletion is recorded/,
        );
        await assert.rejects(
          createAssessment(workspaceActorFromRecord(actor), assessment),
          /Workspace deletion is recorded/,
        );
        assert.deepEqual(await counts(), before);
      },
    );
    await t.test(
      "content staff read a version's publication record, and the access is recorded (ADM-002)",
      async () => {
        const { editorialRecord } = await import("./valo-editorial-record");
        await assert.rejects(editorialRecord(fresh(system), "content", contentId), /active role/);
        await assert.rejects(
          editorialRecord({ ...fresh(staff), recentMfa: false }, "content", contentId),
          /fresh multi-factor verification \(MFA\)/,
        );
        await assert.rejects(editorialRecord(fresh(staff), "content", randomUUID()), /No such version/);
        const reads = async () =>
          Number(
            (
              await db.execute(
                sql`select count(*)::int as n from valo_staff_access_audit where actor_id=${staff.identityId} and reason like 'Read the publication record%'`,
              )
            ).rows[0]!.n,
          );
        const before = await reads();
        const at = new Date();
        const record = await editorialRecord(fresh(staff), "content", contentId, at);
        assert.equal(await reads(), before + 1, "each read is recorded");
        assert.deepEqual(
          { key: record.key, version: record.version, candidateHash: record.candidateHash },
          { key: prefix, version: 1, candidateHash: b.candidate.hash },
        );
        // The record shows the stored bundle's own check: this fixture is held, with its reasons.
        assert.deepEqual(record.check, {
          checkedAt: at.toISOString(),
          ...evaluatePublication(b, at),
        });
        assert.equal(record.check.decision, "hold");
        assert.ok(record.check.reasons.length > 0);
        assert.deepEqual(record.draftRun, {
          runId: b.draftRun.runId,
          model: b.draftRun.model,
          promptVersion: b.draftRun.promptVersion,
        });
        assert.deepEqual(record.reviews, []);
        const impacts = (
          await db.execute(
            sql`select reason from valo_source_impacts where target_kind='content' and target_id=${contentId}::uuid order by created_at,id`,
          )
        ).rows.map((r) => r.reason);
        assert.deepEqual(
          record.safetyHolds.map((h) => h.reason),
          impacts,
        );
        const rule = await editorialRecord(fresh(staff), "rule", ruleId, at);
        assert.deepEqual([rule.kind, rule.key, rule.status, rule.audit], ["rule", prefix, "held", []]);
        assert.equal(rule.check.decision, "hold");
      },
    );
    await t.test("actual staff routes enforce origin, area authority and generated responses", async () => {
      const { default: express } = await import("express");
      const { createSourceControlsRouter } = await import("../routes/valo-source-controls");
      const { GetSourceControlsResponse, GetEditorialRecordResponse } = await import("@workspace/api-zod");
      let mfa = true;
      const app = express();
      app.use(express.json());
      app.use(createSourceControlsRouter(async () => ({ ...fresh(staff), recentMfa: mfa })));
      app.use(
        (
          error: unknown,
          _req: unknown,
          res: { status: (n: number) => { json: (v: unknown) => void } },
          _next: unknown,
        ) => {
          const e = error as { status?: number; message?: string };
          res.status(e.status ?? 422).json({ error: e.message ?? "Invalid request" });
        },
      );
      const server = app.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      const url = `http://127.0.0.1:${address.port}`;
      const origin = process.env.VALO_TRUSTED_ORIGIN;
      process.env.VALO_TRUSTED_ORIGIN = url;
      try {
        const content = await fetch(url + "/admin/source-controls?area=content");
        assert.equal(content.status, 200);
        assert.equal(GetSourceControlsResponse.parse(await content.json()).area, "content");
        assert.match(content.headers.get("cache-control") ?? "", /no-store/);
        assert.equal((await fetch(url + "/admin/source-controls?area=system")).status, 403);
        const post = (body: unknown, from = url) =>
          fetch(url + "/admin/source-controls/action", {
            method: "POST",
            headers: { "content-type": "application/json", origin: from },
            body: JSON.stringify(body),
          });
        assert.equal((await post(watch, "https://untrusted.invalid")).status, 403);
        assert.equal((await post({ ...watch, published: true })).status, 422);
        mfa = false;
        assert.equal((await post(watch)).status, 403);
        mfa = true;
        const replay = await post(watch);
        assert.equal(replay.status, 200);
        assert.equal(((await replay.json()) as { replayed: boolean }).replayed, true);
        const record = await fetch(`${url}/admin/editorial-records/content/${contentId}`);
        assert.equal(record.status, 200);
        assert.equal(GetEditorialRecordResponse.parse(await record.json()).id, contentId);
        assert.match(record.headers.get("cache-control") ?? "", /no-store/);
        for (const path of [
          `/admin/editorial-records/content/${randomUUID()}`,
          "/admin/editorial-records/policy/x",
        ])
          assert.equal((await fetch(url + path)).status, 404, path);
        mfa = false;
        assert.equal((await fetch(`${url}/admin/editorial-records/content/${contentId}`)).status, 403);
        mfa = true;
      } finally {
        if (origin === undefined) delete process.env.VALO_TRUSTED_ORIGIN;
        else process.env.VALO_TRUSTED_ORIGIN = origin;
        server.close();
        await once(server, "close");
      }
    });
    await pool.end();
  },
);
