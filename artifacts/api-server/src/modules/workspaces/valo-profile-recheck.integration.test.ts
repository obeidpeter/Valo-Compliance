import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  pool,
  runInWorkspaceScope,
  valoAssessments,
  valoConsentChanges,
  valoEvents,
  valoMemberships,
  valoProfileVersions,
  valoReminderOutbox,
  valoReminderPreferences,
  valoTasks,
  valoWorkspaces,
} from "@workspace/db";
import { getWorkspace, resolveWorkspace, saveProfile, type WorkspaceActor } from "./valo-workspaces";
import * as assessments from "../rules/valo-assessments";
import * as tasks from "../tasks/valo-tasks";
import { syntheticProfile } from "../../lib/valo-test-fixtures";

/** A synthetic profile whose every answer to the check is given. */
const lagos = {
  ...syntheticProfile,
  legalForm: "limited_company",
  registrationStatus: "registered",
  activities: ["retail"],
  state: "Lagos",
  lga: "Ikeja",
  employees: "3",
  turnoverBand: "5m_to_25m",
  turnoverYear: "2025",
  turnoverMetric: "gross_revenue",
  turnoverCurrency: "NGN",
  premises: "yes",
  manufacturing: "no",
  importing: "no",
  personalData: "yes",
};
/** The same business after it moves, takes on another activity and grows. */
const bayelsa = {
  ...lagos,
  state: "Bayelsa",
  lga: "Yenagoa",
  activities: ["retail", "catering"],
  employees: "6",
};
/** The answers the check's page sends when it is filled in from a profile. */
const answers = (profile: typeof lagos, own: Record<string, unknown> = {}) => {
  const { businessName: _name, marketingConsent: _marketing, ...taken } = profile;
  return { ...taken, lga: profile.lga || "unanswered", ...own };
};

test(
  "PRO-003: a new requirements check is offered after the profile changes an answer the check reads, and the earlier result and the tasks are kept",
  { skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only" },
  async (t) => {
    assert.notEqual(process.env.NODE_ENV, "production");
    assert.ok(!process.env.REPLIT_DEPLOYMENT, "No deployment database tests");
    const suffix = randomUUID();
    const a = await resolveWorkspace(`synthetic-recheck-a-${suffix}`),
      b = await resolveWorkspace(`synthetic-recheck-b-${suffix}`),
      c = await resolveWorkspace(`synthetic-recheck-c-${suffix}`),
      ids = [a.workspaceId, b.workspaceId, c.workspaceId];
    const asOfDate = new Date(Date.now() + 3600000).toISOString().slice(0, 10);
    const due = new Date(Date.now() + 40 * 86400000).toISOString().slice(0, 10);
    /** As a customer's request runs: in its workspace's database scope. */
    const scoped = <T>(actor: WorkspaceActor, run: () => Promise<T>) =>
      runInWorkspaceScope(actor.workspaceId, run);
    const summary = (actor: WorkspaceActor) => scoped(actor, () => getWorkspace(actor));
    let revision = 0;
    const save = async (profile: typeof lagos) =>
      scoped(a, () => saveProfile(a, { expectedRevision: revision++, profile }));
    const check = (actor: WorkspaceActor, facts: Record<string, unknown>) =>
      scoped(actor, () => assessments.createAssessment(actor, { facts, asOfDate, saveConsent: true }));
    const offer = (result: { id: string; createdAt: string }, changed: string[]) => ({
      assessmentId: result.id,
      savedAt: result.createdAt,
      changed,
    });
    let first: Awaited<ReturnType<typeof check>>;
    let kept: Awaited<ReturnType<typeof tasks.listTasks>>;
    try {
      await t.test("nothing is offered until there is a profile, a saved result and a change", async () => {
        assert.equal((await summary(a)).recheck, undefined, "no profile and no result");
        // Another workspace saves three versions first. Its third holds the answers this workspace's
        // profile will change to, and is newer than any version of this workspace's when its result is saved.
        for (const [expectedRevision, profile] of [lagos, lagos, bayelsa].entries())
          await scoped(b, () => saveProfile(b, { expectedRevision, profile }));
        assert.equal((await save(lagos)).recheck, undefined, "a profile and no result");
        assert.equal((await summary(a)).recheck, undefined);
        first = await check(a, answers(lagos));
        assert.equal(first.profileRevision, null, "saved with the answers given on the check's page");
        assert.equal((await summary(a)).recheck, undefined, "a result saved from the profile as it is");
        // The other workspace saves a later result, from its own profile.
        await check(b, answers(bayelsa));
        assert.equal((await summary(b)).recheck, undefined);
      });
      await t.test("a change the check does not read is saved as a version and offers nothing", async () => {
        // Two tasks the business made itself: one from the saved result, one of its own.
        for (const [title, assessmentId] of [
          ["Synthetic task from the result", first.id],
          ["Synthetic task of its own", null],
        ] as const)
          await scoped(a, () =>
            tasks.createTask(a, {
              title,
              notes: "Private synthetic notes",
              dueDate: due,
              dateConfirmed: true,
              assessmentId,
              ruleId: null,
            }),
          );
        kept = await scoped(a, () => tasks.listTasks(a));
        assert.equal(kept.length, 2);
        const saved = await save({
          ...lagos,
          businessName: "Another synthetic name",
          marketingConsent: true,
        });
        assert.equal(saved.profileRevision, 2, "the change is a version of the profile");
        assert.equal(saved.recheck, undefined);
        assert.equal((await summary(a)).recheck, undefined);
      });
      await t.test(
        "a changed location, activity and employee count are offered for a new check, with the save and afterwards",
        async () => {
          const saved = await save({
            ...bayelsa,
            businessName: "Another synthetic name",
            marketingConsent: true,
          });
          const expected = offer(first, ["activities", "state", "lga", "employees"]);
          assert.deepEqual(saved.recheck, expected, "said with the save, naming this workspace's own result");
          assert.deepEqual((await summary(a)).recheck, expected);
          assert.deepEqual((await getWorkspace(a)).recheck, expected, "outside a request's scope too");
          assert.equal((await summary(b)).recheck, undefined, "another workspace is offered nothing");
        },
      );
      await t.test(
        "a new result ends the offer, its comparison is dated, and the earlier result and the tasks are as they were",
        async () => {
          const second = await check(a, answers(bayelsa));
          assert.equal(
            (await summary(a)).recheck,
            undefined,
            "the new result was worked out from the new answers",
          );
          const comparison = await scoped(a, () => assessments.compareAssessments(a, second.id, first.id));
          assert.deepEqual(comparison.changedFacts, ["activities", "employees", "lga", "state"]);
          assert.ok(
            Date.parse(second.createdAt) >= Date.parse(first.createdAt) && second.id !== first.id,
            "each result keeps the time it was saved",
          );
          assert.deepEqual(
            await scoped(a, () => assessments.getAssessment(a, first.id)),
            first,
            "the earlier result is not overwritten",
          );
          assert.deepEqual(
            await scoped(a, () => tasks.listTasks(a)),
            kept,
            "the tasks the business made are kept",
          );
          assert.deepEqual(
            (await scoped(a, () => assessments.listAssessments(a))).map((saved) => saved.id),
            [second.id, first.id],
          );
        },
      );
      await t.test(
        "an answer the check's page was given differently is not offered until the profile changes it to something else",
        async () => {
          // Nine employees on the check's page, where the profile says six.
          const own = await check(a, answers(bayelsa, { employees: "9" }));
          assert.equal((await summary(a)).recheck, undefined, "the profile has not changed");
          const named = { ...bayelsa, businessName: "A third synthetic name" };
          assert.equal(
            (await save(named)).recheck,
            undefined,
            "the profile and the result differ, but the profile did not change that answer",
          );
          assert.equal(
            (await save({ ...named, employees: "9" })).recheck,
            undefined,
            "the profile takes the answer the result used, as copying a result's answers into it does",
          );
          assert.deepEqual((await save({ ...named, employees: "12" })).recheck, offer(own, ["employees"]));
          assert.deepEqual((await summary(a)).recheck, offer(own, ["employees"]));
        },
      );
      await t.test("a result worked out from the profile itself is followed in the same way", async () => {
        const fromProfile = await scoped(a, () =>
          assessments.createAssessment(a, { asOfDate, saveConsent: true, expectedProfileRevision: revision }),
        );
        assert.equal(fromProfile.profileRevision, revision);
        assert.equal((await summary(a)).recheck, undefined);
        const moved = {
          ...bayelsa,
          businessName: "A third synthetic name",
          employees: "12",
          state: "Rivers",
        };
        assert.deepEqual((await save(moved)).recheck, offer(fromProfile, ["state"]));
        // The same activities in another order change nothing.
        assert.deepEqual(
          (await save({ ...moved, activities: ["catering", "retail"] })).recheck,
          offer(fromProfile, ["state"]),
        );
      });
      await t.test(
        "a first profile saved after a result is compared with the answers that result used",
        async () => {
          // A result saved before any profile, with the legal form skipped.
          const before = await check(c, answers(lagos, { legalForm: "unanswered" }));
          assert.equal((await summary(c)).recheck, undefined, "no profile yet");
          // Its answers copied into a first profile, whose form holds "I do not know" for the skipped question.
          const copied = await scoped(c, () =>
            saveProfile(c, { expectedRevision: 0, profile: { ...lagos, legalForm: "unknown" } }),
          );
          assert.equal(copied.recheck, undefined, "the profile says what the result used");
          const moved = await scoped(c, () =>
            saveProfile(c, {
              expectedRevision: 1,
              profile: { ...lagos, legalForm: "unknown", state: "Kano" },
            }),
          );
          assert.deepEqual(moved.recheck, offer(before, ["state"]));
        },
      );
      await t.test("the versions and results the offer is read from are each workspace's own", async () => {
        const count = async (workspaceId: string) => ({
          versions: (
            await db
              .select()
              .from(valoProfileVersions)
              .where(eq(valoProfileVersions.workspaceId, workspaceId))
          ).length,
          results: (
            await db.select().from(valoAssessments).where(eq(valoAssessments.workspaceId, workspaceId))
          ).length,
        });
        assert.deepEqual(await count(a.workspaceId), { versions: revision, results: 4 });
        assert.deepEqual(await count(b.workspaceId), { versions: 3, results: 1 });
        assert.deepEqual(await count(c.workspaceId), { versions: 2, results: 1 });
      });
    } finally {
      await db.delete(valoReminderOutbox).where(inArray(valoReminderOutbox.workspaceId, ids));
      await db.delete(valoReminderPreferences).where(inArray(valoReminderPreferences.workspaceId, ids));
      await db.delete(valoConsentChanges).where(inArray(valoConsentChanges.workspaceId, ids));
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
