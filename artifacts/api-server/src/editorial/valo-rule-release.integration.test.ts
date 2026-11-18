import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq, sql } from "drizzle-orm";
import { db, valoRuleReleases } from "@workspace/db";
import { allSourceLeads, assess, checkerFactsSchema, restoredRuleVersion } from "@workspace/valo-core";
import { syntheticRuleRelease } from "../test-support/synthetic-rule-release";
import { currentAssessmentDate, releasedRegistry } from "../modules/rules/valo-assessments";
import { applyStoredRuleRelease, planStoredRuleRelease, type RuleReleaseRequest } from "./valo-rule-release";
import { registerSourceWatch } from "../lib/valo-source-monitor";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
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

// ADM-004: "Validate condition schemas, preview affected profiles and run regression scenarios
// before publishing a new ruleset", accepted when "failed critical tests block release and prior
// versions can be restored without losing assessment history". Every version here is synthetic and
// published only into this disposable database, in a step of its own after every other suite.
test(
  "a rule version is released only after its plan, source check and confirmation, and replaces the one before",
  { skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only", timeout: 60000 },
  async () => {
    assert.equal(process.env.NODE_ENV, "development");
    const now = new Date();
    // A current retained capture of an official source no other test watches. Its stored text is
    // synthetic and is read through a stand-in for private storage, which CI does not have; the
    // capture, watch, bindings and every check on them are the real release path.
    const watched = (
      await db.execute<{ source_id: string }>(sql`select source_id from valo_source_watches`)
    ).rows.map((row) => row.source_id);
    const lead = allSourceLeads.find((s) => s.url.startsWith("https://") && !watched.includes(s.id));
    assert.ok(lead, "an unwatched official source lead");
    const text = "Synthetic provision for a controlled release test: keep a dated record of each sale.";
    const snapshotId = randomUUID(),
      raw = `synthetic raw bytes ${snapshotId}`;
    await db.transaction((tx) => registerSourceWatch(tx, lead.id));
    await db.execute(sql`insert into valo_source_snapshots(id,source_id,url,attempted_at,fetched_at,status,http_status,mime,raw_checksum,text_checksum,raw_object_key,text_object_key,bytes,extraction_version,metadata)
      values(${snapshotId}::uuid,${lead.id},${lead.url},${now},${now},'retrieved_unreviewed',200,'text/plain',${sha256(raw)},${sha256(text)},
      ${"synthetic-ci-not-a-retained-file/" + snapshotId + "/raw"},${"synthetic-ci-not-a-retained-file/" + snapshotId + "/text"},${text.length},'controlled-no-extraction','{"synthetic":true}')`);
    await db.execute(
      sql`update valo_source_watches set checked_at=${now},failure_code=null,last_snapshot_id=${snapshotId}::uuid,last_raw_hash=${sha256(raw)} where source_id=${lead.id}`,
    );
    const readText = async (id: string, checksum: string) => {
      if (id !== snapshotId || checksum !== sha256(text)) throw new Error("SOURCE_STORAGE_CHECKSUM_FAILED");
      return text;
    };

    const ruleId = `synthetic-release-${randomUUID()}`;
    const condition = (field: "legalForm" | "premises", value: string) => ({
      mode: "all" as const,
      predicates: [{ field, op: "eq" as const, value }],
    });
    const request = (
      version: number,
      rule: ReturnType<typeof condition>,
      expectedLabel: string,
    ): RuleReleaseRequest => ({
      ...syntheticRuleRelease({
        ruleId,
        version,
        condition: rule,
        source: { url: lead.url, text, quote: "keep a dated record of each sale" },
        now,
      }),
      snapshotIds: { "synthetic-source": snapshotId },
      scenarios: [
        { id: "company", facts, asOfDate: currentAssessmentDate(now), expectedLabel, critical: true },
      ],
    });
    const hashOf = (r: RuleReleaseRequest) => (r.rule as { manifestHash: string }).manifestHash;
    const stored = async () =>
      (
        await db
          .select({ version: valoRuleReleases.version, status: valoRuleReleases.status })
          .from(valoRuleReleases)
          .where(eq(valoRuleReleases.ruleId, ruleId))
          .orderBy(valoRuleReleases.version)
      ).map((r) => [r.version, r.status]);
    const checkerSays = async () => {
      const registry = await releasedRegistry(db, now);
      return assess(facts, registry.rules, currentAssessmentDate(now), now, {
        trustedManifestHashes: registry.trusted,
      }).items.find((item) => item.ruleId === ruleId)?.label;
    };

    // Version 1: planned, then refused without the operator's confirmation, then released.
    const first = request(1, condition("legalForm", "company"), "Likely relevant");
    const plan = await planStoredRuleRelease(first, now);
    assert.equal(plan.decision, "ready", plan.reasons.join());
    assert.deepEqual(
      plan.scenarios.map((s) => s.passed),
      [true],
    );
    await assert.rejects(
      applyStoredRuleRelease(first, "f".repeat(64), { now, readText }),
      /RULE_RELEASE_NOT_CONFIRMED/,
    );
    assert.deepEqual(await stored(), []);
    assert.deepEqual(await applyStoredRuleRelease(first, hashOf(first), { now, readText }), {
      id: (
        await db
          .select({ id: valoRuleReleases.id })
          .from(valoRuleReleases)
          .where(eq(valoRuleReleases.ruleId, ruleId))
      )[0]!.id,
      ruleId,
      version: 1,
      superseded: [],
    });
    assert.equal(await checkerSays(), "Likely relevant", "the checker admits the released version");

    // A failed critical scenario blocks version 2, and nothing is written.
    const failing = request(2, condition("premises", "yes"), "Likely relevant");
    await assert.rejects(
      applyStoredRuleRelease(failing, hashOf(failing), { now, readText }),
      /RULE_RELEASE_BLOCKED:critical_scenario_failed:company/,
    );
    // A bundle the registry would not admit is blocked too.
    const unreviewed = request(2, condition("premises", "yes"), "More information needed");
    (unreviewed.bundle as { reviews: { verdict: string }[] }).reviews[1]!.verdict = "hold";
    assert.ok((await planStoredRuleRelease(unreviewed, now)).reasons.includes("release_not_admissible"));
    // Stored text that lacks a quoted passage stops the release before its transaction.
    const second = request(2, condition("premises", "yes"), "More information needed");
    await assert.rejects(
      applyStoredRuleRelease(second, hashOf(second), { now, readText: async () => "Different stored text." }),
      /SOURCE_PASSAGE_SNAPSHOT_MISMATCH/,
    );
    assert.deepEqual(await stored(), [[1, "published"]]);

    // Version 2 replaces version 1: the checker never holds two versions of one rule.
    assert.deepEqual(
      (await applyStoredRuleRelease(second, hashOf(second), { now, readText })).superseded,
      [1],
    );
    assert.deepEqual(await stored(), [
      [1, "superseded"],
      [2, "published"],
    ]);
    assert.equal(await checkerSays(), "More information needed");

    // Restoring version 1 releases its content again as version 3, through the same path.
    const history = [first.rule, second.rule] as Parameters<typeof restoredRuleVersion>[0];
    assert.deepEqual(restoredRuleVersion(history, ruleId, 1).condition, condition("legalForm", "company"));
    const restored = request(3, condition("legalForm", "company"), "Likely relevant");
    assert.deepEqual(
      (await applyStoredRuleRelease(restored, hashOf(restored), { now, readText })).superseded,
      [2],
    );
    assert.deepEqual(await stored(), [
      [1, "superseded"],
      [2, "superseded"],
      [3, "published"],
    ]);
    assert.equal(await checkerSays(), "Likely relevant");
    // A stale version number is refused.
    await assert.rejects(
      applyStoredRuleRelease(second, hashOf(second), { now, readText }),
      /version_not_next/,
    );
  },
);
