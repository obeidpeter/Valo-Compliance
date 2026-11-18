import { randomUUID } from "node:crypto";
import { and, eq, ne, sql } from "drizzle-orm";
import { db, valoRuleReleases } from "@workspace/db";
import {
  checkerFactsSchema,
  planRuleRelease,
  ruleSchema,
  type RuleReleasePlan,
  type RuleScenario,
} from "@workspace/valo-core";
import { bindVerifiedSources, verifyReleasedSources } from "./source-release-bindings";
import { readSourceText } from "./source-storage";
import { currentAssessmentDate, releasedRegistry, ruleReleaseEligible } from "../modules/rules";
import { assertDevelopmentRuntime } from "../lib/valo-development-runtime";
import { lockSourceState } from "../lib/valo-source-state";

/** A new version of a rule, as the editorial pipeline hands it over for release (ADM-004). */
export type RuleReleaseRequest = {
  rule: unknown;
  /** Its publication bundle: the reviewed candidate, sources, policy and manifest. */
  bundle: unknown;
  scenarios: RuleScenario[];
  /** For each bundle source, the retained capture its passages are checked against. */
  snapshotIds: Record<string, string>;
};

type Reader = Pick<typeof db, "execute">;
const latestStoredVersion = async (reader: Reader, ruleId: string) =>
  Number(
    (
      await reader.execute<{ version: number }>(
        sql`select coalesce(max(version), 0)::int as version from valo_rule_releases where rule_id=${ruleId}`,
      )
    ).rows[0]!.version,
  );

/**
 * What releasing this version would do, planned against the rules the checker admits now and the
 * answers customers have saved. The answers are read only to count whose results would change; the
 * plan carries no answer. A release the registry would not itself admit is blocked.
 */
export async function planStoredRuleRelease(
  request: RuleReleaseRequest,
  now = new Date(),
): Promise<RuleReleasePlan> {
  assertDevelopmentRuntime();
  const parsed = ruleSchema.safeParse(request.rule);
  const registry = await releasedRegistry(db, now);
  const saved = await db.execute<{ facts: unknown }>(
    sql`select facts from valo_assessments order by created_at desc limit 500`,
  );
  const profiles = saved.rows.flatMap((row) => {
    const facts = checkerFactsSchema.safeParse(row.facts);
    return facts.success ? [facts.data] : [];
  });
  const plan = planRuleRelease({
    candidate: request.rule,
    current: registry.rules,
    trustedManifestHashes: registry.trusted,
    scenarios: request.scenarios,
    profiles,
    ...(parsed.success ? { latestVersion: await latestStoredVersion(db, parsed.data.id) } : {}),
    now,
    asOfDate: currentAssessmentDate(now),
  });
  if (!parsed.success) return plan;
  const admissible = ruleReleaseEligible(
    {
      ruleId: parsed.data.id,
      version: parsed.data.version,
      status: "published",
      rule: request.rule,
      publicationBundle: request.bundle,
      manifestHash: parsed.data.manifestHash,
    },
    now,
  );
  return admissible
    ? plan
    : { ...plan, decision: "blocked", reasons: [...plan.reasons, "release_not_admissible"] };
}

/**
 * Releases a planned version. The operator confirms it by naming the release's manifest hash. Its
 * sources' stored texts are checked before the transaction opens, so no storage is read while it
 * holds locks; inside it, the version must still be the next one, each capture must still be its
 * watch's current one, and the rule's earlier published versions are superseded so the checker
 * never holds two. Saved assessments are not touched. Development only.
 */
export async function applyStoredRuleRelease(
  request: RuleReleaseRequest,
  confirmedManifestHash: string,
  options: { now?: Date; readText?: (snapshotId: string, checksum: string) => Promise<string> } = {},
) {
  assertDevelopmentRuntime();
  const now = options.now ?? new Date();
  const plan = await planStoredRuleRelease(request, now);
  if (plan.decision !== "ready") throw new Error(`RULE_RELEASE_BLOCKED:${plan.reasons.join(",")}`);
  const rule = ruleSchema.parse(request.rule);
  if (confirmedManifestHash !== rule.manifestHash) throw new Error("RULE_RELEASE_NOT_CONFIRMED");
  const captures = await verifyReleasedSources(
    db,
    request.bundle,
    request.snapshotIds,
    now,
    options.readText ?? readSourceText,
  );
  const id = randomUUID();
  const superseded = await db.transaction(async (tx) => {
    await lockSourceState(tx, true);
    if ((await latestStoredVersion(tx, rule.id)) !== rule.version - 1)
      throw new Error("RULE_RELEASE_VERSION_CHANGED");
    await tx.insert(valoRuleReleases).values({
      id,
      ruleId: rule.id,
      version: rule.version,
      status: "published",
      rule: request.rule,
      publicationBundle: request.bundle,
      manifestHash: rule.manifestHash,
      publishedAt: now,
    });
    await bindVerifiedSources(tx, "rule", id, request.bundle, captures, now);
    return tx
      .update(valoRuleReleases)
      .set({ status: "superseded" })
      .where(
        and(
          eq(valoRuleReleases.ruleId, rule.id),
          eq(valoRuleReleases.status, "published"),
          ne(valoRuleReleases.id, id),
        ),
      )
      .returning({ version: valoRuleReleases.version });
  });
  return { id, ruleId: rule.id, version: rule.version, superseded: superseded.map((r) => r.version) };
}
