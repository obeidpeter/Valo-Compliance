import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  pool,
  valoAssessments,
  valoTasks,
  valoReminderOutbox,
  valoReminderPreferences,
  valoMemberships,
  valoProfileVersions,
  valoEvents,
  valoWorkspaces,
} from "@workspace/db";
import { resolveWorkspace, saveProfile } from "../workspaces";
import * as assessments from "../rules/valo-assessments";
import * as tasks from "./valo-tasks";
import { processReminder } from "./valo-reminder-worker";
import { syntheticProfile } from "../../lib/valo-test-fixtures";
import { workspaceActorFromRecord } from "../../platform/workspace-context";
test(
  "development saved assessments, task isolation, concurrency and reminder outbox",
  {
    skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only",
  },
  async (t) => {
    assert.notEqual(process.env.NODE_ENV, "production");
    assert.ok(!process.env.REPLIT_DEPLOYMENT, "No deployment database tests");
    const suffix = randomUUID(),
      a = await resolveWorkspace(`synthetic-checker-a-${suffix}`),
      b = await resolveWorkspace(`synthetic-checker-b-${suffix}`),
      ids = [a.workspaceId, b.workspaceId];
    const asOfDate = new Date(Date.now() + 3600000).toISOString().slice(0, 10);
    let first: Awaited<ReturnType<typeof assessments.createAssessment>>;
    let task: Awaited<ReturnType<typeof tasks.createTask>>;
    const future = new Date(Date.now() + 40 * 86400000).toISOString().slice(0, 10);
    try {
      await saveProfile(a, { expectedRevision: 0, profile: syntheticProfile });
      await t.test("explicit consent required; anonymous bodies cannot supply rules", async () => {
        await assert.rejects(assessments.createAssessment(a, { asOfDate, saveConsent: false }));
        await assert.rejects(assessments.previewAssessment({ facts: {}, asOfDate, rules: [{}] }));
      });
      await t.test("saved profile assessment preserves unknowns and real coverage gaps", async () => {
        first = await assessments.createAssessment(a, {
          asOfDate,
          saveConsent: true,
          expectedProfileRevision: 1,
        });
        assert.equal(first.profileRevision, 1);
        assert.equal(first.facts.employees, "unknown");
        assert.equal(first.result.sourceBackedRecommendations, 0);
        assert.ok(first.result.gaps.some((g) => g.includes("not a finding")));
        assert.deepEqual(await assessments.getAssessment(a, first.id), first);
      });
      await t.test("other tenants cannot read or compare assessment identifiers", async () => {
        assert.deepEqual(await assessments.listAssessments(b), []);
        await assert.rejects(assessments.getAssessment(b, first.id), { status: 404 });
        await assert.rejects(assessments.compareAssessments(b, first.id, first.id), { status: 404 });
        await assert.rejects(
          assessments.listAssessments(
            workspaceActorFromRecord({ workspaceId: a.workspaceId, identityId: b.identityId }),
          ),
          { status: 403 },
        );
      });
      await t.test("profile changes create dated comparisons without rewriting old assessments", async () => {
        await saveProfile(a, {
          expectedRevision: 1,
          profile: { ...syntheticProfile, state: "Bayelsa", employees: "6" },
        });
        await assert.rejects(
          assessments.createAssessment(a, { asOfDate, saveConsent: true, expectedProfileRevision: 1 }),
          { status: 409 },
        );
        const second = await assessments.createAssessment(a, {
          asOfDate,
          saveConsent: true,
          expectedProfileRevision: 2,
        });
        const comparison = await assessments.compareAssessments(a, second.id, first.id);
        assert.ok(comparison.changedFacts.includes("state"));
        assert.ok(comparison.changedFacts.includes("employees"));
        assert.equal(
          (await assessments.getAssessment(a, first.id)).result.resultHash,
          first.result.resultHash,
        );
      });
      await t.test("manual task creation works without falsely published requirements", async () => {
        task = await tasks.createTask(a, {
          title: "Synthetic business record review",
          notes: "Private synthetic notes",
          dueDate: future,
          dateConfirmed: true,
          assessmentId: first.id,
          ruleId: null,
        });
        assert.equal(task.state, "not_started");
        assert.equal(task.revision, 1);
        assert.deepEqual(await tasks.listTasks(b), []);
        await assert.rejects(
          tasks.createTask(a, {
            title: "Fake rule",
            notes: "",
            dueDate: null,
            dateConfirmed: false,
            assessmentId: first.id,
            ruleId: "unreleased-customer-rule",
          }),
        );
      });
      await t.test("all cross-tenant task writes and origin substitutions are denied", async () => {
        const update = {
          title: "Must not apply",
          notes: "",
          dueDate: null,
          dateConfirmed: false,
          state: "completed_by_user",
          expectedRevision: 1,
        };
        await assert.rejects(tasks.updateTask(b, task.id, update), { status: 404 });
        await assert.rejects(tasks.deleteTask(b, task.id, { expectedRevision: 1 }), { status: 404 });
        await assert.rejects(
          tasks.createTask(b, {
            title: "Cross origin",
            notes: "",
            dueDate: null,
            dateConfirmed: false,
            assessmentId: first.id,
            ruleId: null,
          }),
          { status: 404 },
        );
        await assert.rejects(
          db.insert(valoTasks).values({
            id: randomUUID(),
            workspaceId: b.workspaceId,
            title: "FK test",
            notes: "Synthetic constraint probe",
            assessmentId: first.id,
            actorId: b.identityId,
          }),
        );
      });
      await t.test("two concurrent task edits cannot silently overwrite notes", async () => {
        const base = {
          notes: "Retained text",
          dueDate: future,
          dateConfirmed: true,
          state: "in_progress",
          expectedRevision: 1,
        };
        const results = await Promise.allSettled([
          tasks.updateTask(a, task.id, { ...base, title: "First tab" }),
          tasks.updateTask(a, task.id, { ...base, title: "Second tab" }),
        ]);
        assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
        const rejected = results.find((r) => r.status === "rejected");
        assert.equal(rejected?.status === "rejected" && rejected.reason.status, 409);
        task = (await tasks.listTasks(a)).find((x) => x.id === task.id)!;
        assert.equal(task.revision, 2);
      });
      await t.test("unconfirmed and invalid calendar dates are rejected", async () => {
        const base = {
          title: "Date probe",
          notes: "",
          dueDate: future,
          dateConfirmed: false,
          assessmentId: null,
          ruleId: null,
        };
        await assert.rejects(tasks.createTask(a, base));
        await assert.rejects(tasks.createTask(a, { ...base, dueDate: "2026-02-30", dateConfirmed: true }));
      });
      await t.test("reminders default off and opt-in schedules are durable, held not sent", async () => {
        assert.equal((await tasks.getReminderPreferences(a)).enabled, false);
        const prefs = await tasks.saveReminderPreferences(a, {
          enabled: true,
          offsets: [1, 7],
          expectedRevision: 0,
        });
        assert.equal(prefs.deliveryAvailable, false);
        const rows = await tasks.listReminders(a);
        assert.equal(rows.filter((r) => r.taskId === task.id).length, 2);
        assert.ok(
          rows.every(
            (r) =>
              r.status === "held" && r.reason === "EMAIL_PROVIDER_NOT_CONFIGURED" && r.deliveredAt === null,
          ),
        );
        assert.deepEqual(await tasks.listReminders(b), []);
        assert.equal(tasks.reminderInstant(future, 0).getUTCHours(), 8);
      });
      await t.test(
        "scheduler retries and preference updates preserve idempotent reminder identities",
        async () => {
          const before = await tasks.listReminders(a);
          await tasks.saveReminderPreferences(a, { enabled: true, offsets: [7, 1], expectedRevision: 1 });
          const after = await tasks.listReminders(a);
          assert.deepEqual(after.map((r) => r.id).sort(), before.map((r) => r.id).sort());
          await assert.rejects(
            tasks.saveReminderPreferences(a, { enabled: true, offsets: [1], expectedRevision: 1 }),
            { status: 409 },
          );
          await assert.rejects(processReminder(b.workspaceId, before[0]!.id), { status: 404 });
        },
      );
      await t.test("dispatch checks opt-out before any adapter invocation", async () => {
        const rows = await tasks.listReminders(a);
        await tasks.saveReminderPreferences(a, { enabled: false, offsets: [1], expectedRevision: 2 });
        let calls = 0;
        const result = await processReminder(
          a.workspaceId,
          rows[0]!.id,
          {
            send: async () => {
              calls++;
              return { providerMessageId: "synthetic-test-only" };
            },
          },
          new Date(Date.now() + 60 * 86400000),
        );
        assert.equal(result, "cancelled");
        assert.equal(calls, 0);
        assert.ok((await tasks.listReminders(a)).every((r) => r.status === "cancelled"));
      });
      await t.test("source withdrawal flags a historical task without changing user completion", async () => {
        await db
          .update(valoTasks)
          .set({ ruleId: "SYNTHETIC-WITHDRAWN-RULE", ruleVersion: 1, state: "completed_by_user" })
          .where(eq(valoTasks.id, task.id));
        const current = (await tasks.listTasks(a)).find((x) => x.id === task.id)!;
        assert.equal(current.needsReview, true);
        assert.equal(current.state, "completed_by_user");
      });
      await t.test("archiving a task preserves assessments and cancels reminders", async () => {
        await tasks.deleteTask(a, task.id, { expectedRevision: task.revision });
        assert.ok(!(await tasks.listTasks(a)).some((x) => x.id === task.id));
        assert.equal(
          (await assessments.getAssessment(a, first.id)).result.resultHash,
          first.result.resultHash,
        );
      });
    } finally {
      await db.delete(valoReminderOutbox).where(inArray(valoReminderOutbox.workspaceId, ids));
      await db.delete(valoReminderPreferences).where(inArray(valoReminderPreferences.workspaceId, ids));
      await db.delete(valoTasks).where(inArray(valoTasks.workspaceId, ids));
      await db.delete(valoAssessments).where(inArray(valoAssessments.workspaceId, ids));
      await db.delete(valoEvents).where(inArray(valoEvents.workspaceId, ids));
      await db.delete(valoProfileVersions).where(inArray(valoProfileVersions.workspaceId, ids));
      await db.delete(valoMemberships).where(inArray(valoMemberships.workspaceId, ids));
      await db.delete(valoWorkspaces).where(inArray(valoWorkspaces.id, ids));
      await pool.end();
    }
  },
);
