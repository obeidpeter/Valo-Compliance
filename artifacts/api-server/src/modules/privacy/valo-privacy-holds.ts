import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db, valoPrivacyHolds, valoStaffAccessAudit, valoWorkspaces } from "@workspace/db";
import { PlacePrivacyHoldBody, ReleasePrivacyHoldBody } from "@workspace/api-zod";
import { ValoProblem } from "../../platform/valo-problem";
import { requirePrivacyStaff, type PrivacyStaffActor } from "./valo-privacy";
import { privacyHoldsReady } from "./valo-workspace-hold";

/**
 * A hold of its own on a workspace, apart from any privacy request (PRV-003;
 * docs/architecture/privacy-requests.md, slice 4). Privacy staff place it with a reason and another
 * member of privacy staff releases it with one. While it stands, Valo's own deletion of the workspace's
 * data stops (valo-workspace-hold.ts). The database keeps each hold for good: it takes one change, its
 * release, and is never removed.
 */
type HoldRow = typeof valoPrivacyHolds.$inferSelect;

const NOT_READY =
  "Workspace holds cannot be placed or released yet: a database update is waiting to be applied. Nothing was changed.";

/** A PostgreSQL error's code and constraint, through the driver's wrapper. */
function pgError(error: unknown) {
  const e = error as { cause?: { code?: string; constraint?: string }; code?: string; constraint?: string };
  return e.cause ?? e;
}

/** What staff see of a hold. Who placed and released it is shown only as whether it was the reader. */
function holdRecord(row: HoldRow, identityId: string) {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    reason: row.reason,
    placedAt: row.placedAt.toISOString(),
    placedByYou: row.placedBy === identityId,
    released: row.releasedAt !== null,
    releasedAt: row.releasedAt?.toISOString() ?? null,
    releaseReason: row.releaseReason,
    releasedByYou: row.releasedBy === identityId,
  };
}

/** A reason of ten to a thousand characters, once trimmed. */
function holdReason(raw: string, missing: string) {
  const reason = raw.trim();
  if (reason.length < 10 || reason.length > 1000) throw new ValoProblem(422, missing);
  return reason;
}

/** The holds, the standing ones first, then the most recently placed: up to 100. */
export async function listPrivacyHolds(actor: PrivacyStaffActor) {
  return db.transaction(async (tx) => {
    const role = await requirePrivacyStaff(tx, actor);
    if (!(await privacyHoldsReady(tx))) return { ready: false, items: [] };
    const rows = await tx
      .select()
      .from(valoPrivacyHolds)
      .orderBy(
        sql`${valoPrivacyHolds.releasedAt} IS NOT NULL`,
        desc(valoPrivacyHolds.placedAt),
        desc(valoPrivacyHolds.id),
      )
      .limit(100);
    await tx.insert(valoStaffAccessAudit).values({
      id: randomUUID(),
      assignmentId: role.id,
      actorId: actor.identityId,
      area: "privacy",
      object: "privacy_holds",
      reason: "Viewed the holds on workspaces, with their reasons.",
    });
    return { ready: true, items: rows.map((row) => holdRecord(row, actor.identityId)) };
  });
}

/** Places a hold on a workspace, with why. A workspace has at most one standing hold. */
export async function placePrivacyHold(actor: PrivacyStaffActor, raw: unknown) {
  const input = PlacePrivacyHoldBody.strict().parse(raw);
  const reason = holdReason(input.reason, "Say why the workspace is held, in 10 to 1,000 characters.");
  return db.transaction(async (tx) => {
    await requirePrivacyStaff(tx, actor);
    if (!(await privacyHoldsReady(tx))) throw new ValoProblem(503, NOT_READY);
    const [workspace] = await tx
      .select({ id: valoWorkspaces.id })
      .from(valoWorkspaces)
      .where(eq(valoWorkspaces.id, input.workspaceId));
    if (!workspace) throw new ValoProblem(404, "No workspace has that ID. Check it and try again.");
    const [standing] = await tx
      .select({ id: valoPrivacyHolds.id })
      .from(valoPrivacyHolds)
      .where(and(eq(valoPrivacyHolds.workspaceId, input.workspaceId), isNull(valoPrivacyHolds.releasedAt)))
      .limit(1);
    const already = new ValoProblem(
      409,
      "This workspace is already held. Its hold stands until another member of privacy staff releases it.",
    );
    if (standing) throw already;
    try {
      const [row] = await tx
        .insert(valoPrivacyHolds)
        .values({ workspaceId: input.workspaceId, reason, placedBy: actor.identityId })
        .returning();
      return holdRecord(row!, actor.identityId);
    } catch (error) {
      // Another hold placed on the same workspace at the same moment.
      if (pgError(error).constraint === "valo_privacy_hold_standing") throw already;
      throw error;
    }
  });
}

/**
 * Releases a standing hold, with why. Another member of privacy staff than the one who placed it releases
 * it: the design's proposal, until the privacy owner decides (the owner's point 3).
 */
export async function releasePrivacyHold(actor: PrivacyStaffActor, id: string, raw: unknown) {
  const input = ReleasePrivacyHoldBody.strict().parse(raw);
  const reason = holdReason(input.reason, "Say why the hold is released, in 10 to 1,000 characters.");
  return db.transaction(async (tx) => {
    await requirePrivacyStaff(tx, actor);
    if (!(await privacyHoldsReady(tx))) throw new ValoProblem(503, NOT_READY);
    const [row] = await tx.select().from(valoPrivacyHolds).where(eq(valoPrivacyHolds.id, id)).for("update");
    if (!row) throw new ValoProblem(404, "This hold was not found.");
    if (row.releasedAt) throw new ValoProblem(409, "This hold has already been released.");
    if (row.placedBy === actor.identityId)
      throw new ValoProblem(403, "Another member of privacy staff releases a hold you placed.");
    const [released] = await tx
      .update(valoPrivacyHolds)
      .set({ releasedBy: actor.identityId, releasedAt: sql`now()`, releaseReason: reason })
      .where(eq(valoPrivacyHolds.id, id))
      .returning();
    return holdRecord(released!, actor.identityId);
  });
}
