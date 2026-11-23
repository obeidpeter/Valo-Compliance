import { randomUUID, createHash } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { canonical } from "@workspace/valo-core";
import {
  db,
  valoSupportCases,
  valoSupportTickets,
  valoAccessSupport,
  valoSupportMessages,
  valoSupportEvents,
  valoSupportActions,
  valoSupportEscalations,
  valoStaffAssignments,
  valoStaffAccessAudit,
  valoWorkspaces,
  valoPrivacyTombstones,
  valoContentVersions,
  valoRuleReleases,
} from "@workspace/db";
import { ValoProblem } from "../../platform/valo-problem";
import {
  authorizeWorkspaceRead,
  authorizeWorkspaceWrite,
  limitWorkspaceWrite,
  type WorkspaceActor,
} from "../workspaces";
import { consumeQuota, quotaSubjectHash } from "../../lib/valo-quota";
import { setting } from "../../platform/settings";
import {
  activeStaffAssignment,
  assertStaffAssignmentCurrent,
  requireFreshStaffSession,
  type StaffActor,
} from "../staff";
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Case = typeof valoSupportCases.$inferSelect;
export type SupportStaffActor = StaffActor;
const body = z.string().trim().min(8).max(4000),
  base = { idempotencyKey: z.string().uuid(), expectedVersion: z.number().int().min(1) };
export const supportReplySchema = z.object({ ...base, body }).strict();
export const supportActionSchema = z.discriminatedUnion("action", [
  z.object({ ...base, action: z.literal("assign"), assigneeId: z.string().trim().min(1).max(200) }).strict(),
  ...(["reply", "resolve", "reopen"] as const).map((action) =>
    z.object({ ...base, action: z.literal(action), body }).strict(),
  ),
  z
    .object({
      ...base,
      action: z.literal("escalate_content"),
      body,
      targetKind: z.enum(["content", "rule"]),
      targetId: z.string().uuid(),
    })
    .strict(),
]);
const pageValue = (v: unknown) => z.coerce.number().int().min(1).max(10000).default(1).parse(v);
const statuses = z.enum(["all", "open", "in_progress", "awaiting_customer", "resolved"]);
const hash = (v: unknown) => createHash("sha256").update(canonical(v)).digest("hex");
async function currentSupportStaff(tx: Tx, actor: SupportStaffActor, role: "support" | "content") {
  requireFreshStaffSession(actor);
  const [row] = await tx
    .select({ id: valoStaffAssignments.id })
    .from(valoStaffAssignments)
    .where(
      and(
        eq(valoStaffAssignments.identityId, actor.identityId),
        eq(valoStaffAssignments.role, role),
        activeStaffAssignment(),
      ),
    );
  if (!row) throw new ValoProblem(403, "An active, unexpired staff assignment for this area is required.");
}
export async function requireSupportStaff(
  tx: Tx,
  actor: SupportStaffActor,
  role: "support" | "content" = "support",
) {
  requireFreshStaffSession(actor);
  const [row] = await tx
    .select()
    .from(valoStaffAssignments)
    .where(
      and(
        eq(valoStaffAssignments.identityId, actor.identityId),
        eq(valoStaffAssignments.role, role),
        activeStaffAssignment(),
      ),
    )
    .for("share");
  if (!row) throw new ValoProblem(403, "An active staff assignment for this area is required.");
  // A row-lock wait must not extend wall-clock authority or session freshness.
  await assertStaffAssignmentCurrent(tx, row.id);
  requireFreshStaffSession(actor);
  await tx.insert(valoStaffAccessAudit).values({
    id: randomUUID(),
    assignmentId: row.id,
    actorId: actor.identityId,
    area: role,
    reason: "Support lifecycle access after current role and recent verified MFA checks",
  });
  return row;
}
async function privateWorkspace(tx: Tx, id: string, lock = true) {
  const base = tx.select({ id: valoWorkspaces.id }).from(valoWorkspaces).where(eq(valoWorkspaces.id, id));
  const [row] = await (lock ? base.for("update") : base);
  const [erased] = await tx
    .select({ id: valoPrivacyTombstones.id })
    .from(valoPrivacyTombstones)
    .where(eq(valoPrivacyTombstones.workspaceId, id));
  if (!row || erased)
    throw new ValoProblem(
      404,
      "This workspace is no longer available, so its support requests cannot be opened.",
    );
}
async function readCase(tx: Tx, id: string, workspaceId?: string) {
  const [row] = await tx
    .select()
    .from(valoSupportCases)
    .where(
      and(
        eq(valoSupportCases.id, id),
        workspaceId ? eq(valoSupportCases.workspaceId, workspaceId) : undefined,
      ),
    );
  if (!row) throw new ValoProblem(404, "This support request was not found.");
  if (row.workspaceId) await privateWorkspace(tx, row.workspaceId, false);
  return row;
}
async function lockedCase(tx: Tx, id: string, workspaceId?: string) {
  const [first] = await tx
    .select()
    .from(valoSupportCases)
    .where(
      and(
        eq(valoSupportCases.id, id),
        workspaceId ? eq(valoSupportCases.workspaceId, workspaceId) : undefined,
      ),
    );
  if (!first) throw new ValoProblem(404, "This support request was not found.");
  // Same workspace-before-case order as privacy quarantine; final status is
  // checked after the lock, so queued staff replies cannot recreate erased data.
  if (first.workspaceId) await privateWorkspace(tx, first.workspaceId, true);
  const [row] = await tx.select().from(valoSupportCases).where(eq(valoSupportCases.id, id)).for("update");
  if (!row) throw new ValoProblem(404, "This support request was not found.");
  return row;
}
type SourceSummary = {
  reference: string;
  category: string;
  scope: string;
  contactEmail: string;
  sharingConsent: boolean;
};
async function source(tx: Tx, row: Case, lock = true): Promise<SourceSummary> {
  if (row.sourceKind === "workspace") {
    const base = tx
      .select()
      .from(valoSupportTickets)
      .where(
        and(eq(valoSupportTickets.id, row.ticketId!), eq(valoSupportTickets.workspaceId, row.workspaceId!)),
      );
    const [r] = await (lock ? base.for("share") : base);
    if (!r) throw new ValoProblem(404, "This support request can no longer be opened.");
    return {
      reference: `VALO-${r.id}`,
      category: r.category,
      scope: r.scope,
      contactEmail: r.contactEmail,
      sharingConsent: r.sharingConsent,
    };
  }
  const base = tx.select().from(valoAccessSupport).where(eq(valoAccessSupport.id, row.accessId!));
  const [r] = await (lock ? base.for("share") : base);
  if (!r) throw new ValoProblem(404, "This support request can no longer be opened.");
  return {
    reference: `VALO-ACCESS-${r.id}`,
    category: r.topic,
    scope: r.message,
    contactEmail: r.contactEmail,
    sharingConsent: false,
  };
}
async function sourcesFor(tx: Tx, rows: Case[]) {
  const ticketIds = [
    ...new Set(rows.filter((r) => r.sourceKind === "workspace" && r.ticketId).map((r) => r.ticketId!)),
  ];
  const accessIds = [
    ...new Set(rows.filter((r) => r.sourceKind !== "workspace" && r.accessId).map((r) => r.accessId!)),
  ];
  const tickets = ticketIds.length
    ? await tx.select().from(valoSupportTickets).where(inArray(valoSupportTickets.id, ticketIds))
    : [];
  const access = accessIds.length
    ? await tx.select().from(valoAccessSupport).where(inArray(valoAccessSupport.id, accessIds))
    : [];
  const ticketByKey = new Map(tickets.map((r) => [`${r.workspaceId}:${r.id}`, r]));
  const accessById = new Map(access.map((r) => [r.id, r]));
  return rows.map((row): SourceSummary => {
    if (row.sourceKind === "workspace") {
      const r = ticketByKey.get(`${row.workspaceId}:${row.ticketId}`);
      if (!r) throw new ValoProblem(404, "This support request can no longer be opened.");
      return {
        reference: `VALO-${r.id}`,
        category: r.category,
        scope: r.scope,
        contactEmail: r.contactEmail,
        sharingConsent: r.sharingConsent,
      };
    }
    const r = accessById.get(row.accessId!);
    if (!r) throw new ValoProblem(404, "This support request can no longer be opened.");
    return {
      reference: `VALO-ACCESS-${r.id}`,
      category: r.topic,
      scope: r.message,
      contactEmail: r.contactEmail,
      sharingConsent: false,
    };
  });
}
async function detail(tx: Tx, row: Case, staff: boolean, messagesPage = 1, lockSource = true) {
  const original = await source(tx, row, lockSource),
    messages = await tx
      .select({
        id: valoSupportMessages.id,
        body: valoSupportMessages.body,
        createdAt: valoSupportMessages.createdAt,
        authorKind: valoSupportMessages.authorKind,
        visibility: valoSupportMessages.visibility,
      })
      .from(valoSupportMessages)
      .where(
        and(
          eq(valoSupportMessages.caseId, row.id),
          staff ? undefined : eq(valoSupportMessages.visibility, "customer"),
        ),
      )
      .orderBy(desc(valoSupportMessages.createdAt), desc(valoSupportMessages.id))
      .limit(51)
      .offset((messagesPage - 1) * 50);
  const events = staff
    ? await tx
        .select()
        .from(valoSupportEvents)
        .where(eq(valoSupportEvents.caseId, row.id))
        .orderBy(desc(valoSupportEvents.createdAt), desc(valoSupportEvents.id))
        .limit(51)
    : [];
  const escalations = staff
    ? await tx
        .select()
        .from(valoSupportEscalations)
        .where(eq(valoSupportEscalations.caseId, row.id))
        .orderBy(desc(valoSupportEscalations.createdAt), desc(valoSupportEscalations.id))
        .limit(51)
    : [];
  return {
    case: {
      id: row.id,
      sourceKind: row.sourceKind,
      ...original,
      status: row.status,
      version: row.version,
      ...(staff ? { assignedTo: row.assignedTo } : {}),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    },
    messages: messages.slice(0, 50).reverse(),
    messagesPage,
    messagePageSize: 50,
    moreMessages: messages.length > 50,
    ...(staff
      ? {
          events: events.slice(0, 50),
          eventsTruncated: events.length > 50,
          escalations: escalations.slice(0, 50),
          escalationsTruncated: escalations.length > 50,
        }
      : {}),
    notice:
      row.sourceKind === "access"
        ? "Replies are saved for staff only. No email or external message has been sent. Account ownership has not been inferred."
        : "Replies are available in this private workspace. No email, appointment, professional review or external referral is implied.",
  };
}
async function list(tx: Tx, filter: ReturnType<typeof and>, page: number) {
  const rows = await tx
    .select()
    .from(valoSupportCases)
    .where(filter)
    .orderBy(desc(valoSupportCases.updatedAt), desc(valoSupportCases.id))
    .limit(26)
    .offset((page - 1) * 25);
  const pageRows = rows.slice(0, 25);
  const originals = await sourcesFor(tx, pageRows);
  const cases = pageRows.map((row, index) => ({
    id: row.id,
    sourceKind: row.sourceKind,
    reference: originals[index]!.reference,
    category: originals[index]!.category,
    status: row.status,
    version: row.version,
    assignedTo: row.assignedTo,
    updatedAt: row.updatedAt,
  }));
  return {
    cases,
    page,
    pageSize: 25,
    hasMore: rows.length > 25,
    notice: "Saved support workflow. Replies and decisions are durable; no external dispatch is enabled.",
  };
}
export async function customerSupportCases(actor: WorkspaceActor, rawPage?: unknown) {
  const page = pageValue(rawPage);
  return db.transaction(async (tx) => {
    await privateWorkspace(tx, actor.workspaceId, false);
    await authorizeWorkspaceRead(tx, actor);
    const result = await list(tx, eq(valoSupportCases.workspaceId, actor.workspaceId), page);
    return { ...result, cases: result.cases.map(({ assignedTo: _staff, ...c }) => c) };
  });
}
export async function customerSupportCase(actor: WorkspaceActor, id: string, rawPage?: unknown) {
  const page = pageValue(rawPage);
  return db.transaction(async (tx) => {
    const row = await readCase(tx, id, actor.workspaceId);
    await authorizeWorkspaceRead(tx, actor);
    return detail(tx, row, false, page, false);
  });
}
async function replay(
  tx: Tx,
  row: Case,
  actorId: string,
  input: { idempotencyKey: string; expectedVersion: number },
) {
  const [old] = await tx
    .select()
    .from(valoSupportActions)
    .where(
      and(
        eq(valoSupportActions.caseId, row.id),
        eq(valoSupportActions.actorId, actorId),
        eq(valoSupportActions.idempotencyKey, input.idempotencyKey),
      ),
    );
  if (old) {
    if (old.payloadHash !== hash(input))
      throw new ValoProblem(
        409,
        "This was already sent once in a different form. Reload the page and try again.",
      );
    return true;
  }
  if (row.version !== input.expectedVersion)
    throw new ValoProblem(
      409,
      "This request was changed somewhere else after you opened it. Reload it to see what changed. What you sent has not been saved.",
      row.version,
    );
  return false;
}
async function change(
  tx: Tx,
  row: Case,
  actorId: string,
  input: { idempotencyKey: string; expectedVersion: number },
  action: string,
  update: Partial<Pick<Case, "status" | "assignedTo">>,
) {
  await tx.insert(valoSupportActions).values({
    id: randomUUID(),
    caseId: row.id,
    actorId,
    idempotencyKey: input.idempotencyKey,
    payloadHash: hash(input),
  });
  await tx.insert(valoSupportEvents).values({ id: randomUUID(), caseId: row.id, actorId, action });
  const [changed] = await tx
    .update(valoSupportCases)
    .set({ ...update, version: row.version + 1, updatedAt: new Date() })
    .where(eq(valoSupportCases.id, row.id))
    .returning();
  return changed!;
}
async function message(tx: Tx, row: Case, actorId: string, authorKind: "customer" | "staff", text: string) {
  await tx.insert(valoSupportMessages).values({
    id: randomUUID(),
    caseId: row.id,
    workspaceId: row.workspaceId,
    authorId: actorId,
    authorKind,
    visibility: row.sourceKind === "workspace" ? "customer" : "internal",
    body: text,
  });
}
export async function replyToSupportCase(actor: WorkspaceActor, id: string, raw: unknown) {
  const input = supportReplySchema.parse(raw);
  return db.transaction(async (tx) => {
    let row = await lockedCase(tx, id, actor.workspaceId);
    await authorizeWorkspaceWrite(tx, actor);
    if (await replay(tx, row, actor.identityId, input)) return detail(tx, row, false);
    await limitWorkspaceWrite(tx, actor, "support");
    await message(tx, row, actor.identityId, "customer", input.body);
    row = await change(tx, row, actor.identityId, input, "customer_replied", {
      status: row.assignedTo ? "in_progress" : "open",
    });
    return detail(tx, row, false);
  });
}
export async function staffSupportCases(actor: SupportStaffActor, rawStatus?: unknown, rawPage?: unknown) {
  const status = statuses.default("all").parse(rawStatus),
    page = pageValue(rawPage);
  return db.transaction(async (tx) => {
    await requireSupportStaff(tx, actor);
    return list(
      tx,
      and(
        status === "all" ? undefined : eq(valoSupportCases.status, status),
        sql`NOT EXISTS (SELECT 1 FROM valo_privacy_tombstones p WHERE p.workspace_id=${valoSupportCases.workspaceId})`,
      ),
      page,
    );
  });
}
export async function supportAssignees(actor: SupportStaffActor) {
  return db.transaction(async (tx) => {
    await requireSupportStaff(tx, actor);
    const assignees = await tx
      .select({ identityId: valoStaffAssignments.identityId })
      .from(valoStaffAssignments)
      .where(and(eq(valoStaffAssignments.role, "support"), activeStaffAssignment()))
      .orderBy(valoStaffAssignments.identityId)
      .limit(201);
    if (assignees.length > 200)
      throw new ValoProblem(409, "Assignment directory needs a narrower staff search.");
    return { assignees };
  });
}
export async function staffSupportCase(actor: SupportStaffActor, id: string, rawPage?: unknown) {
  const page = pageValue(rawPage);
  return db.transaction(async (tx) => {
    await requireSupportStaff(tx, actor);
    return detail(tx, await readCase(tx, id), true, page, false);
  });
}
export async function actOnSupportCase(actor: SupportStaffActor, id: string, raw: unknown) {
  const input = supportActionSchema.parse(raw);
  return db.transaction(async (tx) => {
    await requireSupportStaff(tx, actor);
    let row = await lockedCase(tx, id);
    await currentSupportStaff(tx, actor, "support");
    if (await replay(tx, row, actor.identityId, input)) return detail(tx, row, true);
    for (const [bucket, limit, window] of [
      ["support-write", 20, "minute"],
      ["support-write-day", 200, "day"],
    ] as const) {
      const q = await consumeQuota(
        bucket,
        quotaSubjectHash(setting("SESSION_SECRET"), "user", `support-staff:${actor.identityId}`),
        limit,
        window,
        tx,
      );
      if (!q.allowed)
        throw new ValoProblem(
          429,
          "Support action rate limit reached; keep your draft and retry later.",
          undefined,
          q.retryAfter,
        );
    }
    await currentSupportStaff(tx, actor, "support");
    if (input.action === "reopen") {
      if (row.status !== "resolved") throw new ValoProblem(409, "Only resolved cases can be reopened.");
      await message(tx, row, actor.identityId, "staff", input.body);
      row = await change(tx, row, actor.identityId, input, "staff_reopened", {
        status: row.assignedTo ? "in_progress" : "open",
      });
    } else {
      if (row.status === "resolved")
        throw new ValoProblem(409, "Reopen this case before making further changes.");
      if (input.action === "assign") {
        const [assignee] = await tx
          .select()
          .from(valoStaffAssignments)
          .where(
            and(
              eq(valoStaffAssignments.identityId, input.assigneeId),
              eq(valoStaffAssignments.role, "support"),
              activeStaffAssignment(),
            ),
          )
          .for("share");
        if (!assignee) throw new ValoProblem(422, "Choose an active support staff member.");
        const [stillActive] = await tx
          .select({ id: valoStaffAssignments.id })
          .from(valoStaffAssignments)
          .where(and(eq(valoStaffAssignments.id, assignee.id), activeStaffAssignment()));
        if (!stillActive)
          throw new ValoProblem(
            422,
            "The selected support assignment expired while waiting. Choose an active colleague.",
          );
        await currentSupportStaff(tx, actor, "support");
        row = await change(tx, row, actor.identityId, input, "staff_assigned", {
          assignedTo: input.assigneeId,
          status: row.status === "open" ? "in_progress" : row.status,
        });
      } else if (input.action === "escalate_content") {
        if (row.sourceKind !== "workspace")
          throw new ValoProblem(
            422,
            "Use an authenticated workspace request for internal content triage. Account-access intake does not establish ownership.",
          );
        const target =
          input.targetKind === "content"
            ? (
                await tx
                  .select({ hash: valoContentVersions.candidateHash, version: valoContentVersions.version })
                  .from(valoContentVersions)
                  .where(eq(valoContentVersions.id, input.targetId))
                  .for("share")
              )[0]
            : (
                await tx
                  .select({ hash: valoRuleReleases.manifestHash, version: valoRuleReleases.version })
                  .from(valoRuleReleases)
                  .where(eq(valoRuleReleases.id, input.targetId))
                  .for("share")
              )[0];
        if (!target) throw new ValoProblem(404, "The exact content or rule version is unavailable.");
        await currentSupportStaff(tx, actor, "support");
        await tx.insert(valoSupportEscalations).values({
          id: randomUUID(),
          caseId: row.id,
          targetKind: input.targetKind,
          targetId: input.targetId,
          targetHash: target.hash,
          targetVersion: target.version,
          reason: input.body,
        });
        row = await change(tx, row, actor.identityId, input, "content_triage_requested", {});
      } else {
        await message(tx, row, actor.identityId, "staff", input.body);
        row = await change(
          tx,
          row,
          actor.identityId,
          input,
          input.action === "resolve" ? "staff_resolved" : "staff_replied",
          {
            status:
              input.action === "resolve"
                ? "resolved"
                : row.sourceKind === "workspace"
                  ? "awaiting_customer"
                  : "in_progress",
          },
        );
      }
    }
    return detail(tx, row, true);
  });
}
export const contentTriageSchema = z
  .object({ ...base, action: z.enum(["acknowledge", "resolve", "hold_and_reassess"]), body })
  .strict();
export async function contentSupportEscalations(actor: SupportStaffActor, rawPage?: unknown) {
  const page = pageValue(rawPage);
  return db.transaction(async (tx) => {
    await requireSupportStaff(tx, actor, "content");
    const rows = await tx
      .select({
        escalation: valoSupportEscalations,
        caseVersion: valoSupportCases.version,
        ticketId: valoSupportCases.ticketId,
      })
      .from(valoSupportEscalations)
      .innerJoin(valoSupportCases, eq(valoSupportCases.id, valoSupportEscalations.caseId))
      .where(
        sql`NOT EXISTS (SELECT 1 FROM valo_privacy_tombstones p WHERE p.workspace_id=${valoSupportCases.workspaceId})`,
      )
      .orderBy(desc(valoSupportEscalations.createdAt), desc(valoSupportEscalations.id))
      .limit(26)
      .offset((page - 1) * 25);
    return {
      escalations: rows
        .slice(0, 25)
        .map((r) => ({ ...r.escalation, caseVersion: r.caseVersion, reference: `VALO-${r.ticketId}` })),
      page,
      pageSize: 25,
      hasMore: rows.length > 25,
      notice:
        "Content triage only. Acknowledgement or resolution does not approve publication. Hold and reassess uses the existing source authority and queues a separate review; no AI call or message is dispatched.",
    };
  });
}
export async function actOnContentSupportEscalation(actor: SupportStaffActor, id: string, raw: unknown) {
  const input = { ...contentTriageSchema.parse(raw), escalationId: id };
  const sourceReason = `Support content triage ${id}; request ${hash(input)}. Reassess the exact referred version.`;
  const prepared = await db.transaction(async (tx) => {
    await requireSupportStaff(tx, actor, "content");
    const [e] = await tx.select().from(valoSupportEscalations).where(eq(valoSupportEscalations.id, id));
    if (!e) throw new ValoProblem(404, "Content escalation not found.");
    const row = await lockedCase(tx, e.caseId);
    await currentSupportStaff(tx, actor, "content");
    let replayRow = row,
      recoveringHold = false;
    if (input.action === "hold_and_reassess" && row.version !== input.expectedVersion) {
      const prior = (
        await tx.execute(sql`SELECT actor_id,action,reason,current FROM valo_safety_control_audit
        WHERE request_key=${input.idempotencyKey}::uuid`)
      ).rows[0];
      const current = prior?.current as
        { kind?: unknown; id?: unknown; version?: unknown; impactId?: unknown } | undefined;
      if (
        prior?.actor_id === actor.identityId &&
        prior.action === "hold_version" &&
        prior.reason === sourceReason &&
        current?.kind === e.targetKind &&
        current.id === e.targetId &&
        current.version === e.targetVersion &&
        typeof current.impactId === "string"
      ) {
        replayRow = { ...row, version: input.expectedVersion };
        recoveringHold = true;
      }
    }
    if (await replay(tx, replayRow, actor.identityId, input))
      return { replayed: true as const, escalation: e, caseVersion: row.version };
    if (e.status === "resolved" && !recoveringHold)
      throw new ValoProblem(409, "This content triage is already resolved.");
    const target =
      e.targetKind === "content"
        ? (
            await tx
              .select({ hash: valoContentVersions.candidateHash, version: valoContentVersions.version })
              .from(valoContentVersions)
              .where(eq(valoContentVersions.id, e.targetId))
          )[0]
        : (
            await tx
              .select({ hash: valoRuleReleases.manifestHash, version: valoRuleReleases.version })
              .from(valoRuleReleases)
              .where(eq(valoRuleReleases.id, e.targetId))
          )[0];
    if (!target || target.hash !== e.targetHash || target.version !== e.targetVersion)
      throw new ValoProblem(409, "The exact referred version changed. Prepare a fresh escalation.");
    return { replayed: false as const, escalation: e, caseVersion: row.version };
  });
  if (prepared.replayed)
    return { ...prepared, notice: "Previously saved content triage; no action repeated." };
  let impactId: string | null = null;
  if (input.action === "hold_and_reassess") {
    const { actOnSourceControls } = await import("../sources");
    // The source service owns its transaction, current role/MFA, exclusive
    // source lock, exact-version hold, idempotency and correction-review queue.
    // It retains a request digest, never raw customer/support text in its audit.
    const held = await actOnSourceControls(actor, {
      action: "hold_version",
      kind: prepared.escalation.targetKind,
      id: prepared.escalation.targetId,
      version: prepared.escalation.targetVersion,
      requestKey: input.idempotencyKey,
      reason: sourceReason,
    });
    const result = held.result as { impactId?: unknown };
    if (typeof result.impactId !== "string" || !z.string().uuid().safeParse(result.impactId).success)
      throw new ValoProblem(
        503,
        "Source reassessment did not return durable lineage. No triage completion is claimed.",
      );
    impactId = result.impactId;
  }
  return db.transaction(async (tx) => {
    await requireSupportStaff(tx, actor, "content");
    let row = await lockedCase(tx, prepared.escalation.caseId);
    await currentSupportStaff(tx, actor, "content");
    const [e] = await tx
      .select()
      .from(valoSupportEscalations)
      .where(eq(valoSupportEscalations.id, id))
      .for("update");
    if (!e) throw new ValoProblem(404, "Content escalation is unavailable.");
    const [old] = await tx
      .select()
      .from(valoSupportActions)
      .where(
        and(
          eq(valoSupportActions.caseId, row.id),
          eq(valoSupportActions.actorId, actor.identityId),
          eq(valoSupportActions.idempotencyKey, input.idempotencyKey),
        ),
      );
    if (old) {
      if (old.payloadHash !== hash(input))
        throw new ValoProblem(409, "This request key belongs to another action.");
      return {
        escalation: e,
        caseVersion: row.version,
        notice: "Previously saved content triage; no action repeated.",
      };
    }
    // A completed durable hold may be recovered after an unrelated customer
    // reply incremented the case version. Never repeat it with a new key.
    if (!impactId && row.version !== input.expectedVersion)
      throw new ValoProblem(409, "Case changed during triage. Reload before trying again.", row.version);
    if (e.status === "resolved" && !impactId)
      throw new ValoProblem(409, "Triage resolved concurrently. Reload its recorded outcome.");
    // A concurrent triage closure does not undo a committed source hold. Link
    // its durable lineage while preserving the closure instead of reporting a
    // misleading rejection after effects or generating another hold key.
    const [updated] = await tx
      .update(valoSupportEscalations)
      .set({
        status: e.status === "resolved" || input.action === "resolve" ? "resolved" : "acknowledged",
        ...(impactId ? { sourceImpactId: impactId } : {}),
        updatedAt: new Date(),
      })
      .where(eq(valoSupportEscalations.id, id))
      .returning();
    await tx.insert(valoSupportMessages).values({
      id: randomUUID(),
      caseId: row.id,
      workspaceId: row.workspaceId,
      authorId: actor.identityId,
      authorKind: "staff",
      visibility: "internal",
      body: input.body,
    });
    row = await change(tx, row, actor.identityId, input, `content_triage_${input.action}`, {});
    return {
      escalation: updated!,
      caseVersion: row.version,
      notice: impactId
        ? "Exact version held and reassessment queued by the content authority. No AI review, publication or external message was performed."
        : "Content triage saved. This does not approve or publish the referred version.",
    };
  });
}
