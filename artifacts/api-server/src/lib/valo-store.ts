import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  db, valoWorkspaces, valoMemberships, valoProfileVersions, valoDocuments,
  valoDocumentRevisions, valoSupportTickets, valoEvents,
} from "@workspace/db";
import { sha256 } from "@workspace/valo-core";
import { documentInput, documentUpdate, profileInput, ticketInput } from "./valo-validation";
import { z } from "zod";

export class ValoProblem extends Error {
  constructor(public status: number, message: string, public currentRevision?: number) { super(message); }
}
export type WorkspaceActor = { workspaceId: string; identityId: string };
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
function event(tx: Tx, actor: WorkspaceActor, action: string, entityId: string, revision?: number) {
  return tx.insert(valoEvents).values({ id: randomUUID(), workspaceId: actor.workspaceId, actorId: actor.identityId, action, entityId, revision });
}
/** Called only after identity verification; callers cannot choose a workspace. */
export async function resolveWorkspace(identityId: string): Promise<WorkspaceActor> {
  return db.transaction(async tx => {
    const [existing] = await tx.select().from(valoMemberships).where(eq(valoMemberships.identityId, identityId));
    if (existing) {
      if (existing.active !== "yes") throw new ValoProblem(403, "Workspace membership is suspended");
      return { workspaceId: existing.workspaceId, identityId };
    }
    await tx.insert(valoWorkspaces).values({ id: randomUUID(), ownerIdentityId: identityId })
      .onConflictDoNothing({ target: valoWorkspaces.ownerIdentityId });
    const [workspace] = await tx.select().from(valoWorkspaces).where(eq(valoWorkspaces.ownerIdentityId, identityId));
    await tx.insert(valoMemberships).values({
      id: randomUUID(), workspaceId: workspace.id, identityId, role: "owner", active: "yes",
    }).onConflictDoNothing({ target: valoMemberships.identityId });
    const [membership] = await tx.select().from(valoMemberships).where(eq(valoMemberships.identityId, identityId));
    if (membership.active !== "yes") throw new ValoProblem(403, "Workspace membership is suspended");
    return { workspaceId: membership.workspaceId, identityId };
  });
}
export async function getWorkspace(actor: WorkspaceActor) {
  const [workspace] = await db.select().from(valoWorkspaces).where(eq(valoWorkspaces.id, actor.workspaceId));
  if (!workspace) throw new ValoProblem(404, "Workspace not found");
  const [version] = await db.select().from(valoProfileVersions).where(and(
    eq(valoProfileVersions.workspaceId, actor.workspaceId), eq(valoProfileVersions.revision, workspace.profileRevision)));
  const [count] = await db.select({ total: sql<number>`count(*)::int` }).from(valoDocuments)
    .where(eq(valoDocuments.workspaceId, actor.workspaceId));
  return { id: workspace.id, profileRevision: workspace.profileRevision, profile: version?.profile ?? null, documentCount: count.total };
}
export async function saveProfile(actor: WorkspaceActor, raw: unknown) {
  const input = profileInput.parse(raw);
  return db.transaction(async tx => {
    const [workspace] = await tx.select().from(valoWorkspaces).where(eq(valoWorkspaces.id, actor.workspaceId)).for("update");
    if (!workspace) throw new ValoProblem(404, "Workspace not found");
    if (workspace.profileRevision !== input.expectedRevision)
      throw new ValoProblem(409, "Profile changed elsewhere. Reload before saving; your unsaved input has not been applied.", workspace.profileRevision);
    const revision = workspace.profileRevision + 1;
    await tx.insert(valoProfileVersions).values({
      id: randomUUID(), workspaceId: actor.workspaceId, revision, profile: input.profile,
      profileHash: sha256(JSON.stringify(input.profile)), noticeVersion: "development-processing-v1", actorId: actor.identityId,
    });
    await tx.update(valoWorkspaces).set({ profileRevision: revision }).where(eq(valoWorkspaces.id, actor.workspaceId));
    await event(tx, actor, "profile.version_saved", actor.workspaceId, revision);
    const [count] = await tx.select({ total: sql<number>`count(*)::int` }).from(valoDocuments)
      .where(eq(valoDocuments.workspaceId, actor.workspaceId));
    return { id: actor.workspaceId, profileRevision: revision, profile: input.profile, documentCount: count.total };
  });
}
function serialize(document: typeof valoDocuments.$inferSelect, revision: typeof valoDocumentRevisions.$inferSelect) {
  return {
    id: document.id, revisionId: revision.id, title: revision.title, revision: revision.revision, content: revision.content,
    contentHash: revision.contentHash, createdAt: document.createdAt.toISOString(), updatedAt: revision.createdAt.toISOString(),
    status: "business_draft" as const, templateVersion: null,
  };
}
export async function listDocuments(actor: WorkspaceActor) {
  const rows = await db.select({ document: valoDocuments, revision: valoDocumentRevisions }).from(valoDocuments)
    .innerJoin(valoDocumentRevisions, and(
      eq(valoDocumentRevisions.documentId, valoDocuments.id),
      eq(valoDocumentRevisions.workspaceId, actor.workspaceId),
      eq(valoDocumentRevisions.revision, valoDocuments.currentRevision),
    )).where(eq(valoDocuments.workspaceId, actor.workspaceId)).orderBy(desc(valoDocuments.updatedAt)).limit(200);
  return rows.map(({document, revision}) => serialize(document, revision));
}
export async function getDocument(actor: WorkspaceActor, id: string) {
  const [row] = await db.select({ document: valoDocuments, revision: valoDocumentRevisions }).from(valoDocuments)
    .innerJoin(valoDocumentRevisions, and(eq(valoDocumentRevisions.documentId, valoDocuments.id),
      eq(valoDocumentRevisions.workspaceId, actor.workspaceId),
      eq(valoDocumentRevisions.revision, valoDocuments.currentRevision)))
    .where(and(eq(valoDocuments.id, id), eq(valoDocuments.workspaceId, actor.workspaceId)));
  if (!row) throw new ValoProblem(404, "Document not found");
  return serialize(row.document, row.revision);
}
export async function listRevisions(actor: WorkspaceActor, id: string) {
  const [document] = await db.select().from(valoDocuments)
    .where(and(eq(valoDocuments.id, id), eq(valoDocuments.workspaceId, actor.workspaceId)));
  if (!document) throw new ValoProblem(404, "Document not found");
  const revisions = await db.select().from(valoDocumentRevisions).where(and(
    eq(valoDocumentRevisions.documentId, id), eq(valoDocumentRevisions.workspaceId, actor.workspaceId)))
    .orderBy(desc(valoDocumentRevisions.revision));
  return revisions.map(revision => serialize(document, revision));
}
async function appendRevision(tx: Tx, actor: WorkspaceActor, id: string, revision: number, input: z.infer<typeof documentInput>,origin="manual") {
  // The hash binds the title and entire canonical document, not only its visible text.
  await tx.insert(valoDocumentRevisions).values({
    id: randomUUID(), workspaceId: actor.workspaceId, documentId: id, revision,
    title: input.title, content: input.content, contentHash: sha256(JSON.stringify(input)), actorId: actor.identityId,origin,
  });
  await event(tx, actor, "document.revision_saved", id, revision);
}
async function getExactRevision(actor: WorkspaceActor, id: string, revisionNumber: number) {
  const [row] = await db.select({ document: valoDocuments, revision: valoDocumentRevisions }).from(valoDocuments)
    .innerJoin(valoDocumentRevisions, and(eq(valoDocumentRevisions.documentId, valoDocuments.id),
      eq(valoDocumentRevisions.workspaceId, actor.workspaceId),
      eq(valoDocumentRevisions.revision, revisionNumber)))
    .where(and(eq(valoDocuments.id, id), eq(valoDocuments.workspaceId, actor.workspaceId)));
  if (!row) throw new ValoProblem(404, "Document not found");
  return serialize(row.document, row.revision);
}
export async function createDocument(actor: WorkspaceActor, raw: unknown) {
  const id=await db.transaction(tx=>createDocumentInTransaction(tx,actor,raw));
  return getExactRevision(actor,id,1);
}
/** AI acceptance and document creation share one transaction and one tenant check. */
export async function createDocumentInTransaction(tx:Tx,actor:WorkspaceActor,raw:unknown,origin:"manual"|"customer_ai"="manual"){
  const input = documentInput.parse(raw);
  const id = randomUUID();
  const[member]=await tx.select().from(valoMemberships).where(and(eq(valoMemberships.workspaceId,actor.workspaceId),
    eq(valoMemberships.identityId,actor.identityId),eq(valoMemberships.active,"yes"))).for("share");
  if(!member)throw new ValoProblem(403,"Active workspace membership is required");
  await tx.insert(valoDocuments).values({ id, workspaceId: actor.workspaceId, currentRevision: 1 });
  await appendRevision(tx, actor, id, 1, input,origin);
  return id;
}
export async function saveDocument(actor: WorkspaceActor, id: string, raw: unknown) {
  const { expectedRevision, ...input } = documentUpdate.parse(raw);
  await db.transaction(async tx => {
    const [document] = await tx.select().from(valoDocuments).where(and(
      eq(valoDocuments.id, id), eq(valoDocuments.workspaceId, actor.workspaceId))).for("update");
    if (!document) throw new ValoProblem(404, "Document not found");
    if (document.currentRevision !== expectedRevision)
      throw new ValoProblem(409, "Document changed in another tab. Your text was not overwritten; compare with the latest revision.", document.currentRevision);
    const[current]=await tx.select({content:valoDocumentRevisions.content}).from(valoDocumentRevisions)
      .where(and(eq(valoDocumentRevisions.documentId,id),eq(valoDocumentRevisions.workspaceId,actor.workspaceId),
        eq(valoDocumentRevisions.revision,expectedRevision)));
    if(current?.content.financialInput&&!input.content.financialInput)
      throw new ValoProblem(422,"Keep the guided financial model. Create a separate blank draft for unrestricted free-form content.");
    await appendRevision(tx, actor, id, expectedRevision + 1, input);
    await tx.update(valoDocuments).set({ currentRevision: expectedRevision + 1, updatedAt: new Date() })
      .where(and(eq(valoDocuments.id, id), eq(valoDocuments.workspaceId, actor.workspaceId)));
  });
  return getExactRevision(actor, id, expectedRevision + 1);
}
export async function createTicket(actor: WorkspaceActor, raw: unknown) {
  const input = ticketInput.parse(raw);
  const id = randomUUID();
  await db.transaction(async tx => {
    await tx.insert(valoSupportTickets).values({
      id, workspaceId: actor.workspaceId, ...input, consentVersion: "service-sharing-v1", dispatchStatus: "awaiting_staff",
    });
    await event(tx, actor, "support.ticket_saved", id);
  });
  return {
    reference: `VALO-${id}`, message: "Enquiry received and saved. Awaiting staff review; no appointment or external dispatch has been confirmed.",
    dispatchStatus: "awaiting_staff" as const,
  };
}
