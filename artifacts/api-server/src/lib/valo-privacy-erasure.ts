import { ErasureInventoryAttestations, inventoryGuardStamp } from "./valo-erasure-inventory-cache";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { Pool } from "pg";
import { logger } from "./logger";
import { withPrivacyCaseLock, ErasureLockBusyError } from "./valo-erasure-lock";
import { and, eq, ne, sql, lte, asc } from "drizzle-orm";
import {
  db,
  valoPrivacyCases,
  valoPrivacyTombstones,
  valoPrivacyEvents,
  valoWorkspaces,
  valoMemberships,
  valoExportJobs,
  valoExportObjects,
} from "@workspace/db";
import { ActOnStaffPrivacyCaseBody } from "@workspace/api-zod";
import { assertDevelopmentRuntime } from "./valo-development-runtime";
import { deletePrivateFile } from "./valo-private-storage";
import { privacyKey, privacySigner } from "./valo-privacy-keys";
import { quotaSubjectHash } from "./valo-quota";
import {
  inventoryHasher,
  signErasureSeal,
  verifyErasureSeal,
  erasureSealHash,
  assertSealedInventory,
  startReplay,
  signReplayState,
  verifyReplayState,
  assertErasureLocatorScope,
  type ErasureSeal,
  type ReplayState,
} from "./valo-erasure-seal";
import { ValoProblem } from "./valo-problem";
import { cancelUnsentDisputeWork } from "./valo-dispute-actions";
import { retireWorkspaceExports, workspaceExportScratch } from "./valo-workspace-export-jobs";
import { copyPhases, erasePrivateCopyPhase, fencePrivateCopies } from "./valo-private-copy-inventory";
import { erasureProgressReason } from "./valo-privacy-redactions";
import { assertPrivacyVersion } from "./valo-privacy-state";
import {
  readPrivacyCase,
  requirePrivacyStaff,
  privacyChange,
  privacyDetail,
  type PrivacyStaffActor,
  type PrivacyRow,
} from "./valo-privacy";

const legacyPhases = [
  "valo_reminder_outbox",
  "valo_tasks",
  "valo_assessments",
  "valo_ai_drafts",
  "valo_export_requests",
  "valo_file_assets",
  "valo_export_objects",
  "valo_export_jobs",
  "valo_document_revisions",
  "valo_documents",
  "valo_profile_versions",
  "valo_reminder_preferences",
  "purchase_notifications",
  "support_content",
  "privacy_messages",
  "privacy_content",
  "dispute_work",
] as const;
const phases = [...legacyPhases, ...copyPhases] as const;
const phasesFor = (seal: ErasureSeal) =>
  seal.scope === "development-application-content-erasure-v3" ? phases : legacyPhases;
const removedMessage = "[Private content removed by verified workspace erasure]";
const scope = "development-application-content-erasure-v3";
type Input = ReturnType<typeof ActOnStaffPrivacyCaseBody.parse>;
type DeleteObject = (key: string) => Promise<void>;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Tombstone = typeof valoPrivacyTombstones.$inferSelect;

// Lock connections never consume the shared data pool. Bounded acquisition and
// idle exit prevent hung requests/tests; worker shutdown explicitly drains it.
let lockPool: Pool | undefined;
export async function closePrivacyErasureLocks() {
  const closing = lockPool;
  lockPool = undefined;
  await closing?.end();
}
async function withErasureLock<T>(caseId: string, fn: () => Promise<T>) {
  assertDevelopmentRuntime();
  if (!lockPool) {
    lockPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 2,
      connectionTimeoutMillis: 1000,
      idleTimeoutMillis: 10000,
      allowExitOnIdle: true,
    });
    lockPool.on("error", () => logger.error({ event: "privacy.lock_connection_failed" }));
  }
  try {
    return await withPrivacyCaseLock(lockPool, caseId, fn);
  } catch (error) {
    if (error instanceof ErasureLockBusyError)
      throw new ValoProblem(
        409,
        "This erasure/recovery batch is already running. Reload its recorded progress.",
      );
    throw error;
  }
}
async function sealOf(tx: Tx, t: Tombstone) {
  const version = (t.erasureSeal as { keyVersion?: unknown } | null)?.keyVersion;
  if (typeof version !== "string") throw Error("ERASURE_SEAL_INVALID");
  return verifyErasureSeal(
    t.erasureSeal,
    {
      caseId: t.caseId,
      workspaceId: t.workspaceId,
      identityHash: t.identityHash,
      identityKeyVersion: t.keyVersion,
    },
    await privacyKey(tx, version),
  );
}
async function progressOf(tx: Tx, raw: unknown, seal: ErasureSeal) {
  const version = (raw as { keyVersion?: unknown } | null)?.keyVersion;
  if (typeof version !== "string") throw Error("ERASURE_REPLAY_STATE_INVALID");
  return verifyReplayState(raw, seal, phasesFor(seal).length, await privacyKey(tx, version));
}
async function signSeal(tx: Tx, input: Omit<ErasureSeal, "keyVersion" | "mac">) {
  return signErasureSeal(input, await privacySigner(tx));
}
async function readTombstone(tx: Tx, caseId: string) {
  const [t] = await tx
    .select()
    .from(valoPrivacyTombstones)
    .where(eq(valoPrivacyTombstones.caseId, caseId))
    .for("update");
  if (!t) throw new ValoProblem(404, "A retained signed deletion journal is required.");
  return { t, seal: await sealOf(tx, t) };
}
/** Full exact inventory verification uses bounded memory. It precedes object
 * dispatch, and the DB trigger forbids key insert/update/delete after sealing. */
async function inventory(tx: Tx, t: Tombstone) {
  const h = inventoryHasher(t.workspaceId);
  let cursor: string | null = null;
  for (;;) {
    const page: { rows: { workspace_id: string; object_key: string }[] } =
      await tx.execute(sql`SELECT workspace_id,object_key
      FROM valo_privacy_erasure_objects WHERE case_id=${t.caseId}::uuid
      AND (${cursor}::text IS NULL OR object_key COLLATE "C">${cursor})
      ORDER BY object_key COLLATE "C" LIMIT 250`);
    for (const row of page.rows) {
      if (row.workspace_id !== t.workspaceId) throw Error("ERASURE_INVENTORY_WORKSPACE_CHANGED");
      h.add(row.object_key);
      cursor = row.object_key;
    }
    if (page.rows.length < 250) return h.finish();
  }
}
async function verifyInventory(tx: Tx, t: Tombstone, seal: ErasureSeal) {
  if (!seal.inventoryHash) throw new ValoProblem(409, "The exact erasure inventory has not been sealed.");
  const actual = await inventory(tx, t);
  assertSealedInventory(seal, actual);
}
const replayInventory = new ErasureInventoryAttestations();
export function erasureReplayVerificationCounts() {
  return { fullScans: replayInventory.scans, cacheHits: replayInventory.hits };
}
async function verifyReplayInventory(tx: Tx, t: Tombstone, seal: ErasureSeal, fresh: boolean) {
  // Constant-size catalog lookup. Normal writes cannot mutate sealed keys.
  // Even disable/edit/re-enable in one transaction changes trigger xmin.
  const result = await tx.execute<{
    epoch: string;
    table_oid: string;
    trigger_oid: string;
    trigger_revision: string;
    function_oid: string;
    function_revision: string;
    enabled: string;
    definition: string;
    body: string;
    security_definer: boolean;
    settings: string[] | null;
    language: string;
    function_schema: string;
  }>(sql`
    SELECT current_database()||':'||pg_postmaster_start_time()::text epoch,
      g.tgrelid::text table_oid,g.oid::text trigger_oid,g.xmin::text trigger_revision,
      p.oid::text function_oid,p.xmin::text function_revision,g.tgenabled::text enabled,
      pg_get_triggerdef(g.oid) definition,p.prosrc body,p.prosecdef security_definer,
      p.proconfig settings,l.lanname language,n.nspname function_schema
    FROM pg_trigger g JOIN pg_proc p ON p.oid=g.tgfoid
    JOIN pg_language l ON l.oid=p.prolang JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE g.tgrelid='public.valo_privacy_erasure_objects'::regclass AND g.tgname='valo_erasure_inventory_immutable'`);
  await replayInventory.verify(
    t.caseId,
    erasureSealHash(seal),
    inventoryGuardStamp(result.rows[0]),
    () => verifyInventory(tx, t, seal),
    fresh,
  );
}
function assertProcessing(row: PrivacyRow, actor: PrivacyStaffActor, version?: number) {
  if (version !== undefined) assertPrivacyVersion(row.version, version);
  if (row.kind !== "deletion" || !row.verifiedAt || row.assignedIdentityId !== actor.identityId)
    throw new ValoProblem(403, "A verified deletion request assigned to this privacy operator is required.");
  if (!["assigned", "in_progress", "failed", "partially_fulfilled"].includes(row.status))
    throw new ValoProblem(
      409,
      "The case is held or unavailable. Explicitly release its hold before processing.",
    );
}
export async function holdUnsentPrivacyNotifications(tx: Tx, workspaceId: string) {
  return tx.execute(sql`UPDATE valo_purchase_outbox SET status='held_privacy_erasure'
    WHERE ctid IN (SELECT ctid FROM valo_purchase_outbox WHERE workspace_id=${workspaceId}::uuid
      AND status IN ('awaiting_email_configuration','pending','retry') LIMIT 100)`);
}
/** One shared row budget. Returning fewer than 100 means every family below
 * is exhausted, so the signed cursor can safely advance to its next phase. */
export async function eraseSupportContentBatch(tx: Tx, workspaceId: string) {
  let count = 0;
  const support =
    await tx.execute(sql`UPDATE valo_support_tickets SET scope=${removedMessage},contact_email='erased@invalid'
  WHERE ctid IN (SELECT ctid FROM valo_support_tickets WHERE workspace_id=${workspaceId}::uuid
    AND (scope<>${removedMessage} OR contact_email<>'erased@invalid') LIMIT 100)`);
  count += support.rowCount ?? 0;
  if (count < 100) {
    const concerns =
      await tx.execute(sql`UPDATE valo_payment_concerns SET message=${removedMessage},latest_reply=NULL
  WHERE ctid IN (SELECT ctid FROM valo_payment_concerns WHERE workspace_id=${workspaceId}::uuid
    AND (message<>${removedMessage} OR latest_reply IS NOT NULL) LIMIT ${100 - count})`);
    count += concerns.rowCount ?? 0;
  }
  if (count < 100) {
    const messages = await tx.execute(sql`DELETE FROM valo_concern_messages WHERE ctid IN
  (SELECT ctid FROM valo_concern_messages WHERE workspace_id=${workspaceId}::uuid LIMIT ${100 - count})`);
    count += messages.rowCount ?? 0;
  }
  return { rowCount: count };
}
async function eraseSection(
  tx: Tx,
  workspaceId: string,
  section: (typeof phases)[number],
  currentCaseId: string,
) {
  if ((copyPhases as readonly string[]).includes(section))
    return erasePrivateCopyPhase(tx, workspaceId, section as (typeof copyPhases)[number], (id) =>
      readPrivacyCase(tx, id),
    );
  if (section === "dispute_work") return cancelUnsentDisputeWork(tx, workspaceId);
  if (section === "privacy_messages")
    return tx.execute(sql`DELETE FROM valo_privacy_messages WHERE ctid IN
    (SELECT ctid FROM valo_privacy_messages WHERE workspace_id=${workspaceId}::uuid LIMIT 100)`);
  if (section === "purchase_notifications") return holdUnsentPrivacyNotifications(tx, workspaceId);
  if (section === "support_content") return eraseSupportContentBatch(tx, workspaceId);
  if (section === "privacy_content") {
    // Preserve historical signed phase indices and one shared 100-row budget.
    // Exact native export object keys are sealed before customer metadata goes.
    const saved = await tx.execute(sql`DELETE FROM valo_saved_templates WHERE ctid IN
      (SELECT ctid FROM valo_saved_templates WHERE workspace_id=${workspaceId}::uuid LIMIT 100)`);
    let used = saved.rowCount ?? 0;
    if (used < 100) {
      const removedAttempts = await tx.execute(sql`DELETE FROM valo_workspace_export_attempts WHERE ctid IN
      (SELECT ctid FROM valo_workspace_export_attempts WHERE workspace_id=${workspaceId}::uuid LIMIT ${100 - used})`);
      used += removedAttempts.rowCount ?? 0;
    }
    if (used < 100) {
      const removedJobs = await tx.execute(sql`DELETE FROM valo_workspace_exports WHERE ctid IN
      (SELECT ctid FROM valo_workspace_exports j WHERE workspace_id=${workspaceId}::uuid
       AND NOT EXISTS (SELECT 1 FROM valo_workspace_export_attempts a WHERE a.job_id=j.id) LIMIT ${100 - used})`);
      used += removedJobs.rowCount ?? 0;
    }
    if (used === 100) return { rowCount: used };
    const rows = await tx
      .select()
      .from(valoPrivacyCases)
      .where(
        and(
          eq(valoPrivacyCases.workspaceId, workspaceId),
          ne(valoPrivacyCases.id, currentCaseId),
          sql`(${valoPrivacyCases.message}<>${removedMessage} OR ${valoPrivacyCases.resultJson} IS NOT NULL)`,
        ),
      )
      .limit(100 - used)
      .for("update");
    for (const target of rows) {
      const checked = await readPrivacyCase(tx, target.id);
      await privacyChange(
        tx,
        checked,
        { identityId: "service:privacy-erasure", type: "worker" },
        "private_content_removed",
        "Verified workspace erasure removed request text and prepared data; historical signed audit evidence is retained.",
        {
          message: removedMessage,
          resultJson: null,
          resultScope: "Private prepared content removed by verified workspace erasure.",
          steps: checked.steps.map((s) => ({ ...s, detail: removedMessage })),
        },
      );
    }
    return { rowCount: used + rows.length };
  }
  if (section === "valo_ai_drafts")
    return tx.execute(sql`UPDATE valo_ai_drafts SET preview='{}'::jsonb,plan=NULL,
    accepted_document_id=NULL,status='privacy_erased',updated_at=now()
    WHERE ctid IN (SELECT ctid FROM valo_ai_drafts WHERE workspace_id=${workspaceId}::uuid
    AND status<>'privacy_erased' LIMIT 100)`);
  const table = sql.identifier(section);
  return tx.execute(sql`DELETE FROM ${table} WHERE ctid IN
    (SELECT ctid FROM ${table} WHERE workspace_id=${workspaceId}::uuid LIMIT 100)`);
}
async function removeLocator(workspaceId: string, key: string, remove: DeleteObject) {
  assertErasureLocatorScope(workspaceId, key);
  const prefix = `workspace-export-scratch/${workspaceId}/`;
  if (key.startsWith(prefix))
    await rm(workspaceExportScratch(key.slice(prefix.length)), { recursive: true, force: true });
  else await remove(key);
}
async function recordObjectOutcome(caseId: string, workspaceId: string, key: string, deleted: boolean) {
  // An already-dispatched result remains true after a role revocation/hold.
  // Recording it does not authorize the next deletion or alter case status.
  const r =
    await db.execute(sql`UPDATE valo_privacy_erasure_objects SET status=${deleted ? "deleted" : "failed"},
    attempts=attempts+1,updated_at=now() WHERE case_id=${caseId}::uuid
    AND workspace_id=${workspaceId}::uuid AND object_key=${key}`);
  if (r.rowCount !== 1) throw Error("ERASURE_OUTCOME_JOURNAL_UNAVAILABLE");
}
export async function processPrivacyErasure(
  actor: PrivacyStaffActor,
  id: string,
  input: Input,
  remove: DeleteObject = deletePrivateFile,
) {
  return withErasureLock(id, () => processErasure(actor, id, input, remove));
}
async function processErasure(actor: PrivacyStaffActor, id: string, input: Input, remove: DeleteObject) {
  const start = await db.transaction(async (tx) => {
    await requirePrivacyStaff(tx, actor);
    let row = await readPrivacyCase(tx, id);
    assertProcessing(row, actor, input.expectedVersion);
    await privacySigner(tx);
    if (input.acknowledgement !== true)
      throw new ValoProblem(
        422,
        "Explicitly acknowledge irreversible application-content erasure and retained exclusions.",
      );
    const [w] = await tx
      .select()
      .from(valoWorkspaces)
      .where(eq(valoWorkspaces.id, row.workspaceId))
      .for("update");
    if (!w || !/^(synthetic-|privacy-fixture-)/.test(w.ownerIdentityId))
      throw new ValoProblem(
        409,
        "Only explicitly synthetic development workspaces are eligible. Production/provider deletion is not enabled.",
      );
    if (row.erasurePhase === "not_started") {
      const installed = await tx.execute<{ installed: string | null }>(
        sql`SELECT to_regclass('valo_privacy_redactions')::text AS installed`,
      );
      if (!installed.rows[0]?.installed)
        throw new ValoProblem(409, "Reviewed privacy-copy migration 0029 is required before v3 erasure.");
      if (input.action !== "start_erasure")
        throw new ValoProblem(409, "Begin the acknowledged erasure first.");
      const signer = await privacySigner(tx),
        identityKeyVersion = signer.version,
        identityHash = quotaSubjectHash(signer.key, "user", w.ownerIdentityId);
      const erasureSeal = signErasureSeal(
        {
          version: 2,
          caseId: id,
          workspaceId: row.workspaceId,
          identityHash,
          identityKeyVersion,
          scope,
          synthetic: true,
          inventoryHash: null,
          inventoryCount: 0,
          completedEventHash: null,
        },
        signer,
      );
      await tx.insert(valoPrivacyTombstones).values({
        id: randomUUID(),
        workspaceId: row.workspaceId,
        caseId: id,
        identityHash,
        keyVersion: identityKeyVersion,
        phase: scope,
        erasureSeal,
      });
      await tx
        .update(valoMemberships)
        .set({ active: "no" })
        .where(eq(valoMemberships.workspaceId, row.workspaceId));
      await fencePrivateCopies(tx, row.workspaceId);
      row = await privacyChange(
        tx,
        row,
        { identityId: actor.identityId, type: "staff" },
        "erasure_quarantined",
        input.reason,
        {
          status: "in_progress",
          erasurePhase: "quarantined",
          resultJson: null,
          resultScope:
            "Development application erasure started; access revoked. Financial, support/privacy, audit, backup and external-provider scope remains unfulfilled.",
          steps: row.steps.map((s) =>
            s.system === "application" || s.system === "private_files"
              ? {
                  ...s,
                  status: "running",
                  detail: "Resumable synthetic erasure; no complete account/provider fulfilment is claimed.",
                }
              : s,
          ),
        },
      );
    } else {
      if (input.action !== "resume_erasure")
        throw new ValoProblem(409, "Resume the existing erasure with its current version.");
      const journal = await readTombstone(tx, id); // Missing historical keys or unsigned journals hold closed.
      if (journal.seal.inventoryHash) await verifyInventory(tx, journal.t, journal.seal);
    }
    return { workspaceId: row.workspaceId, version: row.version, phase: row.erasurePhase };
  });
  if (start.phase === "application_erased")
    return db.transaction(async (tx) => {
      await requirePrivacyStaff(tx, actor);
      const row = await readPrivacyCase(tx, id);
      assertProcessing(row, actor, start.version);
      return privacyDetail(tx, row);
    });
  if (start.phase === "objects") {
    const { expected, pending } = await db.transaction(async (tx) => {
      await requirePrivacyStaff(tx, actor);
      assertProcessing(await readPrivacyCase(tx, id), actor, start.version);
      const { t, seal } = await readTombstone(tx, id);
      await privacySigner(tx);
      await verifyInventory(tx, t, seal);
      const pending = await tx.execute<{
        object_key: string;
      }>(sql`SELECT object_key FROM valo_privacy_erasure_objects
        WHERE case_id=${id}::uuid AND status<>'deleted' ORDER BY object_key COLLATE "C" LIMIT 10`);
      return { expected: erasureSealHash(seal), pending };
    });
    for (const object of pending.rows) {
      // Recheck before EACH call, outside the previous object's network wait.
      await db.transaction(async (tx) => {
        await requirePrivacyStaff(tx, actor);
        assertProcessing(await readPrivacyCase(tx, id), actor, start.version);
        const { seal } = await readTombstone(tx, id);
        await privacySigner(tx);
        if (erasureSealHash(seal) !== expected) throw Error("ERASURE_SEAL_CHANGED");
        assertErasureLocatorScope(start.workspaceId, object.object_key);
      });
      let deleted = false;
      try {
        await removeLocator(start.workspaceId, object.object_key, remove);
        deleted = true;
      } catch {
        /* Keep an actual retryable failure. */
      }
      await recordObjectOutcome(id, start.workspaceId, object.object_key, deleted);
    }
  }
  return db.transaction(async (tx) => {
    await requirePrivacyStaff(tx, actor);
    let row = await readPrivacyCase(tx, id);
    assertProcessing(row, actor, start.version);
    const journal = await readTombstone(tx, id);
    await privacySigner(tx);
    let next = start.phase,
      detail = "Private-object deletion remains pending; failed keys are retryable.";
    if (start.phase === "quarantined") {
      if (journal.seal.scope === scope) await fencePrivateCopies(tx, row.workspaceId);
      await retireWorkspaceExports(tx, row.workspaceId);
      await tx
        .update(valoExportJobs)
        .set({ status: "failed", queueId: randomUUID(), errorCode: "PRIVACY_ERASURE", updatedAt: new Date() })
        .where(eq(valoExportJobs.workspaceId, row.workspaceId));
      await tx
        .update(valoExportObjects)
        .set({ state: "cleanup" })
        .where(eq(valoExportObjects.workspaceId, row.workspaceId));
      await tx.execute(
        sql`UPDATE valo_reminder_preferences SET enabled=false WHERE workspace_id=${row.workspaceId}::uuid`,
      );
      await tx.execute(sql`INSERT INTO valo_privacy_erasure_objects(workspace_id,case_id,object_key)
        SELECT workspace_id,${row.id}::uuid,object_key FROM valo_export_objects WHERE workspace_id=${row.workspaceId}::uuid
        UNION SELECT workspace_id,${row.id}::uuid,object_key FROM valo_file_assets WHERE workspace_id=${row.workspaceId}::uuid
        UNION SELECT workspace_id,${row.id}::uuid,object_key FROM valo_workspace_export_attempts WHERE workspace_id=${row.workspaceId}::uuid
        ON CONFLICT DO NOTHING`);
      if (journal.seal.scope === scope)
        await tx.execute(sql`INSERT INTO valo_privacy_erasure_objects(workspace_id,case_id,object_key)
        SELECT workspace_id,${row.id}::uuid,'workspace-export-scratch/'||workspace_id||'/'||id
        FROM valo_workspace_export_attempts WHERE workspace_id=${row.workspaceId}::uuid ON CONFLICT DO NOTHING`);
      const exact = await inventory(tx, journal.t);
      await tx
        .update(valoPrivacyTombstones)
        .set({
          erasureSeal: await signSeal(tx, {
            ...journal.seal,
            inventoryHash: exact.hash,
            inventoryCount: exact.count,
          }),
        })
        .where(eq(valoPrivacyTombstones.id, journal.t.id));
      next = "objects";
      detail = "Export generations fenced; the complete exact object inventory is signed and immutable.";
    } else if (start.phase === "objects") {
      const count = await tx.execute<{
        remaining: number;
      }>(sql`SELECT count(*)::int AS remaining FROM valo_privacy_erasure_objects
        WHERE case_id=${id}::uuid AND status<>'deleted'`);
      if (count.rows[0]?.remaining === 0) {
        next = phases[0];
        detail =
          "Captured delete calls acknowledged. Signed keys remain scheduled for repeated late-upload cleanup.";
      }
    } else if ((phases as readonly string[]).includes(start.phase)) {
      const result = await eraseSection(tx, row.workspaceId, start.phase as (typeof phases)[number], row.id);
      const plan: readonly string[] = phasesFor(journal.seal);
      if ((result.rowCount ?? 0) < 100) next = plan[plan.indexOf(start.phase) + 1] ?? "application_erased";
      detail = `Removed ${result.rowCount ?? 0} rows from this application section; retained/external exclusions remain.`;
    } else throw new ValoProblem(409, "Unknown erasure phase; processing is held.");
    const done = next === "application_erased";
    if (done)
      await tx
        .update(valoWorkspaces)
        .set({ profileRevision: 0 })
        .where(eq(valoWorkspaces.id, row.workspaceId));
    row = await privacyChange(
      tx,
      row,
      { identityId: actor.identityId, type: "staff" },
      "erasure_batch_recorded",
      erasureProgressReason,
      {
        ...(start.phase === "privacy_content" ? { message: removedMessage, resultJson: null } : {}),
        erasurePhase: next,
        status: done ? "partially_fulfilled" : "in_progress",
        resultScope: done
          ? `Scoped synthetic application rows erased under ${journal.seal.scope}; captured object/scratch deletes acknowledged with repeated late-write cleanup. Financial facts and authenticated minimal audit proof are retained pending retention-policy review, not statutory approval. Shared usage/safety/staff records, unlinked public intake, managed identity, historical AI processors, PSP and backups remain excluded or held; this is not complete account deletion.`
          : row.resultScope,
        steps: row.steps.map((s) =>
          s.system === "application"
            ? { ...s, status: done ? "confirmed" : "running", detail }
            : s.system === "private_files"
              ? {
                  ...s,
                  status: next === "objects" || next === "quarantined" ? "running" : "held",
                  detail:
                    "Captured deletions are recorded; signed object keys outlive job rows for repeated cleanup. Future completion of an interrupted upload is not claimed impossible.",
                }
              : s.system === "identity_verification"
                ? s
                : {
                    ...s,
                    status: "held",
                    detail:
                      "Retained/external scope has not been fulfilled; no legal-retention duration or provider deletion is asserted.",
                  },
        ),
      },
    );
    if (done)
      await tx
        .update(valoPrivacyTombstones)
        .set({
          erasureSeal: await signSeal(tx, { ...journal.seal, completedEventHash: row.lastEventHash }),
          replayState: null,
          nextReplayAt: new Date(),
        })
        .where(eq(valoPrivacyTombstones.id, journal.t.id));
    return privacyDetail(tx, row);
  });
}
async function replayReady(tx: Tx, caseId: string, verifyObjects: false | "cached" | "fresh" = false) {
  await privacySigner(tx); // A valid historical proof cannot bypass a broken current signer.
  const row = await readPrivacyCase(tx, caseId),
    { t, seal } = await readTombstone(tx, caseId);
  if (
    row.workspaceId !== t.workspaceId ||
    row.kind !== "deletion" ||
    !row.verifiedAt ||
    row.erasurePhase !== "application_erased" ||
    !["partially_fulfilled", "fulfilled"].includes(row.status) ||
    !seal.completedEventHash ||
    !seal.inventoryHash ||
    !/^(synthetic-|privacy-fixture-)/.test(row.requesterIdentityId) ||
    quotaSubjectHash(await privacyKey(tx, seal.identityKeyVersion), "user", row.requesterIdentityId) !==
      seal.identityHash
  )
    throw new ValoProblem(
      409,
      "Only an authenticated completed synthetic scope may replay. Unfinished or held cases require privacy operations.",
    );
  const [event] = await tx
    .select({ id: valoPrivacyEvents.id })
    .from(valoPrivacyEvents)
    .where(
      and(
        eq(valoPrivacyEvents.caseId, caseId),
        eq(valoPrivacyEvents.workspaceId, t.workspaceId),
        eq(valoPrivacyEvents.eventHash, seal.completedEventHash),
        eq(valoPrivacyEvents.action, "erasure_batch_recorded"),
      ),
    )
    .limit(1);
  if (!event)
    throw new ValoProblem(409, "The completion receipt is absent from the authenticated case history.");
  if (verifyObjects) await verifyReplayInventory(tx, t, seal, verifyObjects === "fresh");
  return { row, t, seal };
}
/** Operator recovery imports must validate the real completion chain and the
 * entire immutable inventory before any physical replay is authorised. */
export async function verifyCompletedErasureReceipt(tx: Tx, caseId: string) {
  const { t, seal } = await replayReady(tx, caseId, "fresh");
  return { workspaceId: t.workspaceId, sealHash: erasureSealHash(seal), inventoryCount: seal.inventoryCount };
}
async function persistReplay(t: Tombstone, input: Omit<ReplayState, "keyVersion" | "mac">, done = false) {
  return db.transaction(async (tx) => {
    const state = signReplayState(input, await privacySigner(tx));
    await tx
      .update(valoPrivacyTombstones)
      .set({
        replayState: state,
        nextReplayAt: new Date(Date.now() + (done ? 3_600_000 : 0)),
        updatedAt: new Date(),
      })
      .where(eq(valoPrivacyTombstones.id, t.id));
    return state;
  });
}
async function replay(caseId: string, mode: ReplayState["mode"], remove: DeleteObject) {
  let { t, state, candidates } = await db.transaction(async (tx) => {
    const ready = await replayReady(tx, caseId, "cached");
    let state = ready.t.replayState ? await progressOf(tx, ready.t.replayState, ready.seal) : null;
    if (state && state.phase !== "done" && state.mode !== mode)
      throw new ValoProblem(409, "Another recovery mode has unfinished recorded progress.");
    if (!state || state.phase === "done") state = startReplay(ready.seal, mode, await privacySigner(tx));
    let candidates: { object_key: string }[] = [];
    if (state.phase === "objects") {
      const batch = await tx.execute<{
        object_key: string;
      }>(sql`SELECT object_key FROM valo_privacy_erasure_objects
        WHERE case_id=${caseId}::uuid AND object_key COLLATE "C">${state.cursor} ORDER BY object_key COLLATE "C" LIMIT 10`);
      candidates = batch.rows;
    }
    await tx
      .update(valoPrivacyTombstones)
      .set({ replayState: state })
      .where(eq(valoPrivacyTombstones.id, ready.t.id));
    await tx
      .update(valoMemberships)
      .set({ active: "no" })
      .where(eq(valoMemberships.workspaceId, ready.t.workspaceId));
    await fencePrivateCopies(tx, ready.t.workspaceId);
    return { ...ready, state, candidates };
  });
  let deleted = 0,
    failed = 0,
    applicationRowsRemoved = 0;
  if (state.phase === "objects") {
    // These exact keys were captured under the same tombstone lock as the
    // authenticated inventory; no later untrusted candidate query is allowed.
    for (const object of candidates) {
      await db.transaction(async (tx) => {
        const now = await replayReady(tx, caseId, "cached");
        if (erasureSealHash(now.seal) !== state.sealHash) throw Error("ERASURE_SEAL_CHANGED");
        assertErasureLocatorScope(t.workspaceId, object.object_key);
      });
      let ok = false;
      try {
        await removeLocator(t.workspaceId, object.object_key, remove);
        ok = true;
        deleted++;
      } catch {
        failed++;
      }
      await recordObjectOutcome(caseId, t.workspaceId, object.object_key, ok);
      if (!ok)
        return { deleted, failed, remaining: true, applicationRowsRemoved, externalSystemsFulfilled: false };
      state = await persistReplay(t, { ...state, cursor: object.object_key });
    }
    if (candidates.length < 10) {
      state = await persistReplay(
        t,
        { ...state, phase: mode === "application" ? 0 : "done" },
        mode === "objects",
      );
    }
    return {
      deleted,
      failed,
      remaining: state.phase !== "done",
      applicationRowsRemoved,
      externalSystemsFulfilled: false,
    };
  }
  if (typeof state.phase === "number") {
    const phase = state.phase;
    await db.transaction(async (tx) => {
      const now = await replayReady(tx, caseId, "cached");
      const persisted = await progressOf(tx, now.t.replayState, now.seal);
      if (persisted.mac !== state.mac) throw new ValoProblem(409, "Recovery progress changed.");
      // One bounded application section; no object inventory rescan/redelete.
      const plan = phasesFor(now.seal);
      const result = await eraseSection(tx, t.workspaceId, plan[phase]!, caseId);
      applicationRowsRemoved = result.rowCount ?? 0;
      if (applicationRowsRemoved < 100)
        state = signReplayState(
          { ...state, phase: phase + 1 === plan.length ? "done" : phase + 1 },
          await privacySigner(tx),
        );
      await tx
        .update(valoPrivacyTombstones)
        .set({
          replayState: state,
          nextReplayAt: new Date(Date.now() + (state.phase === "done" ? 3_600_000 : 0)),
        })
        .where(eq(valoPrivacyTombstones.id, t.id));
      if (state.phase === "done")
        await tx
          .update(valoWorkspaces)
          .set({ profileRevision: 0 })
          .where(eq(valoWorkspaces.id, t.workspaceId));
    });
  }
  return {
    deleted,
    failed,
    remaining: state.phase !== "done",
    applicationRowsRemoved,
    externalSystemsFulfilled: false,
  };
}
export async function replayErasureObjects(caseId: string, remove: DeleteObject = deletePrivateFile) {
  return withErasureLock(caseId, () => replay(caseId, "objects", remove));
}
export async function replayErasedApplication(caseId: string, remove: DeleteObject = deletePrivateFile) {
  return withErasureLock(caseId, () => replay(caseId, "application", remove));
}
/** Existing export-worker reconciliation calls this bounded service. Tombstone
 * keys survive export-row deletion and are revisited even after process death. */
export async function reconcileErasedObjects(remove: DeleteObject = deletePrivateFile, caseId?: string) {
  assertDevelopmentRuntime();
  const due = await db
    .select()
    .from(valoPrivacyTombstones)
    .where(
      and(
        lte(valoPrivacyTombstones.nextReplayAt, new Date()),
        caseId ? eq(valoPrivacyTombstones.caseId, caseId) : undefined,
      ),
    )
    .orderBy(asc(valoPrivacyTombstones.nextReplayAt), asc(valoPrivacyTombstones.id))
    .limit(5);
  let cleaned = 0,
    failed = 0,
    held = 0;
  for (const t of due) {
    try {
      await db.transaction(async (tx) => {
        const seal = await sealOf(tx, t);
        if (!seal.completedEventHash) throw Error("ERASURE_INCOMPLETE");
        if (t.replayState) {
          const s = await progressOf(tx, t.replayState, seal);
          if (s.mode === "application" && s.phase !== "done") throw Error("APPLICATION_REPLAY_ACTIVE");
        }
      });
      const result = await replayErasureObjects(t.caseId, remove);
      cleaned += result.deleted;
      failed += result.failed;
      if (result.failed)
        await db
          .update(valoPrivacyTombstones)
          .set({ nextReplayAt: new Date(Date.now() + 60_000) })
          .where(eq(valoPrivacyTombstones.id, t.id));
    } catch {
      held++;
      // Held legacy/corrupt cases cannot starve the bounded queue forever.
      await db
        .update(valoPrivacyTombstones)
        .set({ nextReplayAt: new Date(Date.now() + 60_000) })
        .where(eq(valoPrivacyTombstones.id, t.id));
    } // Hold/corruption/missing keys never authorize a storage call.
  }
  return { cleaned, failed, held };
}
