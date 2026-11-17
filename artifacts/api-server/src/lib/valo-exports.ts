import { reconcileExportOrphans } from "./valo-export-recovery";
import { serializeRevision } from "./valo-revision-codec";
import { randomUUID } from "node:crypto";
import { and, eq, ne, desc } from "drizzle-orm";
import {
  db,
  runInWorkspaceScope,
  valoMemberships,
  valoDocuments,
  valoDocumentRevisions,
  valoExportJobs,
  valoExportRequests,
  valoFileAssets,
  valoExportObjects,
  valoEvents,
  valoPrivacyTombstones,
} from "@workspace/db";
import { CreateDocumentExportBody, CreateDocumentExportResponse } from "@workspace/api-zod";
import { sha256 } from "@workspace/valo-core";
import { ValoProblem, authorizeWorkspaceWrite, type WorkspaceActor } from "./valo-store";
import { RENDER_VERSION, renderDocument, exportMime } from "./valo-render";
import { readPrivateFile, writePrivateFile, deletePrivateFile } from "./valo-private-storage";
import { documentInput } from "./valo-validation";
import { EXPORT_HEARTBEAT_MS, EXPORT_LEASE_MS, recoverAbandonedExports } from "./valo-export-recovery";
import { assertApplicationRuntime, runtimeEnvironment } from "./valo-runtime-activation";
import {
  EXPORT_EXPIRED,
  exportIsExpired,
  exportRetentionAt,
  retireExpiredExport,
} from "./valo-export-retention";
import { privateCleanupAuthority } from "./valo-private-cleanup-authority";
import { workspaceActorFromRecord } from "../platform/workspace-context";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export function developmentExportsOnly() {
  try {
    assertApplicationRuntime();
  } catch {
    throw new ValoProblem(
      503,
      "Exports remain disabled pending production storage, worker, recovery and privacy approval.",
    );
  }
}
export async function assertExportActor(actor: WorkspaceActor, connection: typeof db | Tx = db) {
  const [membership] = await connection
    .select()
    .from(valoMemberships)
    .where(
      and(
        eq(valoMemberships.workspaceId, actor.workspaceId),
        eq(valoMemberships.identityId, actor.identityId),
        eq(valoMemberships.active, "yes"),
        eq(valoMemberships.role, "owner"),
      ),
    );
  if (!membership) throw new ValoProblem(404, "Export not found or access revoked");
  const [erased] = await connection
    .select({ id: valoPrivacyTombstones.id })
    .from(valoPrivacyTombstones)
    .where(eq(valoPrivacyTombstones.workspaceId, actor.workspaceId))
    .limit(1);
  if (erased) throw new ValoProblem(404, "Export not found or access revoked");
}
function publicJob(
  job: typeof valoExportJobs.$inferSelect,
  asset?: typeof valoFileAssets.$inferSelect | null,
) {
  const expired = job.status === "ready" && exportIsExpired(asset);
  return CreateDocumentExportResponse.parse({
    id: job.id,
    documentId: job.documentId,
    revisionId: job.revisionId,
    revision: job.revision,
    format: job.format,
    renderVersion: job.renderVersion,
    sourceHash: job.sourceHash,
    status: expired ? "failed" : job.status,
    attempts: job.attempts,
    errorCode: expired ? EXPORT_EXPIRED : job.errorCode,
    checksum: asset?.checksum ?? null,
    size: asset?.size ?? null,
    expiresAt: asset?.retentionAt?.toISOString() ?? null,
    downloadUrl: job.status === "ready" && asset && !expired ? `/api/v1/exports/${job.id}/file` : null,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  });
}
export async function getExport(
  actor: WorkspaceActor,
  id: string,
): Promise<{ job: typeof valoExportJobs.$inferSelect; asset: typeof valoFileAssets.$inferSelect | null }> {
  developmentExportsOnly();
  await assertExportActor(actor);
  const [row] = await db
    .select({ job: valoExportJobs, asset: valoFileAssets })
    .from(valoExportJobs)
    .leftJoin(
      valoFileAssets,
      and(eq(valoFileAssets.jobId, valoExportJobs.id), eq(valoFileAssets.workspaceId, actor.workspaceId)),
    )
    .where(and(eq(valoExportJobs.id, id), eq(valoExportJobs.workspaceId, actor.workspaceId)));
  if (!row) throw new ValoProblem(404, "Export not found");
  if (
    ["queued", "running", "retrying"].includes(row.job.status) &&
    Date.now() - row.job.updatedAt.getTime() > EXPORT_LEASE_MS
  ) {
    if (await recoverAbandonedExports(id)) return getExport(actor, id);
  }
  return row;
}
export async function listExports(
  actor: WorkspaceActor,
  documentId: string,
): Promise<ReturnType<typeof publicJob>[]> {
  developmentExportsOnly();
  await assertExportActor(actor);
  const [document] = await db
    .select()
    .from(valoDocuments)
    .where(and(eq(valoDocuments.id, documentId), eq(valoDocuments.workspaceId, actor.workspaceId)));
  if (!document) throw new ValoProblem(404, "Document not found");
  const rows = await db
    .select({ job: valoExportJobs, asset: valoFileAssets })
    .from(valoExportJobs)
    .leftJoin(
      valoFileAssets,
      and(eq(valoFileAssets.jobId, valoExportJobs.id), eq(valoFileAssets.workspaceId, actor.workspaceId)),
    )
    .where(and(eq(valoExportJobs.documentId, documentId), eq(valoExportJobs.workspaceId, actor.workspaceId)))
    .orderBy(desc(valoExportJobs.createdAt))
    .limit(200);
  let recovered = 0;
  for (const { job } of rows)
    if (
      ["queued", "running", "retrying"].includes(job.status) &&
      Date.now() - job.updatedAt.getTime() > EXPORT_LEASE_MS
    )
      recovered += await recoverAbandonedExports(job.id);
  if (recovered) return listExports(actor, documentId);
  return rows.map(({ job, asset }) => publicJob(job, asset));
}
export async function requestExport(actor: WorkspaceActor, documentId: string, key: string, raw: unknown) {
  developmentExportsOnly();
  const input = CreateDocumentExportBody.strict().parse(raw);
  if (!input.acknowledgeDraft)
    throw new ValoProblem(
      422,
      "Deliberately acknowledge the visibly marked incomplete business draft before exporting.",
    );
  const fingerprint = sha256(
    JSON.stringify({
      documentId,
      revisionId: input.revisionId,
      format: input.format,
      renderVersion: RENDER_VERSION,
    }),
  );
  const id = await db.transaction(async (tx) => {
    await assertExportActor(actor, tx);
    const [revision] = await tx
      .select()
      .from(valoDocumentRevisions)
      .where(
        and(
          eq(valoDocumentRevisions.id, input.revisionId),
          eq(valoDocumentRevisions.documentId, documentId),
          eq(valoDocumentRevisions.workspaceId, actor.workspaceId),
        ),
      );
    if (!revision) throw new ValoProblem(404, "Saved document revision not found");
    const [created] = await tx
      .insert(valoExportJobs)
      .values({
        id: randomUUID(),
        workspaceId: actor.workspaceId,
        documentId,
        revisionId: revision.id,
        revision: revision.revision,
        format: input.format,
        renderVersion: RENDER_VERSION,
        sourceHash: revision.contentHash,
        requestedBy: actor.identityId,
        queueId: randomUUID(),
      })
      .onConflictDoNothing()
      .returning();
    const [existing] = created
      ? [created]
      : await tx
          .select()
          .from(valoExportJobs)
          .where(
            and(
              eq(valoExportJobs.workspaceId, actor.workspaceId),
              eq(valoExportJobs.revisionId, revision.id),
              eq(valoExportJobs.format, input.format),
              eq(valoExportJobs.renderVersion, RENDER_VERSION),
            ),
          );
    if (!existing) throw new Error("EXPORT_TRANSACTION_FAILED");
    await authorizeWorkspaceWrite(tx, actor);
    await tx
      .insert(valoExportRequests)
      .values({ workspaceId: actor.workspaceId, key, jobId: existing.id, fingerprint })
      .onConflictDoNothing();
    const [request] = await tx
      .select()
      .from(valoExportRequests)
      .where(and(eq(valoExportRequests.workspaceId, actor.workspaceId), eq(valoExportRequests.key, key)));
    if (request?.fingerprint !== fingerprint)
      throw new ValoProblem(409, "Idempotency-Key was already used for a different revision or format.");
    if (created)
      await tx.insert(valoEvents).values({
        id: randomUUID(),
        workspaceId: actor.workspaceId,
        actorId: actor.identityId,
        action: "export.requested",
        entityId: existing.id,
        revision: revision.revision,
      });
    return existing.id;
  });
  const row = await getExport(actor, id);
  return publicJob(row.job, row.asset);
}
export async function retryExport(actor: WorkspaceActor, id: string) {
  await getExport(actor, id);
  await recoverAbandonedExports(id);
  await db.transaction(async (tx) => {
    await assertExportActor(actor, tx);
    const cleanup = await privateCleanupAuthority(tx, actor.workspaceId);
    const [job] = await tx
      .select()
      .from(valoExportJobs)
      .where(and(eq(valoExportJobs.id, id), eq(valoExportJobs.workspaceId, actor.workspaceId)))
      .for("update");
    if (!job) throw new ValoProblem(404, "Export not found");
    await authorizeWorkspaceWrite(tx, actor);
    const [asset] = await tx.select().from(valoFileAssets).where(eq(valoFileAssets.jobId, id)).for("update");
    const regenerate = job.errorCode === EXPORT_EXPIRED || (job.status === "ready" && exportIsExpired(asset));
    if (regenerate && !cleanup.allowed)
      throw new ValoProblem(409, "Export regeneration is held for privacy review. Your saved draft is safe.");
    if (job.status === "ready" && asset && exportIsExpired(asset)) await retireExpiredExport(tx, job, asset);
    if (job.status !== "failed" && !regenerate) return;
    if (!regenerate && job.retryCycles >= 3)
      throw new ValoProblem(409, "Retry limit reached. Your saved draft is safe; contact support.");
    await tx
      .update(valoExportJobs)
      .set({
        status: "queued",
        attempts: 0,
        leaseRecoveries: 0,
        retryCycles: regenerate ? 0 : job.retryCycles + 1,
        queueId: randomUUID(),
        errorCode: null,
        updatedAt: new Date(),
      })
      .where(eq(valoExportJobs.id, id));
    await tx.insert(valoEvents).values({
      id: randomUUID(),
      workspaceId: actor.workspaceId,
      actorId: actor.identityId,
      action: regenerate ? "export.regeneration_requested" : "export.retry_requested",
      entityId: id,
      revision: job.revision,
    });
  });
  const row = await getExport(actor, id);
  return publicJob(row.job, row.asset);
}
export async function downloadExport(actor: WorkspaceActor, id: string) {
  const { job, asset } = await getExport(actor, id);
  if (job.errorCode === EXPORT_EXPIRED)
    throw new ValoProblem(410, "Export expired. Regenerate it from your saved revision.");
  if (job.status !== "ready" || !asset) throw new ValoProblem(404, "Export is not ready");
  if (exportIsExpired(asset))
    throw new ValoProblem(410, "Export expired. Regenerate it from your saved revision.");
  const bytes = await readPrivateFile(asset.objectKey, asset.checksum);
  if (bytes.length !== asset.size || asset.mime !== exportMime[job.format])
    throw new Error("PRIVATE_FILE_BINDING_MISMATCH");
  await assertExportActor(actor);
  const current = await getExport(actor, id);
  if (current.job.status !== "ready" || current.asset?.id !== asset.id || exportIsExpired(current.asset))
    throw new ValoProblem(
      410,
      "Export availability changed during retrieval. Regenerate it from your saved revision.",
    );
  return { bytes, mime: asset.mime, filename: `valo-business-draft-r${job.revision}.${job.format}` };
}
/** Worker entry: load scoped immutable inputs afresh; never trust queue-supplied document bodies or paths. */
export type ExportStage =
  "claiming" | "claimed" | "rendering" | "uploading" | "uploaded" | "completing" | "completed";
/** Internal instrumentation used by the kill/restart harness; never supplied by API or queue data. */
export async function executeExport(
  id: string,
  workspaceId: string,
  queueId: string,
  onStage?: (stage: ExportStage) => Promise<void>,
  storage: { write: typeof writePrivateFile; remove: typeof deletePrivateFile } = {
    write: writePrivateFile,
    remove: deletePrivateFile,
  },
) {
  developmentExportsOnly();
  const job = await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(valoExportJobs)
      .where(and(eq(valoExportJobs.id, id), eq(valoExportJobs.workspaceId, workspaceId)))
      .for("update");
    if (!row) throw new Error("EXPORT_SCOPE_MISMATCH");
    if (row.queueId !== queueId) return null; // Superseded retry generation: acknowledge without side effects.
    if (row.status === "ready") return row;
    if (row.status === "running" || row.status === "failed") return null;
    if (row.renderVersion !== RENDER_VERSION || row.attempts >= 3) {
      await tx
        .update(valoExportJobs)
        .set({ status: "failed", errorCode: "EXPORT_VERSION_OR_RETRY_LIMIT", updatedAt: new Date() })
        .where(eq(valoExportJobs.id, id));
      return null;
    }
    await tx
      .update(valoExportJobs)
      .set({ status: "running", attempts: row.attempts + 1, updatedAt: new Date() })
      .where(eq(valoExportJobs.id, id));
    await tx.insert(valoEvents).values({
      id: randomUUID(),
      workspaceId,
      actorId: "service:export-worker",
      action: "export.running",
      entityId: id,
      revision: row.revision,
    });
    await onStage?.("claiming");
    return { ...row, attempts: row.attempts + 1 };
  });
  if (!job || job.status === "ready") return;
  const actor = workspaceActorFromRecord({ workspaceId, identityId: job.requestedBy });
  let temporaryKey: string | null = null;
  let heartbeating = false;
  const heartbeat = setInterval(() => {
    if (heartbeating) return;
    heartbeating = true;
    void db
      .update(valoExportJobs)
      .set({ updatedAt: new Date() })
      .where(
        and(
          eq(valoExportJobs.id, id),
          eq(valoExportJobs.queueId, queueId),
          eq(valoExportJobs.status, "running"),
        ),
      )
      .catch(() => {
        /* A missed lease fences this worker at reservation/completion. */
      })
      .finally(() => {
        heartbeating = false;
      });
  }, EXPORT_HEARTBEAT_MS);
  heartbeat.unref();
  const cleanupTemporary = async (key: string) => {
    const cleanup = await db.transaction(async (tx) => {
      // Wait for any ambiguous metadata commit before deciding ownership.
      await tx
        .select({ id: valoExportJobs.id })
        .from(valoExportJobs)
        .where(and(eq(valoExportJobs.id, id), eq(valoExportJobs.workspaceId, workspaceId)))
        .for("update");
      const [asset] = await tx
        .select({ id: valoFileAssets.id })
        .from(valoFileAssets)
        .where(and(eq(valoFileAssets.workspaceId, workspaceId), eq(valoFileAssets.objectKey, key)))
        .limit(1);
      if (asset) return { cleanup: false, privacy: false };
      await tx
        .update(valoExportObjects)
        .set({ state: "cleanup", nextCleanupAt: new Date() })
        .where(and(eq(valoExportObjects.objectKey, key), ne(valoExportObjects.state, "retained")));
      // Erasure may already have removed the job and reservation. Its sealed
      // independent journal captured this key before those rows were purged.
      const [erasure] = await tx
        .select({ id: valoPrivacyTombstones.id })
        .from(valoPrivacyTombstones)
        .where(eq(valoPrivacyTombstones.workspaceId, workspaceId))
        .limit(1);
      // A privacy hold and inventory validation also govern late writes.
      // Its durable worker owns cleanup after quarantine, even with no job.
      return { cleanup: !erasure, privacy: !!erasure };
    });
    // Quarantine locks the tombstone before fencing jobs. Schedule only after
    // releasing job/object locks so cleanup cannot introduce the reverse order.
    if (cleanup.privacy)
      await db
        .update(valoPrivacyTombstones)
        .set({ nextReplayAt: new Date() })
        .where(eq(valoPrivacyTombstones.workspaceId, workspaceId));
    if (cleanup.cleanup)
      try {
        await reconcileExportOrphans(id, storage.remove);
      } catch {
        /* Recorded holds and retryable journals remain authoritative. */
      }
  };
  try {
    await onStage?.("claimed");
    // The document is read in the workspace's database scope, so row-level security also keeps
    // the file to this workspace's rows. The job's claim, storage and result stay with the
    // application role.
    const revision = await runInWorkspaceScope(workspaceId, async () => {
      await assertExportActor(actor);
      const [row] = await db
        .select()
        .from(valoDocumentRevisions)
        .where(
          and(
            eq(valoDocumentRevisions.id, job.revisionId),
            eq(valoDocumentRevisions.workspaceId, workspaceId),
            eq(valoDocumentRevisions.documentId, job.documentId),
          ),
        );
      return row;
    });
    // PostgreSQL JSONB reorders object keys. Reconstruct the same validated v1 input
    // used at save time; never hash raw JSONB serialisation or rewrite historic hashes.
    const savedInput = revision
      ? documentInput.parse({ title: revision.title, content: revision.content })
      : null;
    if (
      !revision ||
      revision.revision !== job.revision ||
      revision.contentHash !== job.sourceHash ||
      sha256(serializeRevision(savedInput!)) !== job.sourceHash
    )
      throw new Error("REVISION_INTEGRITY_FAILED");
    const rendering = renderDocument(savedInput, job.format, job.revision);
    // Only prevents an unhandled rejection while onStage runs; `await rendering` below rethrows it.
    void rendering.catch(() => {});
    await onStage?.("rendering");
    const bytes = await rendering;
    if (bytes.length > 10 * 1024 * 1024) throw new Error("EXPORT_SIZE_LIMIT");
    const assetId = randomUUID();
    const objectKey = `valo/${runtimeEnvironment()}/${workspaceId}/${assetId}.${job.format}`;
    temporaryKey = objectKey;
    await db.transaction(async (tx) => {
      const [current] = await tx.select().from(valoExportJobs).where(eq(valoExportJobs.id, id)).for("update");
      if (!current || current.queueId !== queueId || current.status !== "running")
        throw new Error("EXPORT_SCOPE_MISMATCH");
      await authorizeWorkspaceWrite(tx, actor);
      await tx
        .insert(valoExportObjects)
        .values({ objectKey, workspaceId, jobId: id, queueId, state: "pending" });
    });
    const stored = await storage.write(objectKey, bytes, () => onStage?.("uploading") ?? Promise.resolve());
    await onStage?.("uploaded");
    const committed = await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(valoExportJobs)
        .where(and(eq(valoExportJobs.id, id), eq(valoExportJobs.workspaceId, workspaceId)))
        .for("update");
      if (!current || current.queueId !== queueId) throw new Error("EXPORT_SCOPE_MISMATCH");
      if (current.status === "ready") return false;
      if (current.status !== "running") throw new Error("EXPORT_SCOPE_MISMATCH");
      const [membership] = await tx
        .select()
        .from(valoMemberships)
        .where(
          and(
            eq(valoMemberships.workspaceId, workspaceId),
            eq(valoMemberships.identityId, actor.identityId),
            eq(valoMemberships.active, "yes"),
            eq(valoMemberships.role, "owner"),
          ),
        )
        .for("update");
      if (!membership) throw new Error("EXPORT_ACCESS_REVOKED");
      await authorizeWorkspaceWrite(tx, actor);
      await tx.insert(valoFileAssets).values({
        id: assetId,
        workspaceId,
        jobId: id,
        objectKey,
        ...stored,
        mime: exportMime[job.format],
        retentionAt: exportRetentionAt(),
      });
      await tx
        .update(valoExportObjects)
        .set({ state: "retained" })
        .where(eq(valoExportObjects.objectKey, objectKey));
      await tx
        .update(valoExportJobs)
        .set({ status: "ready", errorCode: null, updatedAt: new Date() })
        .where(and(eq(valoExportJobs.id, id), eq(valoExportJobs.workspaceId, workspaceId)));
      await tx.insert(valoEvents).values({
        id: randomUUID(),
        workspaceId,
        actorId: "service:export-worker",
        action: "export.ready",
        entityId: id,
        revision: job.revision,
      });
      await onStage?.("completing");
      return true;
    });
    if (committed) temporaryKey = null;
    else {
      await cleanupTemporary(objectKey);
      temporaryKey = null;
    }
    await onStage?.("completed");
  } catch (error) {
    if (temporaryKey) {
      const key = temporaryKey;
      await cleanupTemporary(key);
    }
    const message = error instanceof Error ? error.message : "";
    const safe =
      error instanceof ValoProblem && error.status === 404
        ? "EXPORT_ACCESS_REVOKED"
        : [
              "REVISION_INTEGRITY_FAILED",
              "EXPORT_ACCESS_REVOKED",
              "EXPORT_SIZE_LIMIT",
              "PRIVATE_FILE_CHECKSUM_MISMATCH",
              "PRIVATE_FILE_BINDING_MISMATCH",
            ].includes(message)
          ? message
          : "RENDER_OR_STORAGE_UNAVAILABLE";
    await db.transaction(async (tx) => {
      const changed = await tx
        .update(valoExportJobs)
        .set({ status: job.attempts < 3 ? "retrying" : "failed", errorCode: safe, updatedAt: new Date() })
        .where(
          and(
            eq(valoExportJobs.id, id),
            eq(valoExportJobs.workspaceId, workspaceId),
            eq(valoExportJobs.queueId, queueId),
            ne(valoExportJobs.status, "ready"),
          ),
        )
        .returning();
      if (changed.length)
        await tx.insert(valoEvents).values({
          id: randomUUID(),
          workspaceId,
          actorId: "service:export-worker",
          action: job.attempts < 3 ? "export.retrying" : "export.failed",
          entityId: id,
          revision: job.revision,
        });
    });
    throw new Error(safe);
  } finally {
    clearInterval(heartbeat);
  }
}
