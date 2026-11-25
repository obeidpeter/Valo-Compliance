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
import { referableLibraryEntries, referredLibraryEdition } from "../manual-library";
import { consumeQuota, quotaSubjectHash } from "../../lib/valo-quota";
import { setting } from "../../platform/settings";
import {
  activeStaffAssignment,
  assertStaffAssignmentCurrent,
  requireFreshStaffSession,
  type StaffActor,
} from "../staff";
import {
  contentTriageSchema,
  listContentSupportEscalations,
  runContentSupportEscalation,
} from "./valo-support-triage";
export { contentTriageSchema };
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
      targetKind: z.enum(["content", "rule", "library"]),
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
/** Checks the actor's live support or content role and records the access, naming its object (ADM-009). */
export async function requireSupportStaff(
  tx: Tx,
  actor: SupportStaffActor,
  role: "support" | "content",
  object: string,
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
    object,
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
    await requireSupportStaff(tx, actor, "support", "support_cases");
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
    await requireSupportStaff(tx, actor, "support", "support_assignees");
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
    await requireSupportStaff(tx, actor, "support", `support_case:${id}`);
    return detail(tx, await readCase(tx, id), true, page, false);
  });
}
export async function actOnSupportCase(actor: SupportStaffActor, id: string, raw: unknown) {
  const input = supportActionSchema.parse(raw);
  return db.transaction(async (tx) => {
    await requireSupportStaff(tx, actor, "support", `support_case:${id}`);
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
        let target: { hash: string; version: number } | undefined;
        if (input.targetKind === "library") {
          // A staff-library entry is referred by its published version, as the entry search gives it
          // (docs/architecture/library-holds.md, slice 3).
          const edition = await referredLibraryEdition(tx, input.targetId);
          if (!edition) throw new ValoProblem(404, "The exact content or rule version is unavailable.");
          if (edition.state !== "published")
            throw new ValoProblem(
              409,
              "This library version is no longer published. Find the entry by its title again.",
            );
          target = { hash: edition.digest, version: edition.version };
        } else
          target =
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
const triageDeps = {
  pageValue,
  hash,
  requireSupportStaff,
  currentSupportStaff,
  lockedCase,
  replay,
  change,
};
const libraryWords = z.string().trim().min(2).max(100);
/**
 * The published staff-library entries whose titles contain the words, for support staff choosing what a
 * referral points at (docs/architecture/library-holds.md, slice 3). Needs an active support role and a
 * recently verified session, as the cases do.
 */
export async function supportLibraryEntries(actor: SupportStaffActor, words: unknown) {
  const q = libraryWords.parse(words);
  return db.transaction(async (tx) => {
    await requireSupportStaff(tx, actor, "support", "library_entries");
    return { entries: await referableLibraryEntries(tx, q) };
  });
}
export async function contentSupportEscalations(actor: SupportStaffActor, rawPage?: unknown) {
  return listContentSupportEscalations(triageDeps, actor, rawPage);
}
export async function actOnContentSupportEscalation(actor: SupportStaffActor, id: string, raw: unknown) {
  return runContentSupportEscalation(triageDeps, actor, id, raw);
}
