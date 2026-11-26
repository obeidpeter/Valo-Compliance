import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import {
  ListOwnerSettingsResponse,
  PreviewOwnerSettingResponse,
  RecordOwnerSettingResponse,
} from "@workspace/api-zod";
import { sha256 } from "@workspace/valo-core";

type Call = (
  path: string,
  body?: unknown,
  actor?: string,
  headers?: Record<string, string>,
) => Promise<Response>;

/**
 * The owner's commercial settings (docs/architecture/commercial-settings.md, slice 3; ADM-006) over
 * HTTP: only the recently verified development owner, from Valo's own pages, previews and records a
 * setting's value; recording needs the preview's checksum of exactly those terms; the open value closes
 * when a new one starts, and the change log keeps both; and a customer request reads the value in
 * effect. The drafting allowance ends as its default, so the database's later tests read today's value.
 */
export async function exerciseOwnerSettingRoutes(call: Call, editor: string) {
  const {
    db,
    runInWorkspaceScope,
    valoCommercialSettingChanges: changes,
    valoCommercialSettings: settings,
    valoStaffAssignments: roles,
    valoStaffRoleChanges: audit,
  } = await import("@workspace/db");
  const { resolveWorkspace } = await import("../modules/workspaces");
  const { customerAIUsage } = await import("../modules/ai-lanes/valo-customer-ai");
  const id = randomUUID(),
    owner = "synthetic-setting-route-owner-" + id,
    system = "synthetic-setting-route-system-" + id,
    assignment = randomUUID();
  await db.insert(roles).values(
    [
      { id: assignment, identityId: owner },
      { id: randomUUID(), identityId: system },
    ].map((row) => ({
      ...row,
      role: "system" as const,
      grantedBy: "synthetic operator",
      reason: "Synthetic setting route test",
    })),
  );
  // The development owner is the identity the operator bootstrap granted (decision 0018).
  await db.insert(audit).values({
    id: randomUUID(),
    requestKey: randomUUID(),
    inputHash: sha256("synthetic"),
    actorId: "operator-bootstrap:synthetic",
    actorAssignmentId: assignment,
    assignmentId: assignment,
    targetIdentityId: owner,
    action: "grant",
    role: "system",
    reason: "Synthetic setting owner fixture",
    after: { active: true },
    targetVerifiedAt: new Date(),
  });
  try {
    const path = "/admin/owner-settings";
    const workspaceDaily = (value: string, from = "now") => ({
      key: "drafting_workspace_daily",
      value,
      from,
    });
    const record = (body: object, who = owner) => call(path, body, who);
    const valuesOf = async (key: string) =>
      ListOwnerSettingsResponse.parse(await (await call(path, undefined, owner)).json()).items.find(
        (item) => item.key === key,
      )?.values;
    const reader = await resolveWorkspace("synthetic-setting-reader-" + id);
    const allowance = async () =>
      (await runInWorkspaceScope(reader.workspaceId, () => customerAIUsage(reader))).workspaceDailyLimit;

    // Only the recently verified development owner reads, previews or records a value.
    for (const [who, headers] of [
      [editor, {}],
      [system, {}],
      [owner, { "x-test-mfa": "stale" }],
    ] as const) {
      assert.equal((await call(path, undefined, who, headers)).status, 403);
      assert.equal((await call(path + "/previews", workspaceDaily("12"), who, headers)).status, 403);
    }
    const listed = await call(path, undefined, owner);
    assert.equal(listed.status, 200);
    assert.equal(listed.headers.get("cache-control"), "private, no-store");
    // Each setting the code lists, with its default and the most it accepts.
    assert.deepEqual(
      ListOwnerSettingsResponse.parse(await listed.json()).items.map((item) => [
        item.key,
        item.defaultValue,
        item.max,
      ]),
      [
        ["drafting_workspace_daily", 30, 300],
        ["drafting_daily_in_all", 120, 1200],
      ],
    );

    // From another site a write is refused; a malformed or far larger value, or another key, is refused.
    const hostile = await call(path + "/previews", workspaceDaily("12"), owner, {
      origin: "https://hostile.invalid",
    });
    assert.equal(hostile.status, 403);
    for (const malformed of [
      workspaceDaily("3O"),
      workspaceDaily("301"),
      { key: "synthetic_unknown_setting", value: "12", from: "now" },
    ])
      assert.equal((await call(path + "/previews", malformed, owner)).status, 422);

    // A preview gives the exact terms and their checksum, and writes nothing.
    const before = (await db.select().from(settings)).length;
    const previewed = await call(path + "/previews", workspaceDaily("12"), owner);
    assert.equal(previewed.status, 200);
    const preview = PreviewOwnerSettingResponse.parse(await previewed.json());
    assert.equal(preview.title, "The drafting assistant's daily allowance for each workspace");
    assert.equal(preview.unit, "drafts a day");
    assert.deepEqual(preview.terms, { key: "drafting_workspace_daily", value: 12, from: "now" });

    // Recording needs the checksum of exactly these terms, from the owner.
    const approval = { reference: "synthetic-owner-setting-approval-1", confirm: preview.checksum };
    assert.equal((await record({ ...workspaceDaily("13"), ...approval })).status, 409);
    assert.equal((await record({ ...workspaceDaily("12"), ...approval }, system)).status, 403);
    assert.equal((await db.select().from(settings)).length, before);
    const recorded = await record({ ...workspaceDaily("12"), ...approval });
    assert.equal(recorded.status, 200);
    const first = RecordOwnerSettingResponse.parse(await recorded.json());
    assert.equal(first.value, 12);
    const [row] = await db.select().from(settings).where(eq(settings.id, first.settingId));
    // The owner's own sign-in is the approval's author, not a typed name.
    assert.equal(
      row?.approvalReference,
      `synthetic-owner-setting-approval-1 (approved by the development owner, ${owner})`,
    );
    assert.deepEqual((await valuesOf("drafting_workspace_daily"))?.at(-1), {
      settingId: first.settingId,
      value: 12,
      effectiveFrom: row!.effectiveFrom,
      effectiveTo: null,
    });
    // A customer request reads the value in effect: the drafting assistant allows 12 drafts a day.
    assert.equal(await allowance(), 12);

    // The owner's next value closes this one when it starts, once; the change log keeps both. It is the
    // default again, so the database's later tests read today's allowance.
    const back = PreviewOwnerSettingResponse.parse(
      await (await call(path + "/previews", workspaceDaily("30"), owner)).json(),
    );
    const secondResponse = await record({
      ...workspaceDaily("30"),
      reference: "synthetic-owner-setting-approval-2",
      confirm: back.checksum,
    });
    assert.equal(secondResponse.status, 200);
    const second = RecordOwnerSettingResponse.parse(await secondResponse.json());
    assert.deepEqual(second.closed, [{ settingId: first.settingId, value: 12 }]);
    const [closed] = await db.select().from(settings).where(eq(settings.id, first.settingId));
    assert.equal(+closed!.effectiveTo!, +second.from);
    assert.deepEqual(
      (
        await db
          .select({ action: changes.action })
          .from(changes)
          .where(eq(changes.settingId, first.settingId))
          .orderBy(asc(changes.changedAt), asc(changes.id))
      ).map((change) => change.action),
      ["created", "closed"],
    );
    assert.equal(await allowance(), 30);

    // A value scheduled to start later is listed with its start, is not in effect before it, and a
    // value that would start before it is refused.
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const inAll = (value: string, from: string) => ({ key: "drafting_daily_in_all", value, from });
    const later = PreviewOwnerSettingResponse.parse(
      await (await call(path + "/previews", inAll("120", tomorrow), owner)).json(),
    );
    const scheduledResponse = await record({
      ...inAll("120", tomorrow),
      reference: "synthetic-owner-setting-approval-3",
      confirm: later.checksum,
    });
    assert.equal(scheduledResponse.status, 200);
    const scheduled = RecordOwnerSettingResponse.parse(await scheduledResponse.json());
    assert.equal(+scheduled.from, +new Date(tomorrow));
    assert.deepEqual(
      ((await valuesOf("drafting_daily_in_all")) ?? []).map((value) => [value.value, +value.effectiveFrom]),
      [[120, +new Date(tomorrow)]],
    );
    const now = PreviewOwnerSettingResponse.parse(
      await (await call(path + "/previews", inAll("100", "now"), owner)).json(),
    );
    assert.equal(
      (
        await record({
          ...inAll("100", "now"),
          reference: "synthetic-owner-setting-approval-4",
          confirm: now.checksum,
        })
      ).status,
      409,
    );
  } finally {
    for (const identity of [owner, system])
      await db.update(roles).set({ active: false }).where(eq(roles.identityId, identity));
  }
}
