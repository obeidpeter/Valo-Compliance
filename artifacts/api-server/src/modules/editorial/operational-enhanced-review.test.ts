import { test } from "node:test";
import assert from "node:assert/strict";
import {
  candidateDigest,
  digest,
  disclosure,
  evaluatePublication,
  mandatoryEnhancedChecks,
  mandatoryMechanicalChecks,
  sha256,
  type PublicationBundle,
} from "@workspace/valo-core";
import {
  enhancedChecksFromReviews,
  enhancedOperationalReviewSchema,
  operationalReviewSchema,
  operationalReviewSchemaFor,
  type OperationalReviewOutput,
} from "../publication/operational-review-contract";
import type { OperationalServerEvidence } from "../publication/operational-review-contract";
import { operationalReviewRequests } from "./operational-review";

// Decision 0014: the two blind reviews run EDP-005's enhanced checks for content that is not
// general. Every record here is synthetic; nothing calls a model, and an enhanced check is an AI
// check, never legal, tax or regulatory review.
const now = new Date("2026-11-19T12:00:00Z");
const sourceText =
  "Synthetic provision 4: a notice is served by delivery to the registered address.\n" +
  "Synthetic provision 5: provision 4 does not apply to a notice served by consent.";
const sources: PublicationBundle["sources"] = [
  {
    id: "synthetic-source",
    url: "https://official.example.test/instrument",
    title: "Synthetic instrument",
    issuingBody: "Synthetic test authority",
    text: sourceText,
    hash: sha256(sourceText),
    jurisdiction: "NG",
    retrievedAt: "2026-11-18T00:00:00Z",
    freshUntil: "2026-11-25T00:00:00Z",
    effectiveFrom: "2026-01-01T00:00:00Z",
    effectiveTo: null,
    status: "approved",
    operativeTextConfirmed: true,
    amendmentsResolved: true,
  },
];
function candidate(risk: PublicationBundle["candidate"]["risk"]): PublicationBundle["candidate"] {
  const raw: Omit<PublicationBundle["candidate"], "hash"> = {
    id: "synthetic-enhanced-candidate",
    version: 1,
    body: JSON.stringify({
      title: "Synthetic notice clause",
      clause: 'Serve each "notice" by delivery to the registered address.',
    }),
    contentClass: "general_template",
    jurisdiction: "NG",
    risk,
    scope: "Synthetic enhanced-check testing only",
    limitations: "Not content for publication",
    assumptions: ["Synthetic company scenario"],
    unresolvedMaterialIssues: [],
    missingEvidence: [],
    sourceCheckDate: "2026-11-18T00:00:00Z",
    disclosure,
    legalScopeStatus: "verified",
    claims: [
      {
        text: "Notices are served by delivery",
        kind: "source_statement",
        sourceId: "synthetic-source",
        quote: "a notice is served by delivery to the registered address",
        locator: "synthetic provision 4",
        numbers: [],
      },
    ],
  };
  return { ...raw, hash: candidateDigest(raw) };
}
const passages: Record<(typeof mandatoryEnhancedChecks)[number], string> = {
  controlling_text: "a notice is served by delivery to the registered address.",
  amendments: "Synthetic provision 4:",
  effective_dates: "Synthetic provision 4",
  // Quoted across the source's line break, and from a string inside the candidate's JSON body.
  exceptions: "registered address. Synthetic provision 5: provision 4 does not apply",
  jurisdiction: 'Serve each "notice" by delivery',
};
function review(
  change: (checks: NonNullable<OperationalReviewOutput["enhancedChecks"]>) => void = () => undefined,
): OperationalReviewOutput {
  const checks = mandatoryEnhancedChecks.map((name) => ({
    name,
    result: "pass" as const,
    passage: passages[name],
    note: "Synthetic fixture result; not a genuine review",
  }));
  change(checks);
  return {
    verdict: "pass",
    findings: [],
    missingEvidence: [],
    observations: [],
    enhancedChecks: checks,
  };
}
const pair = (factual = review(), challenge = review()) => [
  { role: "factual" as const, output: factual },
  { role: "challenge" as const, output: challenge },
];
const results = (bundle: Pick<PublicationBundle, "candidate" | "sources">, reviews = pair()) =>
  Object.fromEntries(enhancedChecksFromReviews(bundle, reviews).map((c) => [c.name, c.result]));

function evidence(c: PublicationBundle["candidate"]): OperationalServerEvidence {
  return {
    candidateHash: c.hash,
    policyHash: sha256("synthetic policy"),
    sourceCheckedAt: c.sourceCheckDate,
    sourceHash: sha256("synthetic source"),
    provenanceArtifactHash: sha256("synthetic provenance"),
    rightsArtifactHash: sha256("synthetic rights"),
    exportReportArtifactHash: sha256("synthetic export report"),
    providerSnapshotHash: sha256("synthetic snapshot"),
    authoringRoute: "synthetic",
    sourceAttribution: "synthetic",
    performedChecks: ["synthetic"],
  };
}
const requests = (c: PublicationBundle["candidate"], withSources: PublicationBundle["sources"] = []) =>
  operationalReviewRequests(
    c,
    { scope: "synthetic rights" },
    { scope: "synthetic provenance" },
    { scope: "synthetic exports" },
    evidence(c),
    "2026-11-19T01:00:00.000Z",
    withSources,
  );

test("a general item's review requests are unchanged by the enhanced checks", () => {
  // The digest was recorded from the request builder as it stood before decision 0014 was built,
  // with these same synthetic inputs. A deliberate change to the general prompt records a new one.
  const raw: Omit<PublicationBundle["candidate"], "hash"> = {
    id: "TPL-12",
    version: 1,
    body: JSON.stringify({ title: "Synthetic payment reminder letter", sections: ["Synthetic body"] }),
    contentClass: "general_template",
    jurisdiction: "NG",
    risk: "general",
    scope: "Synthetic scope",
    limitations: "Synthetic limitations",
    assumptions: ["Synthetic assumption"],
    unresolvedMaterialIssues: [],
    missingEvidence: [],
    sourceCheckDate: "2026-11-19T00:00:00.000Z",
    reviewBy: "2027-05-19T00:00:00.000Z",
    disclosure,
    claims: [],
    evidenceMode: "original_operational",
    legalScopeStatus: "not_applicable",
  };
  const general = { ...raw, hash: candidateDigest(raw) };
  const built = operationalReviewRequests(
    general,
    { scope: "synthetic rights" },
    { scope: "synthetic provenance" },
    { scope: "synthetic exports" },
    {
      ...evidence(general),
      policyHash: sha256("policy"),
      sourceHash: sha256("source"),
      provenanceArtifactHash: sha256("provenance"),
      rightsArtifactHash: sha256("rights"),
      exportReportArtifactHash: sha256("export"),
      providerSnapshotHash: sha256("snapshot"),
    },
    "2026-11-19T01:00:00.000Z",
  );
  assert.equal(
    sha256(JSON.stringify(built)),
    "68715af9555b7c08f571353fc78014065f3c5abe4c07ec7e937805e21ef12f02",
  );
  for (const entry of built) {
    assert.equal(entry.promptVersion, `operational-${entry.role}-5`);
    assert.equal(entry.request.response_format.json_schema.name, "operational_review");
    assert.ok(!JSON.stringify(entry.request).includes("enhancedChecks"));
    assert.ok(!("sources" in JSON.parse(entry.request.messages[1]!.content)));
  }
  assert.equal(operationalReviewSchemaFor(general), operationalReviewSchema);
});

test("a review of content that is not general asks for every enhanced check and its passage", () => {
  const c = candidate("contracts");
  const built = requests(c, sources);
  assert.equal(built.length, 2);
  assert.notEqual(digest(built[0]!.request), digest(built[1]!.request));
  for (const entry of built) {
    assert.equal(entry.promptVersion, `operational-${entry.role}-enhanced-1`);
    const prompt = entry.request.messages[0]!.content;
    for (const name of mandatoryEnhancedChecks) assert.ok(prompt.includes(name), name);
    assert.match(prompt, /never legal, tax or regulatory review/);
    assert.match(prompt, /contracts content for NG/);
    // The reviewer sees the sources the checks are judged against.
    assert.deepEqual(JSON.parse(entry.request.messages[1]!.content).sources, sources);
    const format = entry.request.response_format.json_schema;
    assert.equal(format.name, "operational_enhanced_review");
    assert.equal(format.strict, true);
    // Strict structured output needs every property listed as required and no others allowed.
    const visit = (node: unknown) => {
      if (!node || typeof node !== "object") return;
      const schema = node as { type?: string; properties?: object; required?: string[] };
      if (schema.type === "object") {
        assert.deepEqual([...(schema.required ?? [])].sort(), Object.keys(schema.properties ?? {}).sort());
        assert.equal((node as { additionalProperties?: unknown }).additionalProperties, false);
      }
      Object.values(node).forEach(visit);
    };
    visit(format.schema);
    const item = (
      format.schema as unknown as {
        properties: {
          enhancedChecks: { items: { properties: { name: { enum: string[] } }; required: string[] } };
        };
      }
    ).properties.enhancedChecks.items;
    assert.deepEqual(item.properties.name.enum, [...mandatoryEnhancedChecks]);
    assert.ok(item.required.includes("passage"));
  }
  assert.equal(operationalReviewSchemaFor(c), enhancedOperationalReviewSchema);
  // Each risk class that is not general asks for the checks.
  for (const risk of ["tax", "employment", "privacy", "governance", "regulated_sector"] as const)
    for (const entry of requests(candidate(risk), sources))
      assert.equal(entry.request.response_format.json_schema.name, "operational_enhanced_review");
});

test("the enhanced review schema refuses a result without its passage", () => {
  const valid = review();
  assert.deepEqual(enhancedOperationalReviewSchema.parse(valid), valid);
  const without = structuredClone(valid) as { enhancedChecks: Record<string, unknown>[] };
  delete without.enhancedChecks[0]!.passage;
  assert.throws(() => enhancedOperationalReviewSchema.parse(without));
  const { enhancedChecks: _omitted, ...noChecks } = valid;
  assert.throws(() => enhancedOperationalReviewSchema.parse(noChecks));
  const unknown = structuredClone(valid);
  (unknown.enhancedChecks![0] as { name: string }).name = "legal_review";
  assert.throws(() => enhancedOperationalReviewSchema.parse(unknown));
  const extra = structuredClone(valid);
  (extra.enhancedChecks![0] as Record<string, unknown>).certifiedBy = "synthetic";
  assert.throws(() => enhancedOperationalReviewSchema.parse(extra));
  // A general review never carries enhanced checks.
  assert.throws(() => operationalReviewSchema.parse(valid));
});

test("an enhanced check passes only when both reviews pass it with a passage found word for word", () => {
  const bundle = { candidate: candidate("contracts"), sources };
  const all = enhancedChecksFromReviews(bundle, pair());
  assert.deepEqual(
    all.map((c) => [c.name, c.result, c.candidateHash]),
    mandatoryEnhancedChecks.map((name) => [name, "pass", bundle.candidate.hash]),
  );
  assert.ok(all.every((c) => /^[a-f0-9]{64}$/.test(c.evidenceHash)));
  // The order the reviews arrive in does not change the record.
  assert.deepEqual(enhancedChecksFromReviews(bundle, pair().reverse()), all);

  const failing: [string, (checks: NonNullable<OperationalReviewOutput["enhancedChecks"]>) => void][] = [
    ["exceptions", (checks) => (checks.find((c) => c.name === "exceptions")!.result = "fail")],
    [
      "amendments",
      (checks) =>
        checks.splice(
          checks.findIndex((c) => c.name === "amendments"),
          1,
        ),
    ],
    ["jurisdiction", (checks) => checks.push({ ...checks.find((c) => c.name === "jurisdiction")! })],
    [
      "controlling_text",
      (checks) => (checks.find((c) => c.name === "controlling_text")!.passage = "Synthetic invented passage"),
    ],
    ["effective_dates", (checks) => (checks.find((c) => c.name === "effective_dates")!.passage = "   ")],
  ];
  for (const [name, change] of failing)
    for (const reviews of [pair(review(change)), pair(undefined, review(change))]) {
      const got = results(bundle, reviews);
      assert.equal(got[name], "fail", name);
      assert.equal(Object.values(got).filter((r) => r === "fail").length, 1, `${name} alone fails`);
    }
  // A review that answers no enhanced checks fails them all.
  const none = review();
  delete none.enhancedChecks;
  assert.ok(Object.values(results(bundle, pair(none))).every((r) => r === "fail"));
  // A passage longer than the limit fails, even when it occurs.
  const long = "Synthetic long provision " + "x".repeat(2000);
  const longBundle = { ...bundle, sources: [{ ...sources[0]!, text: long, hash: sha256(long) }] };
  assert.equal(
    results(
      longBundle,
      pair(review((checks) => (checks.find((c) => c.name === "amendments")!.passage = long))),
    ).amendments,
    "fail",
  );
  // Both reviews are needed, one of each role.
  assert.throws(() => enhancedChecksFromReviews(bundle, pair().slice(0, 1)), /NEED_BOTH_REVIEWS/);
  assert.throws(
    () => enhancedChecksFromReviews(bundle, [pair()[0]!, { ...pair()[0]! }]),
    /NEED_BOTH_REVIEWS/,
  );
});

test("the publication gate holds an item when either review fails an enhanced check", () => {
  const c = candidate("contracts");
  const evidenceHash = digest(sources);
  const policy = {
    version: "synthetic-policy",
    ownerApproved: true,
    allowedClasses: ["general_template", "sourced_guidance"],
    jurisdictions: ["NG"],
    risks: ["general", "contracts"],
    officialHosts: ["official.example.test"],
    blockedActivities: ["bespoke legal opinions", "certification"],
  };
  const run = (runId: string) => ({
    runId,
    model: "synthetic-test-not-an-actual-provider",
    promptVersion: "fixture-only",
    candidateHash: c.hash,
    evidenceHash,
  });
  const bundle = (reviews = pair()): PublicationBundle => {
    const b: PublicationBundle = {
      candidate: c,
      sources,
      policy: { ...policy, hash: digest(policy) },
      rights: {
        status: "cleared",
        evidence: "Synthetic rights fixture",
        evidenceHash: sha256("fixture"),
        commercialUse: true,
      },
      draftRun: run("draft"),
      reviews: (["factual", "challenge"] as const).map((role) => ({
        ...run(role),
        role,
        verdict: "pass",
        findings: [],
        receivedOtherVerdict: false,
      })),
      enhancedChecks: enhancedChecksFromReviews({ candidate: c, sources }, reviews),
      mechanicalChecks: mandatoryMechanicalChecks.map((name) => ({
        name,
        candidateHash: c.hash,
        result: "pass",
        evidenceHash: sha256("synthetic-check"),
      })),
      exports: (["docx", "pdf"] as const).map((format) => ({
        format,
        candidateHash: c.hash,
        fileHash: sha256("synthetic-not-a-rendered-file"),
        rendered: true,
        disclosureIncluded: true,
        scopeIncluded: true,
        limitationsIncluded: true,
        sourceDateIncluded: true,
      })),
      manifest: {
        candidateHash: c.hash,
        evidenceHash,
        rightsHash: "",
        policyHash: "",
        reviewHash: "",
        checksHash: "",
        exportsHash: "",
        status: "eligible",
      },
    };
    Object.assign(b.manifest, {
      rightsHash: digest(b.rights),
      policyHash: b.policy.hash,
      reviewHash: digest({ draft: b.draftRun, reviews: b.reviews }),
      checksHash: digest({ mechanical: b.mechanicalChecks, enhanced: b.enhancedChecks }),
      exportsHash: digest(b.exports),
    });
    return b;
  };
  assert.equal(evaluatePublication(bundle(), now).decision, "eligible");
  const fails = review((checks) => (checks.find((c) => c.name === "exceptions")!.result = "fail"));
  for (const reviews of [pair(fails), pair(undefined, fails)]) {
    const result = evaluatePublication(bundle(reviews), now);
    assert.equal(result.decision, "hold");
    assert.ok(result.reasons.includes("check_not_passed:exceptions"), JSON.stringify(result.reasons));
  }
});
