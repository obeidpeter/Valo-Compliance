import { randomUUID } from "node:crypto";
import { and, eq, sql, inArray } from "drizzle-orm";
import type { db } from "@workspace/db";
import { sha256 } from "@workspace/valo-core";
import { profileInput } from "../../lib/valo-validation";
import { consumeQuota, quotaPolicy, quotaSubjectHash } from "../../lib/valo-quota";
import { setting } from "../../platform/settings";
import { ValoProblem } from "../../platform/valo-problem";
import { privacyIdentityHashes } from "../../lib/valo-privacy-keys";
import { workspaceActorFromMembership, type WorkspaceActor } from "../../platform/workspace-context";
import { singleRow } from "../../platform/rows";
export type { WorkspaceActor };
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** Read authorization must not retain a membership SHARE lock during a long
 * snapshot. Call using a current, separate transaction at each page boundary. */
export async function authorizeWorkspaceRead(tx: Tx, actor: WorkspaceActor) {
  const { valoMemberships, valoPrivacyTombstones } = await import("@workspace/db");
  const [member] = await tx
    .select()
    .from(valoMemberships)
    .where(
      and(
        eq(valoMemberships.workspaceId, actor.workspaceId),
        eq(valoMemberships.identityId, actor.identityId),
      ),
    );
  if (!member || member.active !== "yes")
    throw new ValoProblem(403, "Your account does not have access to this workspace.");
  const [deleted] = await tx
    .select({ id: valoPrivacyTombstones.id })
    .from(valoPrivacyTombstones)
    .where(eq(valoPrivacyTombstones.workspaceId, actor.workspaceId))
    .limit(1);
  if (deleted) throw new ValoProblem(403, "Workspace deletion is recorded. Access is unavailable.");
}
/** Acquire after potentially blocking resource locks, immediately before writing.
 * Revocation committed while a request waited must win. Holding this row lock
 * makes the eventual write/revocation order linearizable until commit. */
export async function authorizeWorkspaceWrite(tx: Tx, actor: WorkspaceActor) {
  const { valoMemberships, valoPrivacyTombstones } = await import("@workspace/db");
  const [member] = await tx
    .select()
    .from(valoMemberships)
    .where(
      and(
        eq(valoMemberships.workspaceId, actor.workspaceId),
        eq(valoMemberships.identityId, actor.identityId),
      ),
    )
    .for("share");
  if (!member || member.active !== "yes")
    throw new ValoProblem(403, "Your account does not have access to this workspace. No changes were saved.");
  const [deleted] = await tx
    .select({ id: valoPrivacyTombstones.id })
    .from(valoPrivacyTombstones)
    .where(eq(valoPrivacyTombstones.workspaceId, actor.workspaceId))
    .limit(1);
  if (deleted) throw new ValoProblem(403, "Workspace deletion is recorded. No changes were saved.");
}
export async function limitWorkspaceWrite(
  tx: Tx,
  actor: WorkspaceActor,
  operation: "profile" | "document" | "support",
) {
  const key = quotaSubjectHash(setting("SESSION_SECRET"), "user", actor.identityId);
  for (const window of ["minute", "day"] as const) {
    const bucket = `${operation}-write${window === "day" ? "-day" : ""}` as keyof typeof quotaPolicy;
    const q = await consumeQuota(bucket, key, quotaPolicy[bucket], window, tx);
    if (!q.allowed)
      throw new ValoProblem(
        429,
        `Too many changes in a short time. Try again in ${q.retryAfter} seconds. Your saved work is unchanged. Keep this page open so that you do not lose what you have typed.`,
        undefined,
        q.retryAfter,
      );
  }
}
/** Appends to the workspace's audit trail, which profiles, documents and support tickets all write. */
export async function recordWorkspaceEvent(
  tx: Tx,
  actor: WorkspaceActor,
  action: string,
  entityId: string,
  revision?: number,
) {
  const { valoEvents } = await import("@workspace/db");
  return tx.insert(valoEvents).values({
    id: randomUUID(),
    workspaceId: actor.workspaceId,
    actorId: actor.identityId,
    action,
    entityId,
    revision,
  });
}
/** Checks erasure tombstones and existing workspace membership without creating a workspace. */
export async function assertAccountNotErasedOrSuspended(identityId: string): Promise<void> {
  const { db, valoMemberships, valoPrivacyTombstones } = await import("@workspace/db");
  await db.transaction(async (tx) => {
    const hashes = await privacyIdentityHashes(tx, identityId);
    const [erasedIdentity] = hashes.length
      ? await tx
          .select({ id: valoPrivacyTombstones.id })
          .from(valoPrivacyTombstones)
          .where(inArray(valoPrivacyTombstones.identityHash, hashes))
          .limit(1)
      : [];
    if (erasedIdentity)
      throw new ValoProblem(403, "Identity deletion is recorded. Access cannot be recreated.");
    const [existing] = await tx
      .select({ workspaceId: valoMemberships.workspaceId, active: valoMemberships.active })
      .from(valoMemberships)
      .where(eq(valoMemberships.identityId, identityId));
    if (!existing) return;
    const [deleted] = await tx
      .select({ id: valoPrivacyTombstones.id })
      .from(valoPrivacyTombstones)
      .where(eq(valoPrivacyTombstones.workspaceId, existing.workspaceId))
      .limit(1);
    if (deleted) throw new ValoProblem(403, "Workspace deletion is recorded. Access cannot be recreated.");
    if (existing.active !== "yes") throw new ValoProblem(403, "Your access to this workspace is suspended.");
  });
}
/** Called only after identity verification; callers cannot choose a workspace. */
export async function resolveWorkspace(identityId: string): Promise<WorkspaceActor> {
  const { db, valoMemberships, valoPrivacyTombstones, valoWorkspaces } = await import("@workspace/db");
  return db.transaction(async (tx) => {
    const hashes = await privacyIdentityHashes(tx, identityId);
    const [erasedIdentity] = hashes.length
      ? await tx
          .select({ id: valoPrivacyTombstones.id })
          .from(valoPrivacyTombstones)
          .where(inArray(valoPrivacyTombstones.identityHash, hashes))
          .limit(1)
      : [];
    if (erasedIdentity)
      throw new ValoProblem(403, "Identity deletion is recorded. Access cannot be recreated.");
    const [existing] = await tx
      .select()
      .from(valoMemberships)
      .where(eq(valoMemberships.identityId, identityId));
    if (existing) {
      const [deleted] = await tx
        .select({ id: valoPrivacyTombstones.id })
        .from(valoPrivacyTombstones)
        .where(eq(valoPrivacyTombstones.workspaceId, existing.workspaceId))
        .limit(1);
      if (deleted) throw new ValoProblem(403, "Workspace deletion is recorded. Access cannot be recreated.");
      if (existing.active !== "yes")
        throw new ValoProblem(403, "Your access to this workspace is suspended.");
      return workspaceActorFromMembership({ workspaceId: existing.workspaceId, identityId });
    }
    await tx
      .insert(valoWorkspaces)
      .values({ id: randomUUID(), ownerIdentityId: identityId })
      .onConflictDoNothing({ target: valoWorkspaces.ownerIdentityId });
    const workspace = singleRow(
      await tx.select().from(valoWorkspaces).where(eq(valoWorkspaces.ownerIdentityId, identityId)),
    );
    const [deleted] = await tx
      .select({ id: valoPrivacyTombstones.id })
      .from(valoPrivacyTombstones)
      .where(eq(valoPrivacyTombstones.workspaceId, workspace.id))
      .limit(1);
    if (deleted) throw new ValoProblem(403, "Workspace deletion is recorded. Access cannot be recreated.");
    await tx
      .insert(valoMemberships)
      .values({
        id: randomUUID(),
        workspaceId: workspace.id,
        identityId,
        role: "owner",
        active: "yes",
      })
      .onConflictDoNothing({ target: valoMemberships.identityId });
    const membership = singleRow(
      await tx.select().from(valoMemberships).where(eq(valoMemberships.identityId, identityId)),
    );
    if (membership.active !== "yes")
      throw new ValoProblem(403, "Your access to this workspace is suspended.");
    return workspaceActorFromMembership({ workspaceId: membership.workspaceId, identityId });
  });
}
export async function getWorkspace(actor: WorkspaceActor) {
  const { db, valoDocuments, valoProfileVersions, valoWorkspaces } = await import("@workspace/db");
  const [workspace] = await db.select().from(valoWorkspaces).where(eq(valoWorkspaces.id, actor.workspaceId));
  if (!workspace) throw new ValoProblem(404, "Your workspace was not found.");
  const [version] = await db
    .select()
    .from(valoProfileVersions)
    .where(
      and(
        eq(valoProfileVersions.workspaceId, actor.workspaceId),
        eq(valoProfileVersions.revision, workspace.profileRevision),
      ),
    );
  const count = singleRow(
    await db
      .select({ total: sql<number>`count(*)::int` })
      .from(valoDocuments)
      .where(eq(valoDocuments.workspaceId, actor.workspaceId)),
  );
  return {
    id: workspace.id,
    profileRevision: workspace.profileRevision,
    profile: version?.profile ?? null,
    documentCount: count.total,
  };
}
export async function saveProfile(actor: WorkspaceActor, raw: unknown) {
  const { db, valoDocuments, valoProfileVersions, valoWorkspaces } = await import("@workspace/db");
  const input = profileInput.parse(raw);
  return db.transaction(async (tx) => {
    const [workspace] = await tx
      .select()
      .from(valoWorkspaces)
      .where(eq(valoWorkspaces.id, actor.workspaceId))
      .for("update");
    if (!workspace) throw new ValoProblem(404, "Your workspace was not found.");
    await authorizeWorkspaceWrite(tx, actor);
    if (workspace.profileRevision !== input.expectedRevision)
      throw new ValoProblem(
        409,
        "Your business profile was changed somewhere else after you opened it. Reload it before you save. What you typed has not been saved.",
        workspace.profileRevision,
      );
    await limitWorkspaceWrite(tx, actor, "profile");
    const revision = workspace.profileRevision + 1;
    await tx.insert(valoProfileVersions).values({
      id: randomUUID(),
      workspaceId: actor.workspaceId,
      revision,
      profile: input.profile,
      profileHash: sha256(JSON.stringify(input.profile)),
      noticeVersion: "development-processing-v1",
      actorId: actor.identityId,
    });
    await tx
      .update(valoWorkspaces)
      .set({ profileRevision: revision })
      .where(eq(valoWorkspaces.id, actor.workspaceId));
    await recordWorkspaceEvent(tx, actor, "profile.version_saved", actor.workspaceId, revision);
    const count = singleRow(
      await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(valoDocuments)
        .where(eq(valoDocuments.workspaceId, actor.workspaceId)),
    );
    return {
      id: actor.workspaceId,
      profileRevision: revision,
      profile: input.profile,
      documentCount: count.total,
    };
  });
}
