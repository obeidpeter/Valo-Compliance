import {serializeRevision} from "./valo-revision-codec";
import { randomUUID } from "node:crypto";
import { and, desc, eq, sql, inArray } from "drizzle-orm";
import {
  db, valoWorkspaces, valoMemberships, valoProfileVersions, valoDocuments,
  valoDocumentRevisions, valoSupportTickets, valoEvents, valoPrivacyTombstones,
} from "@workspace/db";
import { sha256 } from "@workspace/valo-core";
import { documentInput, documentUpdate, profileInput, ticketInput } from "./valo-validation";
import { z } from "zod";
import {guidedDataFromBlocks} from "@workspace/valo-core/guided-runtime";
import { consumeQuota,quotaPolicy,quotaSubjectHash } from "./valo-quota";

import {ValoProblem} from "./valo-problem";
import {privacyIdentityHashes} from "./valo-privacy-keys";
export {ValoProblem} from "./valo-problem";
export type WorkspaceActor = { workspaceId: string; identityId: string };
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** Acquire after potentially blocking resource locks, immediately before writing.
 * Revocation committed while a request waited must win. Holding this row lock
 * makes the eventual write/revocation order linearizable until commit. */
export async function authorizeWorkspaceWrite(tx:Tx,actor:WorkspaceActor){
  const[member]=await tx.select().from(valoMemberships).where(and(
    eq(valoMemberships.workspaceId,actor.workspaceId),eq(valoMemberships.identityId,actor.identityId))).for("share");
  if(!member||member.active!=="yes")throw new ValoProblem(403,"Active workspace membership is required. No changes were saved.");
  const[deleted]=await tx.select({id:valoPrivacyTombstones.id}).from(valoPrivacyTombstones)
    .where(eq(valoPrivacyTombstones.workspaceId,actor.workspaceId)).limit(1);
  if(deleted)throw new ValoProblem(403,"Workspace deletion is recorded. No changes were saved.");
}
export async function limitWorkspaceWrite(tx:Tx,actor:WorkspaceActor,operation:"profile"|"document"|"support"){
  const key=quotaSubjectHash(process.env.SESSION_SECRET,"user",actor.identityId);
  for(const window of["minute","day"]as const){
    const bucket=`${operation}-write${window==="day"?"-day":""}` as keyof typeof quotaPolicy;
    const q=await consumeQuota(bucket,key,quotaPolicy[bucket],window,tx);
    if(!q.allowed)throw new ValoProblem(429,`Write limit reached. Retry in ${q.retryAfter} seconds. Previously saved work is unchanged; keep your unsaved input.`,undefined,q.retryAfter);
  }
}
function event(tx: Tx, actor: WorkspaceActor, action: string, entityId: string, revision?: number) {
  return tx.insert(valoEvents).values({ id: randomUUID(), workspaceId: actor.workspaceId, actorId: actor.identityId, action, entityId, revision });
}
/** Called only after identity verification; callers cannot choose a workspace. */
export async function resolveWorkspace(identityId: string): Promise<WorkspaceActor> {
  return db.transaction(async tx => {
    const hashes=await privacyIdentityHashes(tx,identityId);
    const[erasedIdentity]=hashes.length?await tx.select({id:valoPrivacyTombstones.id}).from(valoPrivacyTombstones)
      .where(inArray(valoPrivacyTombstones.identityHash,hashes)).limit(1):[];
    if(erasedIdentity)throw new ValoProblem(403,"Identity deletion is recorded. Access cannot be recreated.");
    const [existing] = await tx.select().from(valoMemberships).where(eq(valoMemberships.identityId, identityId));
    if (existing) {
      const[deleted]=await tx.select({id:valoPrivacyTombstones.id}).from(valoPrivacyTombstones)
        .where(eq(valoPrivacyTombstones.workspaceId,existing.workspaceId)).limit(1);
      if(deleted)throw new ValoProblem(403,"Workspace deletion is recorded. Access cannot be recreated.");
      if (existing.active !== "yes") throw new ValoProblem(403, "Workspace membership is suspended");
      return { workspaceId: existing.workspaceId, identityId };
    }
    await tx.insert(valoWorkspaces).values({ id: randomUUID(), ownerIdentityId: identityId })
      .onConflictDoNothing({ target: valoWorkspaces.ownerIdentityId });
    const [workspace] = await tx.select().from(valoWorkspaces).where(eq(valoWorkspaces.ownerIdentityId, identityId));
    const[deleted]=await tx.select({id:valoPrivacyTombstones.id}).from(valoPrivacyTombstones)
      .where(eq(valoPrivacyTombstones.workspaceId,workspace.id)).limit(1);
    if(deleted)throw new ValoProblem(403,"Workspace deletion is recorded. Access cannot be recreated.");
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
    await authorizeWorkspaceWrite(tx,actor);
    if (workspace.profileRevision !== input.expectedRevision)
      throw new ValoProblem(409, "Profile changed elsewhere. Reload before saving; your unsaved input has not been applied.", workspace.profileRevision);
    await limitWorkspaceWrite(tx,actor,"profile");
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
    status: "business_draft" as const, templateVersion: document.templateVersionId ?? null,
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
    title: input.title, content: input.content, contentHash: sha256(serializeRevision(input)), actorId: actor.identityId,origin,
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
  await authorizeWorkspaceWrite(tx,actor);
  await limitWorkspaceWrite(tx,actor,"document");
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
    await authorizeWorkspaceWrite(tx,actor);
    if (document.currentRevision !== expectedRevision)
      throw new ValoProblem(409, "Document changed in another tab. Your text was not overwritten; compare with the latest revision.", document.currentRevision);
    const[current]=await tx.select({title:valoDocumentRevisions.title,content:valoDocumentRevisions.content}).from(valoDocumentRevisions)
      .where(and(eq(valoDocumentRevisions.documentId,id),eq(valoDocumentRevisions.workspaceId,actor.workspaceId),
        eq(valoDocumentRevisions.revision,expectedRevision)));
    if(current?.content.financialInput&&!input.content.financialInput)
      throw new ValoProblem(422,"Keep the guided financial model. Create a separate blank draft for unrestricted free-form content.");
    const oldGuided=current?guidedDataFromBlocks(documentInput.parse(current).content.blocks):null;
    const nextGuided=guidedDataFromBlocks(input.content.blocks);
    if(oldGuided&&oldGuided.templateId!==nextGuided?.templateId)
      throw new ValoProblem(422,"Keep this draft's versioned guided form. Create a separate blank draft instead of removing required questions.");
    await limitWorkspaceWrite(tx,actor,"document");
    await appendRevision(tx, actor, id, expectedRevision + 1, input);
    await tx.update(valoDocuments).set({ currentRevision: expectedRevision + 1, updatedAt: new Date() })
      .where(and(eq(valoDocuments.id, id), eq(valoDocuments.workspaceId, actor.workspaceId)));
  });
  return getExactRevision(actor, id, expectedRevision + 1);
}
export async function createTicket(actor: WorkspaceActor, raw: unknown) {
  return db.transaction(tx=>createTicketInTransaction(tx,actor,raw));
}
/** Shared transaction lets a privacy request and its support reference commit together. */
export async function createTicketInTransaction(tx:Tx,actor:WorkspaceActor,raw:unknown){
  const input = ticketInput.parse(raw);
  const id = randomUUID();
    await authorizeWorkspaceWrite(tx,actor);
    await limitWorkspaceWrite(tx,actor,"support");
    await tx.insert(valoSupportTickets).values({
      id, workspaceId: actor.workspaceId, ...input, consentVersion: "service-sharing-v1", dispatchStatus: "awaiting_staff",
    });
    await event(tx, actor, "support.ticket_saved", id);
  return {
    reference: `VALO-${id}`, message: "Enquiry received and saved. Awaiting staff review; no appointment or external dispatch has been confirmed.",
    dispatchStatus: "awaiting_staff" as const,
  };
}
