import { randomUUID, createHash } from "node:crypto";
import { clerkClient } from "@clerk/express";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, valoStaffAssignments, valoStaffAccessAudit, valoStaffRoleChanges } from "@workspace/db";
import {
  ChangeStaffRoleBody,
  VerifyStaffRoleTargetBody,
  GetStaffRoleAdministrationQueryParams,
} from "@workspace/api-zod";
import {
  activeStaffAssignment,
  assertStaffAssignmentCurrent,
  requireFreshStaffSession,
  type StaffActor,
} from "./valo-staff-authority";
import { ValoProblem } from "./valo-problem";
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Assignment = typeof valoStaffAssignments.$inferSelect;
type Change = typeof valoStaffRoleChanges.$inferSelect;
export type StaffTarget = {
  id: string;
  label: string;
  banned: boolean;
  locked: boolean;
  verifiedPrimary: boolean;
  verifiedAt: number;
};
type TargetVerifier = (identityId: string) => Promise<StaffTarget>;
const verifyManagedTarget: TargetVerifier = async (id) => {
  const user = await clerkClient.users.getUser(id),
    primary = user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId);
  return {
    id: user.id,
    label: primary?.emailAddress ?? user.id,
    banned: user.banned,
    locked: user.locked,
    verifiedPrimary: primary?.verification?.status === "verified",
    verifiedAt: Date.now(),
  };
};
function assignmentView(row: Assignment) {
  return {
    id: row.id,
    identityId: row.identityId,
    role: row.role,
    active: row.active,
    grantMode: row.grantMode,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    version: row.version,
    grantedBy: row.grantedBy,
    grantedAt: row.grantedAt.toISOString(),
    reason: row.reason,
  };
}
function changeView(row: Change) {
  return {
    id: row.id,
    requestKey: row.requestKey,
    actorId: row.actorId,
    assignmentId: row.assignmentId,
    targetIdentityId: row.targetIdentityId,
    action: row.action,
    role: row.role,
    reason: row.reason,
    incidentReference: row.incidentReference,
    before: row.before,
    after: row.after,
    createdAt: row.createdAt.toISOString(),
  };
}
async function systemAuthority(tx: Tx, actor: StaffActor) {
  requireFreshStaffSession(actor);
  const [row] = await tx
    .select()
    .from(valoStaffAssignments)
    .where(
      and(
        eq(valoStaffAssignments.identityId, actor.identityId),
        eq(valoStaffAssignments.role, "system"),
        activeStaffAssignment(),
        eq(valoStaffAssignments.grantMode, "permanent"),
      ),
    )
    .for("share");
  requireFreshStaffSession(actor);
  if (!row)
    throw new ValoProblem(
      403,
      "A current permanent system assignment is required to administer staff roles. Emergency access cannot grant privileges.",
    );
  await assertStaffAssignmentCurrent(tx, row.id);
  return row;
}
function assertTarget(target: StaffTarget, id: string) {
  if (
    target.id !== id ||
    target.banned ||
    target.locked ||
    !target.verifiedPrimary ||
    !Number.isFinite(target.verifiedAt) ||
    target.verifiedAt > Date.now() + 1000 ||
    Date.now() - target.verifiedAt > 30_000
  )
    throw new ValoProblem(
      403,
      "The selected identity must be an active managed account with a verified primary email. Verify it again.",
    );
}
export function makeStaffRoleService(verifyTarget: TargetVerifier = verifyManagedTarget) {
  return {
    async list(actor: StaffActor, raw: unknown = {}) {
      return db.transaction(async (tx) => {
        const access = await systemAuthority(tx, actor);
        const input = GetStaffRoleAdministrationQueryParams.strict().parse(raw);
        await tx.insert(valoStaffAccessAudit).values({
          id: randomUUID(),
          assignmentId: access.id,
          actorId: actor.identityId,
          area: "system",
          reason: "Read staff assignments and immutable role-change alerts",
        });
        const assignments = await tx
          .select()
          .from(valoStaffAssignments)
          .where(input.identityId ? eq(valoStaffAssignments.identityId, input.identityId) : undefined)
          .orderBy(desc(valoStaffAssignments.grantedAt), valoStaffAssignments.id)
          .limit(250);
        const changes = await tx
          .select()
          .from(valoStaffRoleChanges)
          .where(input.identityId ? eq(valoStaffRoleChanges.targetIdentityId, input.identityId) : undefined)
          .orderBy(desc(valoStaffRoleChanges.createdAt), desc(valoStaffRoleChanges.id))
          .limit(100);
        return {
          assignments: assignments.map(assignmentView),
          changes: changes.map(changeView),
          notice:
            "Role changes are permanent audit records. Emergency permissions expire after at most 60 minutes without a worker. No role bypasses content, privacy or payment safeguards.",
        };
      });
    },
    async target(actor: StaffActor, raw: unknown) {
      await db.transaction((tx) => systemAuthority(tx, actor));
      const input = VerifyStaffRoleTargetBody.strict().parse(raw);
      const target = await verifyTarget(input.identityId);
      assertTarget(target, input.identityId);
      await db.transaction((tx) => systemAuthority(tx, actor));
      // Do not cache eligibility: every grant verifies the provider account again.
      return {
        identityId: target.id,
        label: target.label,
        verifiedAt: new Date(target.verifiedAt).toISOString(),
      };
    },
    async change(actor: StaffActor, raw: unknown) {
      // Refuse callers without system authority before reading their input; the
      // transaction below checks again under its locks.
      await db.transaction((tx) => systemAuthority(tx, actor));
      const input = ChangeStaffRoleBody.strict().parse(raw);
      input.reason = input.reason.trim();
      if (input.reason.length < 20)
        throw new ValoProblem(422, "Explain the role change in at least 20 characters.");
      if (input.action === "grant" && input.identityId === actor.identityId)
        throw new ValoProblem(403, "You cannot grant or renew your own permissions.");
      if (input.action === "grant") {
        if (!input.grantMode) throw new ValoProblem(422, "Choose permanent or emergency access.");
        if (
          input.grantMode === "break_glass" &&
          (!input.durationMinutes || (input.incidentReference?.trim().length ?? 0) < 5)
        )
          throw new ValoProblem(
            422,
            "Emergency access requires a duration of 5–60 minutes and an incident reference.",
          );
        if (
          input.grantMode === "permanent" &&
          (input.durationMinutes !== undefined || input.incidentReference !== undefined)
        )
          throw new ValoProblem(422, "Permanent access must not include emergency expiry fields.");
      } else if (
        input.grantMode !== undefined ||
        input.durationMinutes !== undefined ||
        input.incidentReference !== undefined
      )
        throw new ValoProblem(422, "Revocation must not include grant or expiry fields.");
      const inputHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
      const replay = await db.transaction(async (tx) => {
        await systemAuthority(tx, actor);
        const [prior] = await tx
          .select()
          .from(valoStaffRoleChanges)
          .where(
            and(
              eq(valoStaffRoleChanges.actorId, actor.identityId),
              eq(valoStaffRoleChanges.requestKey, input.requestKey),
            ),
          );
        if (prior && prior.inputHash !== inputHash)
          throw new ValoProblem(409, "This role-change key belongs to different instructions.");
        return prior ? changeView(prior) : null;
      });
      if (replay) return replay;
      const target = input.action === "grant" ? await verifyTarget(input.identityId) : null;
      return db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL lock_timeout='5s'`);
        await tx.execute(sql`SET LOCAL statement_timeout='10s'`);
        // Serialise mutations before taking assignment locks: two concurrent last-admin
        // revocations cannot both rely on the other's soon-to-be-revoked authority.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('valo:staff-role-changes:v1',0))`);
        const authority = await systemAuthority(tx, actor);
        const [prior] = await tx
          .select()
          .from(valoStaffRoleChanges)
          .where(
            and(
              eq(valoStaffRoleChanges.actorId, actor.identityId),
              eq(valoStaffRoleChanges.requestKey, input.requestKey),
            ),
          );
        if (prior) {
          if (prior.inputHash !== inputHash)
            throw new ValoProblem(409, "This role-change key belongs to different instructions.");
          return changeView(prior);
        }
        if (target) assertTarget(target, input.identityId);
        const [old] = await tx
          .select()
          .from(valoStaffAssignments)
          .where(
            and(
              eq(valoStaffAssignments.identityId, input.identityId),
              eq(valoStaffAssignments.role, input.role),
            ),
          )
          .for("update");
        if ((old?.version ?? 0) !== input.expectedVersion)
          throw new ValoProblem(409, "This assignment changed. Refresh and review the current permission.");
        if (input.action === "revoke" && (!old || !old.active))
          throw new ValoProblem(409, "There is no active assignment to revoke.");
        const keepsPermanent = input.action === "grant" && input.grantMode === "permanent";
        if (old?.role === "system" && old.active && old.grantMode === "permanent" && !keepsPermanent) {
          const permanent = await tx
            .select({ id: valoStaffAssignments.id })
            .from(valoStaffAssignments)
            .where(
              and(
                eq(valoStaffAssignments.role, "system"),
                eq(valoStaffAssignments.grantMode, "permanent"),
                activeStaffAssignment(),
              ),
            );
          if (permanent.filter((a) => a.id !== old.id).length === 0)
            throw new ValoProblem(
              409,
              "Keep at least one permanent system administrator. Verify and assign another administrator first.",
            );
        }
        const clock = await tx.execute(sql`SELECT clock_timestamp() AS current_time`),
          now = new Date(String(clock.rows[0].current_time));
        // Target row and last-admin reads may wait: authority and provider eligibility
        // must still be fresh at the actual write boundary, not only before the wait.
        requireFreshStaffSession(actor);
        if (target) assertTarget(target, input.identityId);
        const grant =
          input.action === "grant"
            ? {
                active: true,
                grantMode: input.grantMode!,
                expiresAt:
                  input.grantMode === "break_glass"
                    ? new Date(now.getTime() + input.durationMinutes! * 60_000)
                    : null,
                grantedAt: now,
                grantedBy: actor.identityId,
                reason: input.reason,
              }
            : { active: false, reason: input.reason };
        const [next] = old
          ? await tx
              .update(valoStaffAssignments)
              .set({ ...grant, version: old.version + 1 })
              .where(eq(valoStaffAssignments.id, old.id))
              .returning()
          : await tx
              .insert(valoStaffAssignments)
              .values({
                id: randomUUID(),
                identityId: input.identityId,
                role: input.role,
                ...grant,
                grantedBy: actor.identityId,
                reason: input.reason,
              })
              .returning();
        const [receipt] = await tx
          .insert(valoStaffRoleChanges)
          .values({
            id: randomUUID(),
            requestKey: input.requestKey,
            inputHash,
            actorId: actor.identityId,
            actorAssignmentId: authority.id,
            assignmentId: next.id,
            targetIdentityId: input.identityId,
            action: input.action,
            role: input.role,
            reason: input.reason,
            incidentReference: input.incidentReference?.trim() ?? null,
            before: old ? assignmentView(old) : null,
            after: assignmentView(next),
            targetVerifiedAt: target ? new Date(target.verifiedAt) : null,
          })
          .returning();
        return changeView(receipt);
      });
    },
  };
}
export const staffRoleService = makeStaffRoleService();

export type FirstAdministratorInput = { identityId: string; operator: string; reason: string };
const MANAGED_IDENTITY = /^user_[A-Za-z0-9_-]{1,120}$/;
const OPERATOR_LABEL = /^[A-Za-z0-9._@-]{3,80}$/;

function firstAdministratorInput(raw: FirstAdministratorInput): FirstAdministratorInput {
  const input = { identityId: raw.identityId, operator: raw.operator, reason: raw.reason.trim() };
  if (!MANAGED_IDENTITY.test(input.identityId))
    throw new ValoProblem(422, "Use the managed account's user ID (user_...).");
  if (!OPERATOR_LABEL.test(input.operator))
    throw new ValoProblem(422, "Name the operator with 3-80 letters, digits or . _ @ -.");
  if (input.reason.length < 20 || input.reason.length > 1000)
    throw new ValoProblem(422, "Explain the bootstrap in 20-1000 characters.");
  return input;
}

/**
 * Creates the first permanent system administrator inside an existing transaction.
 * Refuses when any active permanent system administrator exists, so it can never
 * add a second administrator or bypass the audited role service. The role change is
 * recorded like any other; its actor is the named operator and, because no earlier
 * administrator exists, its actor assignment is the new assignment itself.
 */
export async function bootstrapFirstSystemAdministratorIn(
  tx: Tx,
  raw: FirstAdministratorInput,
  target: StaffTarget,
) {
  const input = firstAdministratorInput(raw);
  assertTarget(target, input.identityId);
  await tx.execute(sql`SET LOCAL lock_timeout='5s'`);
  await tx.execute(sql`SET LOCAL statement_timeout='10s'`);
  // Same lock as every role change, so a concurrent grant cannot race the bootstrap.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('valo:staff-role-changes:v1',0))`);
  const permanent = await tx
    .select({ id: valoStaffAssignments.id })
    .from(valoStaffAssignments)
    .where(
      and(
        eq(valoStaffAssignments.role, "system"),
        eq(valoStaffAssignments.grantMode, "permanent"),
        activeStaffAssignment(),
      ),
    );
  if (permanent.length)
    throw new ValoProblem(
      409,
      "A permanent system administrator already exists. Use staff role administration to grant access.",
    );
  const clock = await tx.execute(sql`SELECT clock_timestamp() AS current_time`),
    now = new Date(String(clock.rows[0]!.current_time));
  const actorId = `operator-bootstrap:${input.operator}`;
  const [old] = await tx
    .select()
    .from(valoStaffAssignments)
    .where(
      and(eq(valoStaffAssignments.identityId, input.identityId), eq(valoStaffAssignments.role, "system")),
    )
    .for("update");
  const grant = {
    active: true,
    grantMode: "permanent" as const,
    expiresAt: null,
    grantedAt: now,
    grantedBy: actorId,
    reason: input.reason,
  };
  const [next] = old
    ? await tx
        .update(valoStaffAssignments)
        .set({ ...grant, version: old.version + 1 })
        .where(eq(valoStaffAssignments.id, old.id))
        .returning()
    : await tx
        .insert(valoStaffAssignments)
        .values({ id: randomUUID(), identityId: input.identityId, role: "system", ...grant })
        .returning();
  const [receipt] = await tx
    .insert(valoStaffRoleChanges)
    .values({
      id: randomUUID(),
      requestKey: randomUUID(),
      inputHash: createHash("sha256").update(JSON.stringify(input)).digest("hex"),
      actorId,
      actorAssignmentId: next!.id,
      assignmentId: next!.id,
      targetIdentityId: input.identityId,
      action: "grant",
      role: "system",
      reason: input.reason,
      incidentReference: null,
      before: old ? assignmentView(old) : null,
      after: assignmentView(next!),
      targetVerifiedAt: new Date(target.verifiedAt),
    })
    .returning();
  return changeView(receipt!);
}

/** Operator entry point: verifies the managed account, then bootstraps in one transaction. */
export async function bootstrapFirstSystemAdministrator(
  raw: FirstAdministratorInput,
  verifyTarget: TargetVerifier = verifyManagedTarget,
) {
  const input = firstAdministratorInput(raw);
  const target = await verifyTarget(input.identityId);
  return db.transaction((tx) => bootstrapFirstSystemAdministratorIn(tx, input, target));
}
