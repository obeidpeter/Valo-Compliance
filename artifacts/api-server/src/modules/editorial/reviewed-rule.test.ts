import assert from "node:assert/strict";
import test from "node:test";
import {
  candidateDigest,
  canonical,
  digest,
  disclosure,
  evaluatePublication,
  mandatoryEnhancedChecks,
  preparedRuleIds,
  sha256,
  type PublicationBundle,
} from "@workspace/valo-core";
import { GUIDANCE_NOTICE, noticeFor, savedLine } from "@workspace/valo-core/printed-page";

// The reviewed route's builder for a rule prepared in the repository (docs/architecture/reviewed-route.md,
// part 3). The rule is the repository's business-name rule; what stands in is said where it is made:
// today's capture of its official source is the retained passage of the Act, under the checksum its
// amendment record describes; the rights record for this route is a synthetic one, since the owner has
// chosen none; and in the last steps the two reviews and the files' inspection. Nothing is read from a
// database, rendered, reviewed or released.
process.env.DATABASE_URL ??= "postgresql://unused@localhost/unused";
const { ownerRuleCandidates } = await import("./owner-rule-candidates");
const reviewed = await import("./reviewed-rule");
const {
  capturedGuidePassages,
  guideAmendmentRecords,
  guidancePolicy,
  guideOpenReasons,
  retainedGuidePassages,
} = await import("../publication");
const { ruleReleaseEligible } = await import("../rules");

const now = new Date("2026-11-28T12:00:00Z");
const checkedAt = "2026-11-28T08:00:00.000Z";
const businessName = ownerRuleCandidates.find((c) => c.rule.id === "cac-business-name-814")!;
const standInRights: PublicationBundle["rights"] = {
  status: "cleared",
  evidence: "Synthetic rights record for a test of the reviewed route; not the owner's choice.",
  evidenceHash: sha256("Synthetic rights record for a test of the reviewed route; not the owner's choice."),
  commercialUse: true,
};
const prepared = { ...businessName, reviewedRouteRights: standInRights };
const passage = retainedGuidePassages()("CAMA-814")!;
const record = guideAmendmentRecords.find((r) => r.instrument === passage.instrument.id)!;
const captureOf = (text = `Front matter.\n\f\n${passage.text}\n\f\nMore of the Act.`) => ({
  leadId: "SV-010",
  url: passage.instrument.url,
  snapshotId: "00000000-0000-4000-8000-000000000001",
  checkedAt,
  rawChecksum: record.rawSha256,
  textChecksum: sha256(text),
  text,
});
const { policy } = await guidancePolicy();
const build = (
  candidate: typeof prepared | typeof businessName = prepared,
  captures = [captureOf()],
  at = now,
) =>
  reviewed.buildReviewedRule(candidate, {
    version: 1,
    captures,
    passages: capturedGuidePassages(captures),
    records: guideAmendmentRecords,
    policy,
    now: at,
  });
/** The inspection of two files that held the whole sheet (a stand-in: nothing is rendered here). */
const inspected = (built: ReturnType<typeof build>) => {
  const facts = {
    parsed: true,
    completeContent: true,
    disclosureIncluded: true,
    scopeIncluded: true,
    limitationsIncluded: true,
    sourceDateIncluded: true,
    missingTextHashes: [],
  };
  return {
    formats: { docx: facts, pdf: facts },
    hashes: { docx: sha256(`docx ${built.candidate.hash}`), pdf: sha256(`pdf ${built.candidate.hash}`) },
  };
};
const result = (checks: PublicationBundle["mechanicalChecks"], name: string) =>
  checks.find((c) => c.name === name)!.result;

test("the rules prepared for release are the repository's", () => {
  assert.deepEqual(
    [...preparedRuleIds],
    ownerRuleCandidates.map((c) => c.rule.requirementVersionId),
  );
});

test("a rule with today's capture of its source, a current amendment record and a rights record for this route waits only for its two reviews, and the registry admits it once they pass", () => {
  const built = build();
  assert.deepEqual(built.holds, []);
  assert.equal(built.rule.provenance, "editorial_release");
  assert.equal(built.rule.version, 1);
  assert.equal(built.candidate.id, "CAC-BUSINESS-NAME-814");
  assert.equal(built.candidate.disclosure, disclosure);
  assert.equal(built.candidate.legalScopeStatus, "verified");
  assert.equal(built.candidate.sourceCheckDate, checkedAt);
  assert.deepEqual(built.rights, standInRights);
  assert.equal(built.policy.hash, policy.hash);
  assert.deepEqual(built.snapshotIds, { "cama-814": "00000000-0000-4000-8000-000000000001" });
  assert.deepEqual(
    built.passages.map((p) => [p.sourceId, p.id, p.instrument.id]),
    [["cama-814", "CAMA-814", "CAC-CAMA-2020"]],
  );
  assert.deepEqual(
    built.sources.map((s) => [s.id, s.status, s.operativeTextConfirmed, s.amendmentsResolved, s.text]),
    [["cama-814", "approved", true, true, passage.text]],
  );
  // The drafting record says what is known of how the rule was written, and binds it.
  assert.equal(built.draftRun.model, reviewed.REPOSITORY_RULE_DRAFT.model);
  assert.equal(built.draftRun.runId, `repository-rule:${digest(prepared)}`);
  assert.equal(built.draftRun.candidateHash, built.candidate.hash);
  assert.equal(built.draftRun.evidenceHash, digest(built.sources));
  assert.deepEqual(
    built.mechanicalChecks.map((c) => [c.name, c.result]),
    built.mechanicalChecks.map((c) => [c.name, "pass"]),
  );

  // Before its reviews, only they hold it.
  const { bundle } = reviewed.reviewedRuleBundle(built, inspected(built));
  assert.equal(bundle.manifest.status, "review");
  assert.deepEqual(guideOpenReasons(evaluatePublication(bundle, now)), []);

  // Once two reviews have passed, with the five enhanced checks they ran (stand-ins), the bundle is
  // eligible and the rule registry admits the release, as the release command would store it.
  const run = (role: "factual" | "challenge") => ({
    runId: `synthetic-${role}-review`,
    model: "synthetic-test-not-an-actual-provider",
    promptVersion: "fixture-only",
    candidateHash: built.candidate.hash,
    evidenceHash: digest(built.sources),
    role,
    verdict: "pass" as const,
    findings: [],
    receivedOtherVerdict: false,
  });
  const enhancedChecks = mandatoryEnhancedChecks.map((name) => ({
    name,
    candidateHash: built.candidate.hash,
    result: "pass" as const,
    evidenceHash: sha256(`synthetic ${name}`),
  }));
  const complete = reviewed.reviewedRuleBundle(built, inspected(built), {
    reviews: [run("factual"), run("challenge")],
    enhancedChecks,
  });
  assert.equal(complete.bundle.manifest.status, "eligible");
  assert.deepEqual(evaluatePublication(complete.bundle, now), { decision: "eligible", reasons: [] });
  // A review that holds, or passes with a finding, leaves the bundle under review, and the gate holds it.
  for (const change of [{ verdict: "hold" as const }, { findings: ["A finding a review recorded."] }]) {
    const held = reviewed.reviewedRuleBundle(built, inspected(built), {
      reviews: [run("factual"), { ...run("challenge"), ...change }],
      enhancedChecks,
    });
    assert.equal(held.bundle.manifest.status, "review");
    assert.equal(evaluatePublication(held.bundle, now).decision, "hold");
  }
  assert.ok(
    ruleReleaseEligible(
      {
        ruleId: complete.rule.id,
        version: complete.rule.version,
        status: "published",
        rule: complete.rule,
        publicationBundle: complete.bundle,
        manifestHash: complete.rule.manifestHash,
      },
      now,
    ),
  );
});

test("with no rights record for this route, each rule is held and its bundle's rights are not cleared", () => {
  const built = build(businessName);
  assert.ok(built.holds.includes(reviewed.REVIEWED_ROUTE_RIGHTS_MISSING));
  assert.equal(built.rights.status, "unknown");
  assert.equal(built.rights.commercialUse, false);
  assert.equal(result(built.mechanicalChecks, "rights"), "fail");
  const { bundle } = reviewed.reviewedRuleBundle(built, inspected(built));
  assert.ok(guideOpenReasons(evaluatePublication(bundle, now)).includes("rights_not_cleared"));
  // None of the repository's rules has one yet: the owner has chosen no basis for this route.
  for (const candidate of ownerRuleCandidates) {
    assert.equal(candidate.reviewedRouteRights, undefined, candidate.rule.id);
    const held = reviewed.buildReviewedRule(candidate, {
      version: 1,
      captures: [],
      passages: () => undefined,
      records: guideAmendmentRecords,
      policy,
      now,
    });
    assert.ok(held.holds.includes(reviewed.REVIEWED_ROUTE_RIGHTS_MISSING), candidate.rule.id);
  }
});

test("a source with no copy checked within the last day, a copy that lacks its passage, or an amendment record out of date holds the rule", () => {
  const none = build(prepared, []);
  assert.ok(none.holds.some((h) => /has no copy of its official source checked within the last day/.test(h)));
  assert.equal(none.candidate.legalScopeStatus, "unverified");
  assert.deepEqual(none.snapshotIds, {});
  const without = build(prepared, [captureOf("A copy of the Act without the section.")]);
  assert.ok(without.holds.some((h) => /does not hold passage CAMA-814/.test(h)));
  // A month after its searches, the Act's amendment record no longer marks the source current.
  const later = build(prepared, [captureOf()], new Date("2026-12-28T12:00:00Z"));
  assert.ok(later.holds.length > 0);
  assert.equal(later.sources[0]!.status, "held");
});

test("each mechanical check fails on what it measures", () => {
  const built = build();
  const check = (change: Partial<Parameters<typeof reviewed.ruleMechanicalChecks>[0]>, name: string) => {
    const checks = reviewed.ruleMechanicalChecks({
      prepared,
      rule: built.rule,
      bundle: built,
      trustedPolicy: policy,
      now,
      ...change,
    });
    assert.equal(result(checks, name), "fail", name);
    return checks;
  };
  const candidate = (change: Partial<PublicationBundle["candidate"]>) => ({
    ...built,
    candidate: { ...built.candidate, ...change },
  });
  // A candidate changed and given its own hash again, so that only the check that measures the change
  // can find it.
  const rehashed = (change: Partial<PublicationBundle["candidate"]>) => {
    const changed = { ...built.candidate, ...change };
    return { ...built, candidate: { ...changed, hash: candidateDigest(changed) } };
  };
  // The body is not the rule.
  check({ bundle: rehashed({ body: `${built.candidate.body} ` }) }, "schema");
  // A quotation the source's passage does not hold.
  check(
    {
      rule: { ...built.rule, sources: [{ ...built.rule.sources[0]!, quote: "words the Act does not have" }] },
    },
    "source_locators",
  );
  // A review date past the thirty days a rule that is not general stays fresh, on the rule and its
  // candidate alike.
  const late = new Date(Date.parse(checkedAt) + 31 * 86_400_000).toISOString();
  check({ rule: { ...built.rule, reviewBy: late }, bundle: candidate({ reviewBy: late }) }, "dates");
  // A policy other than the guidance policy.
  check({ trustedPolicy: { ...policy, hash: "f".repeat(64) } }, "scope");
  // A number in a claim that its quotation does not hold.
  check(
    {
      bundle: candidate({
        claims: [{ ...built.candidate.claims[0]!, numbers: ["814(9)"] }, ...built.candidate.claims.slice(1)],
      }),
    },
    "numeric_extraction",
  );
  // A rights record other than the one for this route.
  check({ bundle: { ...built, rights: { ...standInRights, commercialUse: false } } }, "rights");
  // A blank title, with a body that is the rule it is in.
  const untitled = { ...built.rule, title: " " };
  check({ rule: untitled, bundle: rehashed({ body: canonical(untitled) }) }, "required_fields");
  // Another disclosure.
  check({ bundle: candidate({ disclosure: "Reviewed" as typeof disclosure }) }, "disclosures");
  // A calculation that is not the code's.
  check(
    { rule: { ...built.rule, evaluator: { ...built.rule.evaluator!, algorithmHash: "e".repeat(64) } } },
    "arithmetic",
  );
  // A critical scenario whose expected result the rule does not give.
  check(
    {
      prepared: {
        ...prepared,
        scenarios: [
          { ...prepared.scenarios[0]!, expectedLabel: "Likely relevant" },
          ...prepared.scenarios.slice(1),
        ],
      },
    },
    "rule_fixtures",
  );
});

test("the rule's sheet holds what the check shows for it, where to act, its scope, limits, sources, disclosure and source date", () => {
  const built = build();
  const texts = built.sheet.content.blocks.map((b) => b.text);
  assert.equal(built.sheet.title, businessName.rule.title);
  assert.ok(texts.includes(`Why it may matter: ${businessName.rule.reason}`));
  assert.ok(texts.includes(`What to do next: ${businessName.rule.nextStep}`));
  assert.ok(
    texts.includes(
      `Where to do it: ${businessName.rule.officialRoute!.authority}, ${businessName.rule.officialRoute!.url}`,
    ),
  );
  assert.ok(texts.includes(`What it covers: ${businessName.scope}`));
  assert.ok(texts.includes(`Limits you should know: ${businessName.limitations}`));
  assert.ok(texts.includes(businessName.assumptions.join("\n")));
  assert.ok(texts.some((t) => t.includes(`"${businessName.sources[0]!.quote}"`)));
  assert.ok(texts.includes(`How it was written and checked: ${disclosure}`));
  assert.ok(texts.includes(reviewed.RULE_REVIEW_MEANING));
  assert.ok(texts.includes(`Sources checked: 28 Nov 2026 (${checkedAt}).`));
  // It prints under the guidance notice and names the rule's version, not a guide's.
  assert.equal(noticeFor("rule_sheet"), GUIDANCE_NOTICE);
  assert.equal(reviewed.RULE_SHEET_NOTICE, GUIDANCE_NOTICE);
  assert.equal(savedLine("rule_sheet", 2), "Valo · Rule version 2");
  assert.equal(savedLine("guidance", 2), "Valo · Guide version 2");
});
