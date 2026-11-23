import assert from "node:assert/strict";
import test from "node:test";
import {
  assess,
  checkerFactsSchema,
  evaluateOwnerRuleBundle,
  evaluatePublication,
  ownerRuleBundleSchema,
  ownerRuleMatchesBundle,
  releaseEvidence,
  ruleSchema,
  type OwnerRuleBundle,
} from "@workspace/valo-core";
import { syntheticOwnerRuleRelease } from "../../test-support/synthetic-rule-release";

// Decision 0020: a requirements-checker rule released on the development owner's sign-off. These are
// in-memory fixtures; nothing is released, and no model or person reviewed them.
const now = new Date("2026-11-14T12:00:00Z");
const asOfDate = "2026-11-14";
const facts = (changes: Record<string, unknown> = {}) =>
  checkerFactsSchema.parse({
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
    ...changes,
  });
const scenarios: OwnerRuleBundle["scenarios"] = [
  { id: "company-matches", facts: facts(), asOfDate, expectedLabel: "Likely relevant", critical: true },
];
const release = () =>
  syntheticOwnerRuleRelease({
    ruleId: "synthetic-owner-rule",
    version: 1,
    condition: { mode: "all", predicates: [{ field: "legalForm", op: "eq", value: "company" }] },
    source: {
      url: "https://www.cac.gov.ng/synthetic-passage",
      text: "Synthetic official passage for a controlled test.",
      quote: "Synthetic official passage",
    },
    now,
    scenarios,
  });

test("an owner-signed rule bundle carries no AI run or review record, and its evidence passes the reviewed route's checks", () => {
  const { rule, bundle, reviewed } = release();
  assert.equal(rule.provenance, "owner_signoff");
  assert.deepEqual(evaluateOwnerRuleBundle(bundle, now), { decision: "eligible", reasons: [] });
  assert.equal(evaluatePublication(reviewed.bundle, now).decision, "eligible");
  assert.ok(ownerRuleMatchesBundle(rule, bundle));
  // A review record has no place in the bundle, so none can be added to it.
  for (const extra of [{ draftRun: reviewed.bundle.draftRun }, { reviews: reviewed.bundle.reviews }])
    assert.equal(ownerRuleBundleSchema.safeParse({ ...bundle, ...extra }).success, false);
  assert.equal(ownerRuleBundleSchema.safeParse({ ...bundle, scenarios: [] }).success, false);
});

test("the same altered evidence is refused for the same reason by the owner-signed and the reviewed route", () => {
  // What both bundles share, which each alteration changes.
  type Parts = {
    candidate: {
      scope: string;
      body: string;
      sourceCheckDate: string;
      unresolvedMaterialIssues: string[];
      claims: { quote: string }[];
    };
    sources: { url: string; text: string; amendmentsResolved: boolean; freshUntil: string }[];
    policy: { ownerApproved: boolean; risks: string[] };
    rights: { status: "cleared" | "unknown" | "denied" };
  };
  const alterations: [string, (parts: Parts) => void, string][] = [
    ["a changed candidate", (p) => void (p.candidate.scope = "Changed scope"), "candidate_hash_mismatch"],
    [
      "a policy the owner has not approved",
      (p) => void (p.policy.ownerApproved = false),
      "policy_not_owner_approved",
    ],
    ["a policy changed after its hash", (p) => void p.policy.risks.push("tax"), "policy_hash_mismatch"],
    [
      "an unresolved material issue",
      (p) => void p.candidate.unresolvedMaterialIssues.push("Synthetic open question"),
      "material_uncertainty",
    ],
    [
      "a source off the official hosts",
      (p) => void (p.sources[0]!.url = "https://example.invalid/passage"),
      "source_not_allowlisted:synthetic-source",
    ],
    [
      "a source whose text changed",
      (p) => void (p.sources[0]!.text += " Changed."),
      "source_hash_mismatch:synthetic-source",
    ],
    [
      "a source whose amendments are unresolved",
      (p) => void (p.sources[0]!.amendmentsResolved = false),
      "source_unresolved:synthetic-source",
    ],
    [
      "a source past its freshness",
      (p) => void (p.sources[0]!.freshUntil = "2026-11-01T00:00:00Z"),
      "source_not_current:synthetic-source",
    ],
    [
      "a claim its source does not hold",
      (p) => void (p.candidate.claims[0]!.quote = "Words the source does not hold"),
      "unsupported_claim:synthetic passage",
    ],
    ["rights not cleared", (p) => void (p.rights.status = "unknown"), "rights_not_cleared"],
    [
      "a source check in the future",
      (p) => void (p.candidate.sourceCheckDate = "2026-12-01T00:00:00Z"),
      "source_check_in_future",
    ],
    [
      "a claim of professional approval",
      (p) => void (p.candidate.body += " guaranteed compliant"),
      "unsupported_professional_claim",
    ],
  ];
  for (const [name, alter, reason] of alterations) {
    const { bundle, reviewed } = release();
    const owner = structuredClone(bundle);
    const other = structuredClone(reviewed.bundle);
    alter(owner);
    alter(other);
    assert.ok(evaluateOwnerRuleBundle(owner, now).reasons.includes(reason), `owner-signed: ${name}`);
    assert.ok(evaluatePublication(other, now).reasons.includes(reason), `reviewed: ${name}`);
  }
});

test("an owner-signed bundle holds a rule that is not sourced guidance, has no critical scenario or no longer matches its manifest", () => {
  const { bundle } = release();
  const held = (alter: (b: OwnerRuleBundle) => void) => {
    const copy = structuredClone(bundle);
    alter(copy);
    return evaluateOwnerRuleBundle(copy, now).reasons;
  };
  assert.ok(
    held((b) => void (b.candidate.contentClass = "practical_guide")).includes("rule_not_sourced_guidance"),
  );
  assert.ok(held((b) => void (b.scenarios[0]!.critical = false)).includes("no_critical_scenario"));
  assert.ok(
    held((b) => void (b.scenarios[0]!.expectedLabel = "May apply")).includes(
      "manifest_mismatch:scenariosHash",
    ),
  );
  assert.ok(held((b) => void (b.rights.evidence = "Other")).includes("manifest_mismatch:rightsHash"));
});

test("only a stored rule that is exactly the signed bundle's rule matches it", () => {
  const { rule, bundle } = release();
  const changed = (change: Record<string, unknown>) => ruleSchema.parse({ ...rule, ...change });
  assert.equal(ownerRuleMatchesBundle(changed({ provenance: "editorial_release" }), bundle), false);
  assert.equal(ownerRuleMatchesBundle(changed({ manifestHash: "c".repeat(64) }), bundle), false);
  assert.equal(ownerRuleMatchesBundle(changed({ reason: "A different reason." }), bundle), false);
  assert.equal(
    ownerRuleMatchesBundle(
      changed({ sources: [{ ...rule.sources[0]!, quote: "Not in the source" }] }),
      bundle,
    ),
    false,
  );
});

test("the checker holds an owner-signed rule until the registry trusts its manifest", () => {
  const { rule } = release();
  const untrusted = assess(facts(), [rule], asOfDate, now);
  assert.deepEqual(untrusted.items, []);
  assert.ok(untrusted.gaps.includes("synthetic-owner-rule: No trusted eligible publication manifest"));
  const trusted = assess(facts(), [rule], asOfDate, now, {
    trustedManifestHashes: new Set([rule.manifestHash]),
  });
  assert.deepEqual(
    trusted.items.map((item) => [item.ruleId, item.label]),
    [["synthetic-owner-rule", "Likely relevant"]],
  );
});

test("the source checks read the candidate and sources of a reviewed and of an owner-signed bundle, and nothing else", () => {
  const { bundle, reviewed } = release();
  assert.deepEqual(releaseEvidence(bundle), { candidate: bundle.candidate, sources: bundle.sources });
  assert.deepEqual(releaseEvidence(reviewed.bundle), {
    candidate: reviewed.bundle.candidate,
    sources: reviewed.bundle.sources,
  });
  // An owner-signed candidate cannot say it was AI drafted and reviewed, and no other shape is read.
  assert.equal(releaseEvidence({ ...bundle, candidate: reviewed.bundle.candidate }), null);
  assert.equal(releaseEvidence({ candidate: bundle.candidate, sources: bundle.sources }), null);
  assert.equal(releaseEvidence(null), null);
});
