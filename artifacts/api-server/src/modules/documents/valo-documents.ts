import { serializeRevision } from "./valo-revision-codec";
import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { db, valoDocumentRevisions, valoDocuments } from "@workspace/db";
import { sha256 } from "@workspace/valo-core";
import { documentInput, documentUpdate } from "../../lib/valo-validation";
import { z } from "zod";
import { guidedDataFromBlocks } from "@workspace/valo-core/guided-runtime";
import { ValoProblem } from "../../platform/valo-problem";
import { singleRow } from "../../platform/rows";
import {
  authorizeWorkspaceWrite,
  limitWorkspaceWrite,
  recordWorkspaceEvent,
  type WorkspaceActor,
} from "../workspaces";
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
function serialize(
  document: typeof valoDocuments.$inferSelect,
  revision: typeof valoDocumentRevisions.$inferSelect,
) {
  return {
    id: document.id,
    revisionId: revision.id,
    title: revision.title,
    revision: revision.revision,
    content: revision.content,
    contentHash: revision.contentHash,
    createdAt: document.createdAt.toISOString(),
    updatedAt: revision.createdAt.toISOString(),
    status: "business_draft" as const,
    templateVersion: document.templateVersionId ?? null,
  };
}
export async function listDocuments(actor: WorkspaceActor) {
  const { db, valoDocumentRevisions, valoDocuments } = await import("@workspace/db");
  const rows = await db
    .select({ document: valoDocuments, revision: valoDocumentRevisions })
    .from(valoDocuments)
    .innerJoin(
      valoDocumentRevisions,
      and(
        eq(valoDocumentRevisions.documentId, valoDocuments.id),
        eq(valoDocumentRevisions.workspaceId, actor.workspaceId),
        eq(valoDocumentRevisions.revision, valoDocuments.currentRevision),
      ),
    )
    .where(eq(valoDocuments.workspaceId, actor.workspaceId))
    .orderBy(desc(valoDocuments.updatedAt))
    .limit(200);
  return rows.map(({ document, revision }) => serialize(document, revision));
}
export async function getDocument(actor: WorkspaceActor, id: string) {
  const { db, valoDocumentRevisions, valoDocuments } = await import("@workspace/db");
  const [row] = await db
    .select({ document: valoDocuments, revision: valoDocumentRevisions })
    .from(valoDocuments)
    .innerJoin(
      valoDocumentRevisions,
      and(
        eq(valoDocumentRevisions.documentId, valoDocuments.id),
        eq(valoDocumentRevisions.workspaceId, actor.workspaceId),
        eq(valoDocumentRevisions.revision, valoDocuments.currentRevision),
      ),
    )
    .where(and(eq(valoDocuments.id, id), eq(valoDocuments.workspaceId, actor.workspaceId)));
  if (!row) throw new ValoProblem(404, "This document was not found in your workspace.");
  return serialize(row.document, row.revision);
}
export async function listRevisions(actor: WorkspaceActor, id: string) {
  const { db, valoDocumentRevisions, valoDocuments } = await import("@workspace/db");
  const [document] = await db
    .select()
    .from(valoDocuments)
    .where(and(eq(valoDocuments.id, id), eq(valoDocuments.workspaceId, actor.workspaceId)));
  if (!document) throw new ValoProblem(404, "This document was not found in your workspace.");
  const revisions = await db
    .select()
    .from(valoDocumentRevisions)
    .where(
      and(eq(valoDocumentRevisions.documentId, id), eq(valoDocumentRevisions.workspaceId, actor.workspaceId)),
    )
    .orderBy(desc(valoDocumentRevisions.revision))
    .limit(100);
  return revisions.map((revision) => serialize(document, revision));
}
async function appendRevision(
  tx: Tx,
  actor: WorkspaceActor,
  id: string,
  revision: number,
  input: z.infer<typeof documentInput>,
  origin = "manual",
) {
  const { valoDocumentRevisions } = await import("@workspace/db");
  // The hash binds the title and entire canonical document, not only its visible text.
  const created = singleRow(
    await tx
      .insert(valoDocumentRevisions)
      .values({
        id: randomUUID(),
        workspaceId: actor.workspaceId,
        documentId: id,
        revision,
        title: input.title,
        content: input.content,
        contentHash: sha256(serializeRevision(input)),
        actorId: actor.identityId,
        origin,
      })
      .returning(),
  );
  await recordWorkspaceEvent(tx, actor, "document.revision_saved", id, revision);
  return created;
}
async function createDocumentRecordInTransaction(
  tx: Tx,
  actor: WorkspaceActor,
  raw: unknown,
  origin: "manual" | "customer_ai" = "manual",
) {
  const { valoDocuments } = await import("@workspace/db");
  const input = documentInput.parse(raw);
  const id = randomUUID();
  await authorizeWorkspaceWrite(tx, actor);
  await limitWorkspaceWrite(tx, actor, "document");
  const document = singleRow(
    await tx
      .insert(valoDocuments)
      .values({ id, workspaceId: actor.workspaceId, currentRevision: 1 })
      .returning(),
  );
  const revision = await appendRevision(tx, actor, id, 1, input, origin);
  return { document, revision };
}
export async function createDocument(actor: WorkspaceActor, raw: unknown) {
  const { db } = await import("@workspace/db");
  const { document, revision } = await db.transaction((tx) =>
    createDocumentRecordInTransaction(tx, actor, raw),
  );
  return serialize(document, revision);
}
/** AI acceptance and document creation share one transaction and one tenant check. */
export async function createDocumentInTransaction(
  tx: Tx,
  actor: WorkspaceActor,
  raw: unknown,
  origin: "manual" | "customer_ai" = "manual",
) {
  return (await createDocumentRecordInTransaction(tx, actor, raw, origin)).document.id;
}
export async function saveDocument(actor: WorkspaceActor, id: string, raw: unknown) {
  const { db, valoDocumentRevisions, valoDocuments } = await import("@workspace/db");
  const { expectedRevision, ...input } = documentUpdate.parse(raw);
  const { document, revision } = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(valoDocuments)
      .where(and(eq(valoDocuments.id, id), eq(valoDocuments.workspaceId, actor.workspaceId)))
      .for("update");
    if (!existing) throw new ValoProblem(404, "This document was not found in your workspace.");
    await authorizeWorkspaceWrite(tx, actor);
    if (existing.currentRevision !== expectedRevision)
      throw new ValoProblem(
        409,
        "This document was saved somewhere else after you opened it. Your text was not overwritten. Compare it with the newest version.",
        existing.currentRevision,
      );
    const [current] = await tx
      .select({ title: valoDocumentRevisions.title, content: valoDocumentRevisions.content })
      .from(valoDocumentRevisions)
      .where(
        and(
          eq(valoDocumentRevisions.documentId, id),
          eq(valoDocumentRevisions.workspaceId, actor.workspaceId),
          eq(valoDocumentRevisions.revision, expectedRevision),
        ),
      );
    if (current?.content.financialInput && !input.content.financialInput)
      throw new ValoProblem(
        422,
        "This document's amounts are worked out by Valo and cannot be taken out of it. To write without them, start a blank document.",
      );
    const oldGuided = current ? guidedDataFromBlocks(documentInput.parse(current).content.blocks) : null;
    const nextGuided = guidedDataFromBlocks(input.content.blocks);
    if (oldGuided && oldGuided.templateId !== nextGuided?.templateId)
      throw new ValoProblem(
        422,
        "This document is made from a set of questions, and they cannot be taken out of it. To write without them, start a blank document.",
      );
    await limitWorkspaceWrite(tx, actor, "document");
    const savedRevision = await appendRevision(tx, actor, id, expectedRevision + 1, input);
    const updatedDocument = singleRow(
      await tx
        .update(valoDocuments)
        .set({ currentRevision: expectedRevision + 1, updatedAt: new Date() })
        .where(and(eq(valoDocuments.id, id), eq(valoDocuments.workspaceId, actor.workspaceId)))
        .returning(),
    );
    return { document: updatedDocument, revision: savedRevision };
  });
  return serialize(document, revision);
}
