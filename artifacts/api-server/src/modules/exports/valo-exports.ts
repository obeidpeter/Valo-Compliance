import { reconcileExportOrphans } from "./valo-export-recovery";
import { checkFormContent, savedVersionGaps, serializeRevision } from "../documents";
import { documentComplete } from "@workspace/valo-core/document-completeness";
import { randomUUID } from "node:crypto";
import { and, eq, gt, isNull, ne, or, desc, sql } from "drizzle-orm";
import {
  db,
  runInWorkspaceScope,
  valoMemberships,
  valoContentVersions,
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
import { authorizeWorkspaceWrite, type WorkspaceActor } from "../workspaces";
import { ValoProblem } from "../../platform/valo-problem";
import { RENDER_VERSION, renderDocument, exportMime } from "../../lib/valo-render";
import { assertWordFileOpens } from "../../lib/word-file-check";
import { readPrivateFile, writePrivateFile, deletePrivateFile } from "../../platform/valo-private-storage";
import { documentInput } from "../../lib/valo-validation";
import { EXPORT_HEARTBEAT_MS, EXPORT_LEASE_MS, recoverAbandonedExports } from "./valo-export-recovery";
import { assertApplicationRuntime, runtimeEnvironment } from "../../platform/valo-runtime-activation";
import {
  EXPORT_EXPIRED,
  exportIsExpired,
  exportRetentionAt,
  retireExpiredExport,
} from "./valo-export-retention";
import { privateCleanupAuthority } from "../privacy";
import { workspaceActorFromRecord } from "../../platform/workspace-context";

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
  if (!membership) throw new ValoProblem(404, "This file was not found, or it can no longer be downloaded.");
  const [erased] = await connection
    .select({ id: valoPrivacyTombstones.id })
    .from(valoPrivacyTombstones)
    .where(eq(valoPrivacyTombstones.workspaceId, actor.workspaceId))
    .limit(1);
  if (erased) throw new ValoProblem(404, "This file was not found, or it can no longer be downloaded.");
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
    finished: job.finished,
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
  allowRecovery = true,
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
  if (!row) throw new ValoProblem(404, "This file was not found.");
  if (
    allowRecovery &&
    ["queued", "running", "retrying"].includes(row.job.status) &&
    Date.now() - row.job.updatedAt.getTime() > EXPORT_LEASE_MS
  ) {
    if (await recoverAbandonedExports(id)) return getExport(actor, id, false);
  }
  return row;
}
export async function listExports(
  actor: WorkspaceActor,
  documentId: string,
  allowRecovery = true,
): Promise<ReturnType<typeof publicJob>[]> {
  developmentExportsOnly();
  await assertExportActor(actor);
  const [document] = await db
    .select()
    .from(valoDocuments)
    .where(and(eq(valoDocuments.id, documentId), eq(valoDocuments.workspaceId, actor.workspaceId)));
  if (!document) throw new ValoProblem(404, "This document was not found in your workspace.");
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
  if (allowRecovery) {
    let recovered = 0;
    for (const { job } of rows)
      if (
        ["queued", "running", "retrying"].includes(job.status) &&
        Date.now() - job.updatedAt.getTime() > EXPORT_LEASE_MS
      )
        recovered += await recoverAbandonedExports(job.id);
    if (recovered) return listExports(actor, documentId, false);
  }
  return rows.map(({ job, asset }) => publicJob(job, asset));
}
/** The staff-library release each of the workspace's copied documents came from, by document. A
 * customer request cannot read the editorial table, so this reads them through its owner's function
 * (docs/architecture/library-entries.md, slice 3). A withdrawn or replaced release is still named: the
 * copy stays its owner's. */
async function libraryCopies() {
  const { rows } = await db.execute<{
    document: string;
    edition: string;
    slug: string;
    title: string;
    version: number;
  }>(sql`select document, edition, slug, title, version from public.valo_workspace_library_editions()`);
  return new Map(rows.map((row) => [row.document, row]));
}
/** A copied document's library release, as the business library names a template version, with the
 * title it was released under: its address name means nothing to a reader. */
const copyTemplate = (copy: { edition: string; slug: string; title: string; version: number } | undefined) =>
  copy ? { versionId: copy.edition, templateId: copy.slug, title: copy.title, version: copy.version } : null;
/** The business library (DOC-005): the workspace's newest ready exports, each with the saved
 * revision it was made from and the template version its document came from. A document keeps
 * that link through every later revision, and whether or not the version is still released. Only
 * files that are ready and unexpired are listed, as only those can be downloaded. */
export async function listWorkspaceExports(actor: WorkspaceActor) {
  developmentExportsOnly();
  await assertExportActor(actor);
  const now = new Date();
  const rows = await db
    .select({
      job: valoExportJobs,
      asset: valoFileAssets,
      title: valoDocumentRevisions.title,
      templateVersionId: valoDocuments.templateVersionId,
      templateId: valoContentVersions.templateId,
      templateVersion: valoContentVersions.version,
    })
    .from(valoExportJobs)
    .innerJoin(
      valoFileAssets,
      and(eq(valoFileAssets.jobId, valoExportJobs.id), eq(valoFileAssets.workspaceId, actor.workspaceId)),
    )
    .innerJoin(
      valoDocuments,
      and(eq(valoDocuments.id, valoExportJobs.documentId), eq(valoDocuments.workspaceId, actor.workspaceId)),
    )
    .innerJoin(
      valoDocumentRevisions,
      and(
        eq(valoDocumentRevisions.id, valoExportJobs.revisionId),
        eq(valoDocumentRevisions.workspaceId, actor.workspaceId),
      ),
    )
    .leftJoin(valoContentVersions, eq(valoContentVersions.id, valoDocuments.templateVersionId))
    .where(
      and(
        eq(valoExportJobs.workspaceId, actor.workspaceId),
        eq(valoExportJobs.status, "ready"),
        or(isNull(valoFileAssets.retentionAt), gt(valoFileAssets.retentionAt, now)),
      ),
    )
    .orderBy(desc(valoFileAssets.createdAt))
    .limit(50);
  // A document copied from a staff-library template names the release it came from
  // (docs/architecture/library-entries.md, slice 3).
  const copies = rows.some((row) => !row.templateVersionId) ? await libraryCopies() : new Map();
  return rows
    .filter(({ asset }) => !exportIsExpired(asset, now.getTime()))
    .map(({ job, asset, title, templateVersionId, templateId, templateVersion }) => ({
      id: job.id,
      documentId: job.documentId,
      documentTitle: title,
      revisionId: job.revisionId,
      revision: job.revision,
      format: job.format,
      finished: job.finished,
      readyAt: asset.createdAt.toISOString(),
      expiresAt: asset.retentionAt?.toISOString() ?? null,
      downloadUrl: `/api/v1/exports/${job.id}/file`,
      template:
        templateVersionId && templateId && templateVersion
          ? { versionId: templateVersionId, templateId, version: templateVersion }
          : copyTemplate(copies.get(job.documentId)),
    }));
}
export async function requestExport(actor: WorkspaceActor, documentId: string, key: string, raw: unknown) {
  developmentExportsOnly();
  const input = CreateDocumentExportBody.strict().parse(raw);
  // A marked draft is made of any saved version once the customer says they want one; otherwise the
  // file asked for is a finished one, made only of a complete version (docs/architecture/finished-file.md).
  const finished = !input.acknowledgeDraft;
  // A marked draft's request is recorded as it always was, so a key used before still matches.
  const fingerprint = sha256(
    JSON.stringify({
      documentId,
      revisionId: input.revisionId,
      format: input.format,
      renderVersion: RENDER_VERSION,
      ...(finished ? { finished } : {}),
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
    if (!revision) throw new ValoProblem(404, "That saved version of the document was not found.");
    if (finished) {
      const gaps = await savedVersionGaps(
        tx,
        documentId,
        documentInput.parse({ title: revision.title, content: revision.content }).content,
      );
      if (!documentComplete(gaps))
        throw new ValoProblem(
          422,
          gaps.kind === "typed"
            ? "A document typed by hand is made as a marked draft: no questions say what it must hold. Say that you want a draft copy to make its file."
            : "This saved version is not complete yet, so its file can only be a marked draft. Give what Still needed lists and save, or say that you want a draft copy.",
        );
    }
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
        finished,
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
              eq(valoExportJobs.finished, finished),
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
      throw new ValoProblem(
        409,
        "This request was already used for a different version or kind of file. Ask for the file again.",
      );
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
    if (!job) throw new ValoProblem(404, "This file was not found.");
    await authorizeWorkspaceWrite(tx, actor);
    const [asset] = await tx.select().from(valoFileAssets).where(eq(valoFileAssets.jobId, id)).for("update");
    const regenerate = job.errorCode === EXPORT_EXPIRED || (job.status === "ready" && exportIsExpired(asset));
    if (regenerate && !cleanup.allowed)
      throw new ValoProblem(
        409,
        cleanup.workspaceHeld
          ? "This file cannot be made again for now, as Valo is keeping this workspace's files as they are. Your saved document is safe."
          : "This file cannot be made again while a privacy request is being reviewed. Your saved document is safe.",
      );
    if (job.status === "ready" && asset && exportIsExpired(asset)) await retireExpiredExport(tx, job, asset);
    if (job.status !== "failed" && !regenerate) return;
    if (!regenerate && job.retryCycles >= 3)
      throw new ValoProblem(
        409,
        "This file has been tried again three times and still failed, so it will not be tried again. Your saved document is safe. Report a problem if you still need the file.",
      );
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
    throw new ValoProblem(410, "This file has expired. Make it again from your saved version.");
  if (job.status !== "ready" || !asset) throw new ValoProblem(404, "This file is not ready yet.");
  if (exportIsExpired(asset))
    throw new ValoProblem(410, "This file has expired. Make it again from your saved version.");
  const bytes = await readPrivateFile(asset.objectKey, asset.checksum);
  if (bytes.length !== asset.size || asset.mime !== exportMime[job.format])
    throw new Error("PRIVATE_FILE_BINDING_MISMATCH");
  await assertExportActor(actor);
  const current = await getExport(actor, id);
  if (current.job.status !== "ready" || current.asset?.id !== asset.id || exportIsExpired(current.asset))
    throw new ValoProblem(
      410,
      "This file stopped being available while it was being fetched. Make it again from your saved version.",
    );
  return { bytes, mime: asset.mime, filename: `valo-business-draft-r${job.revision}.${job.format}` };
}
/** Worker entry: load scoped immutable inputs afresh; never trust queue-supplied document bodies or paths. */
export type ExportStage =
  "claiming" | "claimed" | "rendering" | "uploading" | "uploaded" | "completing" | "completed";
/** Internal instrumentation used by the kill/restart harness; never supplied by API or queue data. A
 * test may also replace the renderer, to make a Word file that fails the check below. */
export async function executeExport(
  id: string,
  workspaceId: string,
  queueId: string,
  onStage?: (stage: ExportStage) => Promise<void>,
  storage: { write: typeof writePrivateFile; remove: typeof deletePrivateFile } = {
    write: writePrivateFile,
    remove: deletePrivateFile,
  },
  render: typeof renderDocument = renderDocument,
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
      // A form document's file prints only what its answers make from the edition it was started
      // with (forms v2): checked again here, before rendering.
      if (row && (row.content as { formAnswers?: unknown }).formAnswers !== undefined) {
        const { valoDocuments } = await import("@workspace/db");
        await db.transaction(async (tx) => {
          const [document] = await tx
            .select({ formDigest: valoDocuments.formDigest })
            .from(valoDocuments)
            .where(and(eq(valoDocuments.id, job.documentId), eq(valoDocuments.workspaceId, workspaceId)));
          if (!document?.formDigest) throw new Error("FORM_RECORD_MISSING");
          await checkFormContent(
            tx,
            { id: job.documentId, formDigest: document.formDigest },
            documentInput.parse({ title: row.title, content: row.content }).content,
          );
        });
      }
      // A finished file is made only of a complete version: checked again here, before rendering.
      if (row && job.finished) {
        const content = documentInput.parse({ title: row.title, content: row.content }).content;
        const complete = await db.transaction(async (tx) =>
          documentComplete(await savedVersionGaps(tx, job.documentId, content)),
        );
        if (!complete) throw new Error("DOCUMENT_INCOMPLETE");
      }
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
    const rendering = render(
      savedInput,
      job.format,
      job.revision,
      job.finished ? "business_finished" : "business_draft",
    );
    // Only prevents an unhandled rejection while onStage runs; `await rendering` below rethrows it.
    void rendering.catch(() => {});
    await onStage?.("rendering");
    const bytes = await rendering;
    if (bytes.length > 10 * 1024 * 1024) throw new Error("EXPORT_SIZE_LIMIT");
    // A Word file is read as Word reads it before it is stored: one Word would refuse is not given to
    // the customer (docs/architecture/editor.md, slice 3).
    if (job.format === "docx") assertWordFileOpens(bytes);
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
              "DOCUMENT_INCOMPLETE",
              "EXPORT_ACCESS_REVOKED",
              "EXPORT_SIZE_LIMIT",
              "WORD_FILE_CHECK_FAILED",
              "PRIVATE_FILE_CHECKSUM_MISMATCH",
              "PRIVATE_FILE_BINDING_MISMATCH",
            ].includes(message)
          ? message
          : "RENDER_OR_STORAGE_UNAVAILABLE";
    await db.transaction(async (tx) => {
      const changed = await tx
        .update(valoExportJobs)
        // An incomplete version stays incomplete, and a Word file that fails the check would be made
        // the same way again: each fails at once.
        .set({
          status:
            job.attempts < 3 && safe !== "DOCUMENT_INCOMPLETE" && safe !== "WORD_FILE_CHECK_FAILED"
              ? "retrying"
              : "failed",
          errorCode: safe,
          updatedAt: new Date(),
        })
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
