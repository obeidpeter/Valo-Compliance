import { serializeRevision } from "./valo-revision-codec";
import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { db, valoDocumentRevisions, valoDocuments } from "@workspace/db";
import { sha256 } from "@workspace/valo-core";
import { documentInput, documentUpdate } from "../../lib/valo-validation";
import { z } from "zod";
import { guidedDataFromBlocks } from "@workspace/valo-core/guided-runtime";
import { ValoProblem } from "../../platform/valo-problem";
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
  if (!row) throw new ValoProblem(404, "Document not found");
  return serialize(row.document, row.revision);
}
export async function listRevisions(actor: WorkspaceActor, id: string) {
  const { db, valoDocumentRevisions, valoDocuments } = await import("@workspace/db");
  const [document] = await db
    .select()
    .from(valoDocuments)
    .where(and(eq(valoDocuments.id, id), eq(valoDocuments.workspaceId, actor.workspaceId)));
  if (!document) throw new ValoProblem(404, "Document not found");
  const revisions = await db
    .select()
    .from(valoDocumentRevisions)
    .where(
      and(eq(valoDocumentRevisions.documentId, id), eq(valoDocumentRevisions.workspaceId, actor.workspaceId)),
    )
    .orderBy(desc(valoDocumentRevisions.revision));
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
  await tx.insert(valoDocumentRevisions).values({
    id: randomUUID(),
    workspaceId: actor.workspaceId,
    documentId: id,
    revision,
    title: input.title,
    content: input.content,
    contentHash: sha256(serializeRevision(input)),
    actorId: actor.identityId,
    origin,
  });
  await recordWorkspaceEvent(tx, actor, "document.revision_saved", id, revision);
}
async function getExactRevision(actor: WorkspaceActor, id: string, revisionNumber: number) {
  const { db, valoDocumentRevisions, valoDocuments } = await import("@workspace/db");
  const [row] = await db
    .select({ document: valoDocuments, revision: valoDocumentRevisions })
    .from(valoDocuments)
    .innerJoin(
      valoDocumentRevisions,
      and(
        eq(valoDocumentRevisions.documentId, valoDocuments.id),
        eq(valoDocumentRevisions.workspaceId, actor.workspaceId),
        eq(valoDocumentRevisions.revision, revisionNumber),
      ),
    )
    .where(and(eq(valoDocuments.id, id), eq(valoDocuments.workspaceId, actor.workspaceId)));
  if (!row) throw new ValoProblem(404, "Document not found");
  return serialize(row.document, row.revision);
}
export async function createDocument(actor: WorkspaceActor, raw: unknown) {
  const { db } = await import("@workspace/db");
  const id = await db.transaction((tx) => createDocumentInTransaction(tx, actor, raw));
  return getExactRevision(actor, id, 1);
}
/** AI acceptance and document creation share one transaction and one tenant check. */
export async function createDocumentInTransaction(
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
  await tx.insert(valoDocuments).values({ id, workspaceId: actor.workspaceId, currentRevision: 1 });
  await appendRevision(tx, actor, id, 1, input, origin);
  return id;
}
export async function saveDocument(actor: WorkspaceActor, id: string, raw: unknown) {
  const { db, valoDocumentRevisions, valoDocuments } = await import("@workspace/db");
  const { expectedRevision, ...input } = documentUpdate.parse(raw);
  await db.transaction(async (tx) => {
    const [document] = await tx
      .select()
      .from(valoDocuments)
      .where(and(eq(valoDocuments.id, id), eq(valoDocuments.workspaceId, actor.workspaceId)))
      .for("update");
    if (!document) throw new ValoProblem(404, "Document not found");
    await authorizeWorkspaceWrite(tx, actor);
    if (document.currentRevision !== expectedRevision)
      throw new ValoProblem(
        409,
        "Document changed in another tab. Your text was not overwritten; compare with the latest revision.",
        document.currentRevision,
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
        "Keep the guided financial model. Create a separate blank draft for unrestricted free-form content.",
      );
    const oldGuided = current ? guidedDataFromBlocks(documentInput.parse(current).content.blocks) : null;
    const nextGuided = guidedDataFromBlocks(input.content.blocks);
    if (oldGuided && oldGuided.templateId !== nextGuided?.templateId)
      throw new ValoProblem(
        422,
        "Keep this draft's versioned guided form. Create a separate blank draft instead of removing required questions.",
      );
    await limitWorkspaceWrite(tx, actor, "document");
    await appendRevision(tx, actor, id, expectedRevision + 1, input);
    await tx
      .update(valoDocuments)
      .set({ currentRevision: expectedRevision + 1, updatedAt: new Date() })
      .where(and(eq(valoDocuments.id, id), eq(valoDocuments.workspaceId, actor.workspaceId)));
  });
  return getExactRevision(actor, id, expectedRevision + 1);
}
