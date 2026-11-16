import test from "node:test";
import assert from "node:assert/strict";
import {
  candidateSchema,
  mechanicalCandidate,
  reviewInput,
  reviewSchema,
  systemPrompt,
  mandatoryDevelopmentHolds,
  editorialCallsCompleted,
  type EvidenceBundle,
} from "./pipeline-contract";
const snapshotId = "ec3fa789-a045-450b-a9d1-bc3552e56e23";
const bundle: EvidenceBundle = {
  snapshotId,
  sourceId: "SYNTHETIC",
  title: "Synthetic unit fixture, not law",
  url: "https://example.invalid",
  fetchedAt: "2000-01-01T00:00:00.000Z",
  rawHash: "a".repeat(64),
  textHash: "b".repeat(64),
  publication: "held",
  effectivePeriod: "unverified",
  passages: [{ id: "page:1", page: 1, text: "Synthetic fixture states: alpha and beta." }],
};
function candidate() {
  return {
    title: "Synthetic candidate",
    contentClass: "general_guidance_candidate",
    scope: "Unit fixture only",
    paragraphs: [
      {
        id: "p1",
        text: "Synthetic fixture describes alpha.",
        kind: "source_statement",
        claims: [
          {
            id: "c1",
            statement: "Synthetic alpha.",
            sourceSnapshotId: snapshotId,
            passageId: "page:1",
            quote: "alpha and beta.",
          },
        ],
      },
    ],
    missingEvidence: ["All real legal evidence"],
    disclosure:
      "Unpublished AI candidate; not professionally reviewed. Current amendments, effectivity, rights and publication gates are not cleared.",
  };
}
test("matching quoted passages pass mechanical linkage only, not publication", () => {
  assert.deepEqual(mechanicalCandidate(candidate(), bundle), []);
  assert.ok(mandatoryDevelopmentHolds.includes("rights_record_not_cleared"));
});
test("invented quotation fails independently of any model pass", () => {
  const c = candidate();
  c.paragraphs[0]!.claims[0]!.quote = "An invented passage";
  assert.deepEqual(mechanicalCandidate(c, bundle), ["unsupported_quote:c1"]);
  assert.equal(
    reviewSchema.parse({ verdict: "pass", findings: [], unsupportedClaimIds: [], missingEvidence: [] })
      .verdict,
    "pass",
  );
});
test("a different source snapshot cannot support an otherwise matching quote", () => {
  const c = candidate();
  c.paragraphs[0]!.claims[0]!.sourceSnapshotId = "cd386fec-ee59-41aa-a43f-236c7b6fa03c";
  assert.deepEqual(mechanicalCandidate(c, bundle), ["unsupported_quote:c1"]);
});
test("an invented page locator fails even when its quotation exists elsewhere", () => {
  const c = candidate();
  c.paragraphs[0]!.claims[0]!.passageId = "page:999";
  assert.deepEqual(mechanicalCandidate(c, bundle), ["unsupported_quote:c1"]);
});
test("source statements with no claim map fail", () => {
  const c = candidate();
  c.paragraphs[0]!.claims = [];
  assert.deepEqual(mechanicalCandidate(c, bundle), ["claim_map_missing:p1"]);
});
test("a mandatory instruction disguised as optional practice needs a claim", () => {
  const c = candidate();
  c.paragraphs[0]!.kind = "optional_practice";
  c.paragraphs[0]!.text = "You must pay a statutory fee.";
  c.paragraphs[0]!.claims = [];
  assert.deepEqual(mechanicalCandidate(c, bundle), ["unmapped_material_practice:p1"]);
});
test("duplicate claim IDs cannot conceal mappings", () => {
  const c = candidate();
  c.paragraphs[0]!.claims.push({ ...c.paragraphs[0]!.claims[0]! });
  assert.deepEqual(mechanicalCandidate(c, bundle), ["duplicate_claim:c1"]);
});
test("formatting whitespace can differ but wording cannot be reconstructed", () => {
  const c = candidate();
  c.paragraphs[0]!.claims[0]!.quote = "alpha\nand   beta.";
  assert.deepEqual(mechanicalCandidate(c, bundle), []);
  c.paragraphs[0]!.claims[0]!.quote = "alpha and gamma.";
  assert.deepEqual(mechanicalCandidate(c, bundle), ["unsupported_quote:c1"]);
});
test("candidate output cannot grant policy, rights or professional approval", () => {
  assert.equal(
    candidateSchema.safeParse({
      ...candidate(),
      policyApproved: true,
      rightsApproved: true,
      professionallyReviewed: true,
    }).success,
    false,
  );
  assert.equal(
    reviewSchema.safeParse({
      verdict: "published",
      findings: [],
      unsupportedClaimIds: [],
      missingEvidence: [],
    }).success,
    false,
  );
});
test("review payloads contain the source and same candidate, not another verdict", () => {
  const c = candidate(),
    factual = reviewInput("factual", bundle, c),
    challenge = reviewInput("challenge", bundle, c);
  assert.deepEqual(Object.keys(factual).sort(), ["candidate", "role", "sourceBundle"]);
  assert.deepEqual(Object.keys(challenge).sort(), ["candidate", "role", "sourceBundle"]);
  assert.deepEqual(factual.candidate, challenge.candidate);
  assert.deepEqual(factual.sourceBundle, challenge.sourceBundle);
});
test("each role has a different prompt and no permission to publish or use tools", () => {
  const prompts = (["draft", "factual", "challenge"] as const).map(systemPrompt);
  assert.equal(new Set(prompts).size, 3);
  assert.ok(
    prompts.every((p) => p.includes("UNTRUSTED DATA") && p.includes("No tools") && p.includes("publishing")),
  );
});
test("proof execution fails closed on skipped roles, missing artifacts or missing provider responses", () => {
  const runs = ["draft", "factual", "challenge"].map((role) => ({
    role,
    status: "succeeded",
    providerResponseId: "synthetic-unit-only",
    outputHash: "a".repeat(64),
  }));
  assert.equal(editorialCallsCompleted(runs), true);
  assert.equal(
    editorialCallsCompleted(
      runs.map((r) => (r.role === "challenge" ? { ...r, status: "dependency_held" } : r)),
    ),
    false,
  );
  assert.equal(editorialCallsCompleted(runs.map((r) => ({ ...r, role: "draft" }))), false);
  assert.equal(editorialCallsCompleted(runs.map((r) => ({ ...r, providerResponseId: null }))), false);
  assert.equal(editorialCallsCompleted(runs.map((r) => ({ ...r, outputHash: null }))), false);
});
