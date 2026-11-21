import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { assess, checkerFactsSchema, digest, ruleSchema, type ReleasedRule } from "@workspace/valo-core";
import { workspaceActorFromRecord } from "../../platform/workspace-context";

/** Run against an isolated loopback development PostgreSQL database:
 * VALO_RUN_DB_TESTS=synthetic-development-only NODE_ENV=development
 * node --experimental-test-module-mocks --import tsx --test
 *   src/modules/tasks/valo-task-source-guard.integration.test.ts
 *
 * Only the server registry dependency is controlled, in this test process.
 * The real task service, assessment integrity checks, membership transaction,
 * Drizzle inserts and rollback execute. No publication row, source evidence,
 * review receipt or release approval is created or changed. The in-memory
 * trusted rule below is NOT an eligible Nigerian rule or publication proof.
 */
test(
  "new source-linked tasks recheck current eligibility before any insert",
  {
    skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only",
    timeout: 60000,
  },
  async (t) => {
    assert.equal(process.env.NODE_ENV, "development");
    assert.ok(!process.env.REPLIT_DEPLOYMENT, "No deployment database tests");
    assert.ok(
      process.execArgv.includes("--experimental-test-module-mocks"),
      "Run with test-only module mocking enabled",
    );
    assert.ok(process.env.DATABASE_URL, "An isolated PostgreSQL database is required");
    assert.ok(
      ["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL).hostname),
      "This test may use only a loopback, disposable development database",
    );
    const { eq, inArray } = await import("drizzle-orm");
    const {
      db,
      pool,
      valoAssessments,
      valoTasks,
      valoReminderOutbox,
      valoReminderPreferences,
      valoMemberships,
      valoEvents,
      valoWorkspaces,
      valoRuleReleases,
    } = await import("@workspace/db");
    const assessments = await import("../rules/valo-assessments");
    type Registry = Awaited<ReturnType<typeof assessments.releasedRegistry>>;
    const now = new Date(),
      day = assessments.currentAssessmentDate(now);
    const date = (offset: number) =>
      assessments.currentAssessmentDate(new Date(now.getTime() + offset * 86400000));
    const instant = (offset: number) => new Date(now.getTime() + offset * 86400000).toISOString();
    const facts = checkerFactsSchema.parse({
      legalForm: "company",
      registrationStatus: "registered",
      activities: ["retail"],
      state: "Lagos",
      lga: "unknown",
      employees: "unknown",
      turnoverBand: "unknown",
      turnoverYear: "unknown",
      turnoverMetric: "gross_revenue",
      turnoverCurrency: "NGN",
      premises: "unknown",
      manufacturing: "no",
      importing: "no",
      personalData: "unknown",
    });
    const rule = ruleSchema.parse({
      id: `controlled-task-rule-${randomUUID()}`,
      version: 1,
      requirementVersionId: "controlled-server-registry-only",
      title: "Controlled task boundary; no regulatory conclusion",
      jurisdiction: { level: "federal" },
      validFrom: date(-2),
      validTo: date(2),
      sourceCheckedAt: instant(-2),
      reviewBy: instant(2),
      status: "published",
      provenance: "editorial_release",
      manifestHash: digest("controlled-in-memory-registry-not-publication-evidence"),
      sources: [
        {
          id: "controlled-source",
          url: "https://example.test/task-guard",
          title: "Controlled dependency",
          locator: "test only",
          quote: "Not a regulatory source or release",
          snapshotHash: digest("controlled-source"),
        },
      ],
      condition: { mode: "all", predicates: [{ field: "legalForm", op: "eq", value: "company" }] },
      reason: "Controlled task-boundary assertion only",
      nextStep: "No external action",
      relatedTemplateIds: [],
    });
    const registryFor = (rules: ReleasedRule[], trusted = rules.map((r) => r.manifestHash)): Registry => ({
      rules,
      trusted: new Set(trusted),
      excluded: 0,
      stateHash: digest(rules),
    });
    let registry = registryFor([rule]),
      registryReads = 0;
    // No application option or HTTP field can install this dependency. Node
    // replaces the module export only for this isolated test process.
    t.mock.module(new URL("../rules/valo-assessments.ts", import.meta.url), {
      cache: true,
      namedExports: {
        ...assessments,
        releasedRegistry: async () => {
          registryReads++;
          return registry;
        },
      },
    });
    const tasks = await import("./valo-tasks");
    const actor = workspaceActorFromRecord({
      workspaceId: randomUUID(),
      identityId: `synthetic-task-guard-${randomUUID()}`,
    });
    const other = workspaceActorFromRecord({
      workspaceId: randomUUID(),
      identityId: `synthetic-task-guard-other-${randomUUID()}`,
    });
    const workspaceIds = [actor.workspaceId, other.workspaceId];
    const registryBefore = digest(await db.select().from(valoRuleReleases));
    let saved: Awaited<ReturnType<typeof assessments.getAssessment>>;
    try {
      for (const owner of [actor, other]) {
        await db.insert(valoWorkspaces).values({ id: owner.workspaceId, ownerIdentityId: owner.identityId });
        await db.insert(valoMemberships).values({
          id: randomUUID(),
          workspaceId: owner.workspaceId,
          identityId: owner.identityId,
          role: "owner",
          active: "yes",
        });
      }
      const result = assess(facts, [rule], day, now, { trustedManifestHashes: registry.trusted });
      assert.equal(result.items[0]?.label, "Likely relevant");
      assert.equal(
        Object.hasOwn(result.items[0], "sourceLinkedTaskEligible"),
        false,
        "Legacy recommendation DTOs must continue to work without the new optional flag",
      );
      const [row] = await db
        .insert(valoAssessments)
        .values({
          id: randomUUID(),
          workspaceId: actor.workspaceId,
          profileVersionId: null,
          profileRevision: null,
          facts,
          factsHash: digest(facts),
          result,
          resultHash: result.resultHash,
          rulesetVersion: result.rulesetVersion,
          asOfDate: day,
          consentVersion: "controlled-task-guard-test",
          actorId: actor.identityId,
        })
        .returning();
      assert.ok(row);
      saved = assessments.serializeAssessment(row);
      const input = {
        title: "Synthetic source-linked task",
        notes: "Controlled task boundary test",
        dueDate: null,
        dateConfirmed: false,
        assessmentId: saved.id,
        ruleId: rule.id,
      };
      const effects = async () => ({
        tasks: (
          await db
            .select({ id: valoTasks.id })
            .from(valoTasks)
            .where(eq(valoTasks.workspaceId, actor.workspaceId))
        )
          .map((r) => r.id)
          .sort(),
        outbox: (
          await db
            .select({ id: valoReminderOutbox.id })
            .from(valoReminderOutbox)
            .where(eq(valoReminderOutbox.workspaceId, actor.workspaceId))
        )
          .map((r) => r.id)
          .sort(),
        events: (
          await db
            .select({ id: valoEvents.id })
            .from(valoEvents)
            .where(eq(valoEvents.workspaceId, actor.workspaceId))
        )
          .map((r) => r.id)
          .sort(),
      });
      await t.test(
        "a current legacy recommendation creates a task with reminders off and no date",
        async () => {
          const created = await tasks.createTask(actor, input);
          assert.equal(created.ruleId, rule.id);
          const [stored] = await db
            .select({ ruleVersion: valoTasks.ruleVersion })
            .from(valoTasks)
            .where(eq(valoTasks.id, created.id));
          assert.ok(stored);
          assert.equal(
            stored.ruleVersion,
            1,
            "The persisted task binds the checked version without adding it to the public DTO",
          );
          assert.equal(created.dueDate, null);
          assert.equal(created.needsReview, false);
          assert.ok(
            registryReads > 0,
            "The real service must reach the controlled server registry dependency",
          );
          assert.equal((await effects()).outbox.length, 0);
        },
      );
      const denied: [string, Registry][] = [
        ["expired rule review", registryFor([{ ...rule, reviewBy: instant(-1) }])],
        ["future source check", registryFor([{ ...rule, sourceCheckedAt: instant(1) }])],
        ["future effective period", registryFor([{ ...rule, validFrom: date(1) }])],
        ["effective period ends today (exclusive)", registryFor([{ ...rule, validTo: day }])],
        ["withdrawn current rule", registryFor([{ ...rule, status: "withdrawn" }])],
        ["withdrawn registry entry", registryFor([])],
        ["publication trust removed", registryFor([rule], [])],
        ["replacement version only", registryFor([{ ...rule, version: 2 }])],
        [
          "conflicting active versions",
          registryFor([rule, { ...rule, version: 2, manifestHash: digest("controlled-second-version") }]),
        ],
        [
          "evaluator implementation changed",
          registryFor([
            {
              ...rule,
              condition: undefined,
              evaluator: {
                family: "businessName",
                version: "source-family-v1",
                algorithmHash: "0".repeat(64),
              },
            },
          ]),
        ],
      ];
      for (const [name, current] of denied)
        await t.test(`${name} rejects before task, outbox or audit insertion`, async () => {
          registry = current;
          const before = await effects(),
            reads = registryReads;
          await assert.rejects(tasks.createTask(actor, input), { status: 409 });
          assert.ok(registryReads > reads);
          assert.deepEqual(await effects(), before);
          assert.deepEqual(
            await assessments.getAssessment(actor, saved.id),
            saved,
            "Historical assessment is unchanged",
          );
        });
      await t.test("a due date and enabled reminders cannot bypass the same creation guard", async () => {
        await db.insert(valoReminderPreferences).values({
          workspaceId: actor.workspaceId,
          enabled: true,
          offsets: [1],
          revision: 1,
          consentVersion: "controlled-task-guard-test",
          actorId: actor.identityId,
        });
        registry = registryFor([{ ...rule, reviewBy: instant(-1) }]);
        const before = await effects();
        await assert.rejects(tasks.createTask(actor, { ...input, dueDate: date(3), dateConfirmed: true }), {
          status: 409,
        });
        assert.deepEqual(await effects(), before);
      });
      await t.test("a valid source does not bypass assessment ownership or caller binding", async () => {
        registry = registryFor([rule]);
        const before = await effects();
        await assert.rejects(tasks.createTask(other, input), { status: 404 });
        await assert.rejects(tasks.createTask(actor, { ...input, ruleVersion: 2 }));
        await assert.rejects(tasks.createTask(actor, { ...input, sourceLinkedTaskEligible: true }));
        assert.deepEqual(await effects(), before);
      });
      await t.test("manual tasks still work while source-linked recommendations are held", async () => {
        registry = registryFor([]);
        const created = await tasks.createTask(actor, { ...input, ruleId: null });
        assert.equal(created.ruleId, null);
        const [stored] = await db
          .select({ ruleVersion: valoTasks.ruleVersion })
          .from(valoTasks)
          .where(eq(valoTasks.id, created.id));
        assert.ok(stored);
        assert.equal(stored.ruleVersion, null);
      });
      assert.equal(
        digest(await db.select().from(valoRuleReleases)),
        registryBefore,
        "The controlled test must never publish or modify a registry row",
      );
    } finally {
      await db.delete(valoReminderOutbox).where(inArray(valoReminderOutbox.workspaceId, workspaceIds));
      await db
        .delete(valoReminderPreferences)
        .where(inArray(valoReminderPreferences.workspaceId, workspaceIds));
      await db.delete(valoTasks).where(inArray(valoTasks.workspaceId, workspaceIds));
      await db.delete(valoAssessments).where(inArray(valoAssessments.workspaceId, workspaceIds));
      await db.delete(valoEvents).where(inArray(valoEvents.workspaceId, workspaceIds));
      await db.delete(valoMemberships).where(inArray(valoMemberships.workspaceId, workspaceIds));
      await db.delete(valoWorkspaces).where(inArray(valoWorkspaces.id, workspaceIds));
      await pool.end();
    }
  },
);
