import { explainAssessmentChanges, type AssessmentChange } from "./assessment-changes";
import { assess, ruleSchema, type CheckerFacts, type ReleasedRule } from "./checker";

/** A case a rule's release must get right: these answers, on this date, give this result. */
export type RuleScenario = {
  id: string;
  facts: CheckerFacts;
  asOfDate: string;
  /** The result label the rule must give, or null when it must not appear at all. */
  expectedLabel: string | null;
  /** A failed critical scenario blocks the release; any other failure is reported. */
  critical: boolean;
};

export type RuleReleasePlan = {
  decision: "ready" | "blocked";
  reasons: string[];
  scenarios: {
    id: string;
    critical: boolean;
    expectedLabel: string | null;
    actualLabel: string | null;
    /** What the requirements check would tell the customer for these answers, were the rule released;
     * null when the rule gives no result for them. */
    actualReason: string | null;
    actualNextStep: string | null;
    passed: boolean;
  }[];
  /** How many saved profiles were run, and how this rule's result would change for each that changes. */
  affected: { profiles: number; changes: { profile: number; change: AssessmentChange }[] };
};

type Run = {
  now: Date;
  asOfDate: string;
  fixtureMode?: boolean;
  /** The manifests of the released rules in `current` that the registry trusts. */
  trustedManifestHashes?: ReadonlySet<string>;
};
const items = (
  facts: CheckerFacts,
  rules: ReleasedRule[],
  run: Run,
  trusted: ReadonlySet<string> | undefined,
  asOfDate = run.asOfDate,
) =>
  assess(facts, rules, asOfDate, run.now, {
    ...(run.fixtureMode ? { fixtureMode: true } : {}),
    ...(trusted ? { trustedManifestHashes: trusted } : {}),
  }).items;

/**
 * ADM-004: what releasing a new version of a rule would do, worked out before anything is
 * published. The candidate's condition must parse, its version must be the next one for its rule,
 * and it must carry at least one critical scenario. Every scenario is run with the candidate in
 * place of the rule's current version; a failed critical scenario blocks the release and any other
 * failure is reported. Each saved profile is then run under the current and the candidate rules to
 * show whose result would change and how. Nothing here writes or publishes anything.
 */
export function planRuleRelease(
  input: {
    candidate: unknown;
    current: ReleasedRule[];
    scenarios: RuleScenario[];
    profiles: CheckerFacts[];
    /** The rule's highest version ever released, admitted or not; by default, its highest in `current`. */
    latestVersion?: number;
  } & Run,
): RuleReleasePlan {
  const blocked = (reasons: string[]): RuleReleasePlan => ({
    decision: "blocked",
    reasons,
    scenarios: [],
    affected: { profiles: 0, changes: [] },
  });
  const parsed = ruleSchema.safeParse(input.candidate);
  if (!parsed.success)
    return blocked(parsed.error.issues.map((issue) => `condition_schema_invalid:${issue.path.join(".")}`));
  const candidate = parsed.data;
  const reasons: string[] = [];
  const latest =
    input.latestVersion ??
    Math.max(0, ...input.current.filter((r) => r.id === candidate.id).map((r) => r.version));
  if (candidate.version !== latest + 1) reasons.push("version_not_next");
  if (!input.scenarios.some((s) => s.critical)) reasons.push("no_critical_scenario");
  const released = [...input.current.filter((r) => r.id !== candidate.id), candidate];
  // The plan asks what the checker would give were the candidate released, so its manifest is
  // trusted for these runs only; whether the registry would admit it is checked separately.
  const trustedNow = input.trustedManifestHashes;
  const trustedAfter = trustedNow && new Set([...trustedNow, candidate.manifestHash]);
  const scenarios = input.scenarios.map((s) => {
    const item = items(s.facts, released, input, trustedAfter, s.asOfDate).find(
      (i) => i.ruleId === candidate.id,
    );
    const actualLabel = item?.label ?? null;
    const passed = actualLabel === s.expectedLabel;
    if (!passed && s.critical) reasons.push(`critical_scenario_failed:${s.id}`);
    return {
      id: s.id,
      critical: s.critical,
      expectedLabel: s.expectedLabel,
      actualLabel,
      actualReason: item?.reason ?? null,
      actualNextStep: item?.nextStep ?? null,
      passed,
    };
  });
  const changes = input.profiles.flatMap((facts, profile) =>
    explainAssessmentChanges(
      items(facts, input.current, input, trustedNow),
      items(facts, released, input, trustedAfter),
      [],
    )
      .filter((change) => change.ruleId === candidate.id)
      .map((change) => ({ profile, change })),
  );
  return {
    decision: reasons.length ? "blocked" : "ready",
    reasons,
    scenarios,
    affected: { profiles: input.profiles.length, changes },
  };
}

/**
 * ADM-004: restoring a prior version releases its content again as the rule's next version. Earlier
 * versions are not changed, so every saved assessment keeps the version it was made with, and the
 * restored version goes through the same release plan as any other.
 */
export function restoredRuleVersion(history: ReleasedRule[], ruleId: string, version: number): ReleasedRule {
  const versions = history.filter((r) => r.id === ruleId);
  const source = versions.find((r) => r.version === version);
  if (!source) throw new Error("RULE_VERSION_UNKNOWN");
  const latest = Math.max(...versions.map((r) => r.version));
  if (version === latest) throw new Error("RULE_VERSION_ALREADY_CURRENT");
  return ruleSchema.parse({ ...source, version: latest + 1 });
}
