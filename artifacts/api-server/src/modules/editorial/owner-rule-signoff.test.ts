import assert from "node:assert/strict";
import test from "node:test";
import {
  allSourceLeads,
  checkerFactsSchema,
  digest,
  evaluateOwnerRuleBundle,
  ownerConfirmedChecks,
  ownerRuleMatchesBundle,
  sha256,
} from "@workspace/valo-core";

// Decision 0020: how a prepared rule becomes the rule and bundle the owner signs. These are
// in-memory fixtures with synthetic text; nothing is read, released or reviewed.
process.env.DATABASE_URL ??= "postgresql://unused@localhost/unused";
const signoff = await import("./owner-rule-signoff");
const now = new Date("2026-11-14T12:00:00Z");
const lead = allSourceLeads.find((l) => l.url.startsWith("https://") && l.url.includes(".gov.ng"))!;
const passage = "Synthetic official passage for a controlled test: keep a dated record of each sale.";
const quote = "keep a dated record of each sale";
const policyContent = {
  version: "synthetic-owner-rule-policy",
  ownerApproved: true,
  allowedClasses: ["sourced_guidance"],
  jurisdictions: ["NG"],
  risks: ["privacy"],
  officialHosts: [new URL(lead.url).hostname],
  blockedActivities: ["bespoke legal opinions"],
};
const policy = { ...policyContent, hash: digest(policyContent) };
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
const candidate = (leadId = lead.id): (typeof signoff.ownerRuleCandidates)[number] => ({
  rule: {
    id: "synthetic-owner-rule",
    requirementVersionId: "synthetic-requirement-owner-rule",
    title: "Synthetic owner-signed rule; not Nigerian guidance",
    jurisdiction: { level: "federal" },
    validFrom: "2026-01-01",
    validTo: null,
    reason: "Synthetic reason why this may matter.",
    nextStep: "Synthetic next step.",
    relatedTemplateIds: [],
    condition: { mode: "all", predicates: [{ field: "legalForm", op: "eq", value: "company" }] },
  },
  risk: "privacy",
  scope: "Synthetic sign-off testing only",
  limitations: "Not content for publication",
  assumptions: [],
  unresolvedMaterialIssues: [],
  missingEvidence: [],
  sources: [
    {
      id: "synthetic-source",
      leadId,
      title: "Synthetic passage",
      issuingBody: "Synthetic test authority",
      passage,
      locator: "synthetic passage",
      quote,
      effectiveFrom: "2026-01-01T00:00:00Z",
      effectiveTo: null,
    },
  ],
  claims: [
    {
      text: "Synthetic claim",
      kind: "source_statement",
      sourceId: "synthetic-source",
      quote,
      locator: "synthetic passage",
      numbers: [],
    },
  ],
  rights: {
    status: "cleared",
    evidence: "Synthetic rights fixture",
    evidenceHash: sha256("fixture"),
    commercialUse: true,
  },
  scenarios: [
    { id: "company", facts, asOfDate: "2026-11-14", expectedLabel: "Likely relevant", critical: true },
  ],
});
const checkedAt = "2026-11-14T08:00:00.000Z";
const capture = (text = `Front matter. ${passage} More text.`) => ({
  leadId: lead.id,
  url: lead.url,
  snapshotId: "00000000-0000-4000-8000-000000000001",
  checkedAt,
  rawChecksum: sha256("raw"),
  textChecksum: sha256(text),
  text,
});
const prepare = (input: Partial<Parameters<typeof signoff.prepareOwnerRule>[1]> = {}, leadId?: string) =>
  signoff.prepareOwnerRule(candidate(leadId), {
    version: 1,
    captures: [capture()],
    policy,
    confirmed: ownerConfirmedChecks,
    now,
    ...input,
  });

test("a prepared rule with a current copy of its source and every check confirmed makes a bundle the owner can sign", () => {
  const { rule, bundle, holds, snapshotIds, sourceCheckedAt } = prepare();
  assert.deepEqual(holds, []);
  assert.equal(rule.provenance, "owner_signoff");
  assert.equal(rule.status, "published");
  assert.deepEqual(evaluateOwnerRuleBundle(bundle, now), { decision: "eligible", reasons: [] });
  assert.ok(ownerRuleMatchesBundle(rule, bundle));
  assert.deepEqual(snapshotIds, { "synthetic-source": capture().snapshotId });
  // The source check is the copy's check, and a privacy rule is fresh for 30 days after it.
  assert.equal(sourceCheckedAt.toISOString(), checkedAt);
  assert.equal(rule.sourceCheckedAt, checkedAt);
  assert.equal(rule.reviewBy, "2026-12-14T08:00:00.000Z");
  assert.equal(bundle.sources[0]!.text, passage);
  // The same inputs make the same manifest, so the version the owner reads is the one signed.
  assert.equal(prepare().rule.manifestHash, rule.manifestHash);
});

test("without the owner's confirmations the rule's scope and source stay unresolved, and the manifest differs", () => {
  const unconfirmed = prepare({ confirmed: [] });
  const reasons = evaluateOwnerRuleBundle(unconfirmed.bundle, now).reasons;
  assert.ok(reasons.includes("legal_scope_unverified"));
  assert.ok(reasons.includes("source_unresolved:synthetic-source"));
  for (const check of ownerConfirmedChecks) {
    const partial = prepare({ confirmed: ownerConfirmedChecks.filter((c) => c !== check) });
    assert.equal(evaluateOwnerRuleBundle(partial.bundle, now).decision, "hold", check);
  }
  assert.notEqual(unconfirmed.rule.manifestHash, prepare().rule.manifestHash);
});

test("a rule is held without a current copy of its source, when the copy lacks the passage, and for an unregistered source", () => {
  const missing = prepare({ captures: [] });
  assert.deepEqual(missing.holds, [
    "Synthetic passage has no copy of its official source checked within the last day.",
  ]);
  assert.deepEqual(missing.snapshotIds, {});
  // With no copy at all, the rule is dated now so its scenarios can be shown; it cannot be signed.
  assert.equal(missing.rule.sourceCheckedAt, now.toISOString());
  const changed = prepare({ captures: [capture("The official copy now says something else.")] });
  assert.deepEqual(changed.holds, [
    "Synthetic passage: the official copy does not hold the passage at synthetic passage.",
  ]);
  // A copy of another address does not count for this source.
  assert.equal(
    prepare({ captures: [{ ...capture(), url: "https://example.invalid/other" }] }).holds.length,
    1,
  );
  const unknown = prepare({ captures: [] }, "SYNTHETIC-NOT-A-LEAD");
  assert.deepEqual(unknown.holds, ["Synthetic passage is not a registered official source."]);
  assert.ok(
    evaluateOwnerRuleBundle(unknown.bundle, now).reasons.includes("source_not_allowlisted:synthetic-source"),
  );
});

test("the screen says when a rule applies and what holds it in words", () => {
  assert.equal(
    signoff.describeRuleCondition({
      condition: {
        mode: "all",
        predicates: [
          { field: "legalForm", op: "eq", value: "company" },
          { field: "personalData", op: "in", value: ["yes", "not_sure"] },
        ],
      },
    }),
    "When legal form is company and personal data is one of yes, not sure.",
  );
  assert.equal(
    signoff.describeRuleCondition({
      condition: {
        mode: "any",
        predicates: [
          { field: "lga", op: "exists" },
          { field: "employees", op: "gte", value: 5 },
        ],
      },
    }),
    "When local government area is answered or employees is at least 5.",
  );
  assert.equal(
    signoff.ownerRuleHold("source_not_current:S1"),
    "Source S1 is not current: its check is out of date, or it is not in force.",
  );
  assert.equal(
    signoff.ownerRuleHold("critical_scenario_failed:company"),
    "Scenario company does not give the result it expects.",
  );
  assert.equal(signoff.ownerRuleHold("schema:candidate.hash:Invalid"), "The prepared rule is incomplete.");
  assert.equal(signoff.ownerRuleHold("something_new"), "Held: something_new.");
  assert.deepEqual(Object.keys(signoff.ownerCheckLabels).sort(), [...ownerConfirmedChecks].sort());
});

test("every rule prepared in the repository names registered sources that hold its quotes, and a critical scenario", () => {
  const ids = signoff.ownerRuleCandidates.map((c) => c.rule.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const c of signoff.ownerRuleCandidates) {
    assert.ok(
      c.scenarios.some((s) => s.critical),
      c.rule.id,
    );
    for (const s of c.sources) {
      assert.ok(
        allSourceLeads.some((l) => l.id === s.leadId),
        `${c.rule.id}: ${s.leadId}`,
      );
      assert.ok(s.passage.includes(s.quote), `${c.rule.id}: ${s.id}`);
    }
    for (const claim of c.claims)
      assert.ok(c.sources.find((s) => s.id === claim.sourceId)?.passage.includes(claim.quote), c.rule.id);
  }
});
