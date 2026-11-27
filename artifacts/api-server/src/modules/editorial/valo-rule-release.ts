import { randomUUID } from "node:crypto";
import { and, eq, ne, sql } from "drizzle-orm";
import type { db } from "@workspace/db";
import {
  checkerFactsSchema,
  planRuleRelease,
  ruleSchema,
  type RuleReleasePlan,
  type RuleScenario,
} from "@workspace/valo-core";
import {
  bindVerifiedSources,
  closeSupersededReviewWork,
  verifyReleasedSources,
  readSourceText,
  lockSourceState,
} from "../sources";
import { currentAssessmentDate, releasedRegistry, ruleReleaseEligible } from "../rules";
import { assertDevelopmentRuntime } from "../../platform/valo-development-runtime";

/** A new version of a rule, as the editorial pipeline hands it over for release (ADM-004). */
export type RuleReleaseRequest = {
  rule: unknown;
  /** Its publication bundle: the reviewed candidate, sources, policy and manifest. */
  bundle: unknown;
  scenarios: RuleScenario[];
  /** For each bundle source, the retained capture its passages are checked against. */
  snapshotIds: Record<string, string>;
  /** What changed in this version, of 20 to 1,000 characters, when it replaces a released one. The
   * businesses that saved a result or made a task under the old version are told it
   * (docs/architecture/rule-changes.md). */
  reason?: string;
};

/** Who the reviewed route's release command records as making a change: it runs on the server with
 * no signed-in identity, so it names itself. */
export const RULE_RELEASE_COMMAND = "operator:rule-release";

/** A rule change's reason as both routes record it: trimmed, and of 20 to 1,000 characters. Null when
 * none is given or it is too short once trimmed. */
export function ruleChangeReason(reason: string | undefined) {
  const trimmed = reason?.trim() ?? "";
  return trimmed.length >= 20 && trimmed.length <= 1000 ? trimmed : null;
}

/**
 * Records why each of a rule's released versions is leaving the requirements check, in the
 * transaction that then supersedes or withdraws it (docs/architecture/rule-changes.md, slice 1). The
 * database counts, as each record is written, the workspaces, saved results and tasks made under that
 * version, and refuses the status change without its record.
 */
export async function recordRuleChanges(
  tx: Pick<typeof db, "insert">,
  change: {
    ruleId: string;
    versions: readonly number[];
    kind: "replaced" | "withdrawn";
    replacementVersion?: number;
    reason: string;
    recordedBy: string;
  },
) {
  if (!change.versions.length) return;
  const { valoRuleChanges } = await import("@workspace/db");
  await tx.insert(valoRuleChanges).values(
    change.versions.map((version) => ({
      ruleId: change.ruleId,
      version,
      kind: change.kind,
      replacementVersion: change.kind === "replaced" ? change.replacementVersion! : null,
      reason: change.reason,
      recordedBy: change.recordedBy,
    })),
  );
}

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
  /** The guidance policy as it stands, for an owner-signed rule (decision 0020). */
  guidance?: { hash: string; ownerApproved: boolean },
): Promise<RuleReleasePlan> {
  const { db } = await import("@workspace/db");
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
    guidance,
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
  const { db, valoRuleReleases } = await import("@workspace/db");
  assertDevelopmentRuntime();
  const now = options.now ?? new Date();
  const plan = await planStoredRuleRelease(request, now);
  if (plan.decision !== "ready") throw new Error(`RULE_RELEASE_BLOCKED:${plan.reasons.join(",")}`);
  const rule = ruleSchema.parse(request.rule);
  if (confirmedManifestHash !== rule.manifestHash) throw new Error("RULE_RELEASE_NOT_CONFIRMED");
  // A version that replaces a released one says what changed (docs/architecture/rule-changes.md).
  const reason = ruleChangeReason(request.reason);
  const releasedNow = async (reader: Reader) =>
    (
      await reader.execute<{ version: number }>(
        sql`select version from valo_rule_releases where rule_id=${rule.id} and status='published' order by version`,
      )
    ).rows.map((row) => Number(row.version));
  if (!reason && (await releasedNow(db)).length) throw new Error("RULE_RELEASE_REASON_REQUIRED");
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
    const replaced = (await releasedNow(tx)).filter((version) => version !== rule.version);
    if (replaced.length) {
      if (!reason) throw new Error("RULE_RELEASE_REASON_REQUIRED");
      await recordRuleChanges(tx, {
        ruleId: rule.id,
        versions: replaced,
        kind: "replaced",
        replacementVersion: rule.version,
        reason,
        recordedBy: RULE_RELEASE_COMMAND,
      });
    }
    // The release settles the review work of the rule's earlier versions (source-register.md, slice 3).
    await closeSupersededReviewWork(tx, "rule", rule.id, rule.version, id);
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
