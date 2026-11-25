import { randomUUID } from "node:crypto";
import { and, eq, desc, sql } from "drizzle-orm";
import type { db } from "@workspace/db";
import { publicationSchema } from "@workspace/valo-core";
import {
  authorizeWorkspaceRead,
  authorizeWorkspaceWrite,
  limitWorkspaceWrite,
  type WorkspaceActor,
} from "../workspaces";
import { ValoProblem } from "../../platform/valo-problem";
import {
  checkReleaseEvidence,
  liveReleasedVersions,
  lockedLiveVersion,
  projectReleasedCatalogue,
} from "./valo-released-content";
import { recommendTemplates } from "./valo-catalogue";
import { developmentPublicationOnly } from "../publication";
import { singleRow } from "../../platform/rows";
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
async function owner(tx: Tx, actor: WorkspaceActor, lock = true) {
  const { valoMemberships, valoWorkspaces } = await import("@workspace/db");
  // Workspace lock serializes capacity/idempotency on writes; membership lock is taken
  // after waits so a committed revocation wins before the write.
  const baseWorkspace = tx.select().from(valoWorkspaces).where(eq(valoWorkspaces.id, actor.workspaceId));
  const [w] = await (lock ? baseWorkspace.for("update") : baseWorkspace);
  if (lock) await authorizeWorkspaceWrite(tx, actor);
  else await authorizeWorkspaceRead(tx, actor);
  const [m] = await tx
    .select({ role: valoMemberships.role })
    .from(valoMemberships)
    .where(
      and(
        eq(valoMemberships.workspaceId, actor.workspaceId),
        eq(valoMemberships.identityId, actor.identityId),
      ),
    );
  if (!w || w.ownerIdentityId !== actor.identityId || m?.role !== "owner")
    throw new ValoProblem(403, "Only the workspace's owner can save a template or remove a saved one.");
  return w;
}
export async function savedTemplateList(actor: WorkspaceActor) {
  const { db, valoProfileVersions, valoSavedTemplates } = await import("@workspace/db");
  const current = projectReleasedCatalogue(await liveReleasedVersions());
  const currentByTemplate = new Map(
    current.filter((i) => i.type === "template").map((i) => [i.templateId, i]),
  );
  return db.transaction(async (tx) => {
    const w = await owner(tx, actor, false);
    const saved = await tx
      .select()
      .from(valoSavedTemplates)
      .where(eq(valoSavedTemplates.workspaceId, actor.workspaceId))
      .orderBy(desc(valoSavedTemplates.createdAt), valoSavedTemplates.id)
      .limit(200);
    const [profile] = await tx
      .select()
      .from(valoProfileVersions)
      .where(
        and(
          eq(valoProfileVersions.workspaceId, actor.workspaceId),
          eq(valoProfileVersions.revision, w.profileRevision),
        ),
      );
    return {
      items: saved.map((s) => {
        const item = currentByTemplate.get(s.templateId);
        return {
          templateId: s.templateId,
          title: item?.title ?? s.savedTitle,
          savedVersion: s.savedVersion,
          savedAt: s.createdAt.toISOString(),
          available: !!item,
          current: item ?? null,
        };
      }),
      recommendations: recommendTemplates(
        current,
        saved.map((s) => s.templateId),
        profile?.profile.activities,
      ),
      notice:
        "Suggestions use your saved categories and supplied business activities. They do not determine legal duties or grant access to premium files.",
    };
  });
}
/** Saves a template for the workspace's owner once, by its identity, with the title and version it
 * has now. Saving it again saves nothing. */
async function keepSavedTemplate(
  tx: Tx,
  actor: WorkspaceActor,
  saved: { templateId: string; title: string; version: number },
) {
  const { valoEvents, valoSavedTemplates } = await import("@workspace/db");
  await owner(tx, actor);
  const [old] = await tx
    .select()
    .from(valoSavedTemplates)
    .where(
      and(
        eq(valoSavedTemplates.workspaceId, actor.workspaceId),
        eq(valoSavedTemplates.templateId, saved.templateId),
      ),
    );
  if (old) return;
  const count = singleRow(
    await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(valoSavedTemplates)
      .where(eq(valoSavedTemplates.workspaceId, actor.workspaceId)),
  );
  if (count.total >= 200)
    throw new ValoProblem(
      409,
      "Your workspace has 200 saved templates, which is the most it can hold. Remove one before you save another.",
    );
  await limitWorkspaceWrite(tx, actor, "document");
  const savedId = randomUUID();
  await tx.insert(valoSavedTemplates).values({
    id: savedId,
    workspaceId: actor.workspaceId,
    templateId: saved.templateId,
    savedTitle: saved.title,
    savedVersion: saved.version,
  });
  await tx.insert(valoEvents).values({
    id: randomUUID(),
    workspaceId: actor.workspaceId,
    actorId: actor.identityId,
    action: "template.saved",
    entityId: savedId,
    revision: saved.version,
  });
}
export async function saveTemplate(actor: WorkspaceActor, releaseId: string) {
  const { db } = await import("@workspace/db");
  developmentPublicationOnly();
  const release = await checkReleaseEvidence(releaseId);
  await db.transaction(async (tx) => {
    const row = await lockedLiveVersion(tx, release);
    if (publicationSchema.parse(row.bundle).candidate.contentClass !== "general_template")
      throw new ValoProblem(422, "Only a published template can be saved.");
    const item = projectReleasedCatalogue([row])[0]!;
    await keepSavedTemplate(tx, actor, {
      templateId: row.templateId,
      title: item.title,
      version: row.version,
    });
  });
  return savedTemplateList(actor);
}
export async function unsaveTemplate(actor: WorkspaceActor, templateId: string) {
  const { db, valoEvents, valoSavedTemplates } = await import("@workspace/db");
  await db.transaction(async (tx) => {
    await owner(tx, actor);
    const removed = await tx
      .delete(valoSavedTemplates)
      .where(
        and(
          eq(valoSavedTemplates.workspaceId, actor.workspaceId),
          eq(valoSavedTemplates.templateId, templateId),
        ),
      )
      .returning({ id: valoSavedTemplates.id });
    if (removed.length)
      await tx.insert(valoEvents).values({
        id: randomUUID(),
        workspaceId: actor.workspaceId,
        actorId: actor.identityId,
        action: "template.unsaved",
        entityId: removed[0]!.id,
      });
  });
  return savedTemplateList(actor);
}
