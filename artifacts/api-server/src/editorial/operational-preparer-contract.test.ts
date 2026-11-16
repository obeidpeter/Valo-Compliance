import test from "node:test";
import assert from "node:assert/strict";
import { candidateDigest, disclosure, sha256, type PublicationBundle } from "@workspace/valo-core";
import { readOperationalIntake } from "./operational-intake";
import { templateCandidate, inventoryCandidate } from "./operational-content";
import { operationalPolicy } from "./operational-policy";
import { operationalMechanicalChecks } from "./operational-mechanical";
import { candidateArithmetic } from "./candidate-arithmetic";
import { chatGPTSourcePath, loadChatGPTPermission } from "./rights-applicability";
import {
  operationalInferenceTemplateIds,
  supportsOperationalInferenceTemplate,
} from "../lib/inference-operational-coverage";

// Predicate fixtures, never retained as actual terms evidence or publication proof.
export function controlledTermsSnapshot(now = new Date()) {
  return {
    kind: "official_provider_terms_snapshot",
    retrievedAt: now.toISOString(),
    pages: [
      {
        url: "https://openai.com/policies/terms-of-use/",
        text: "We hereby assign to you all our right, title, and interest, if any, in and to Output.",
        truncated: false,
      },
      {
        url: "https://openai.com/policies/eu-terms-of-use/",
        text: "We hereby assign to you all our right, title, and interest, if any, in and to Output.",
        truncated: false,
      },
      {
        url: "https://help.openai.com/en/articles/6783457-what-is-chatgpt",
        text: "regardless of whether output was generated through a free or paid plan",
        truncated: false,
      },
      {
        url: "https://openai.com/policies/service-terms/",
        text: "ChatGPT Enterprise, Edu, Healthcare and Business",
        truncated: false,
      },
      {
        url: "https://openai.com/policies/sharing-publication-policy/",
        text: "Content co-authored with the OpenAI API",
        truncated: false,
      },
    ],
  };
}
async function candidateFor(id: string, now = new Date()) {
  const intake = await readOperationalIntake(id, 42);
  const source = await templateCandidate(id, 42, now, {
    original: intake.section.body,
    provenance: intake.provenance,
  });
  const raw: Omit<PublicationBundle["candidate"], "hash"> = {
    id,
    version: 42,
    body: JSON.stringify(source.document),
    contentClass: "general_template",
    jurisdiction: "NG",
    risk: "general",
    scope: source.scope,
    limitations: source.limitations,
    assumptions: ["Controlled blank candidate"],
    unresolvedMaterialIssues: [],
    missingEvidence: [],
    sourceCheckDate: now.toISOString(),
    reviewBy: source.reviewBy,
    disclosure,
    claims: [],
    evidenceMode: "original_operational",
    legalScopeStatus: "not_applicable",
  };
  return { intake, source, candidate: { ...raw, hash: candidateDigest(raw) } };
}
test("seventeen source-bound forms retain every existing mechanical gate; unsupported content stays held", async () => {
  assert.equal(operationalInferenceTemplateIds.length, 17);
  const now = new Date(),
    snapshot = controlledTermsSnapshot(now),
    { policy } = await operationalPolicy();
  for (const id of operationalInferenceTemplateIds) {
    const { intake, source, candidate } = await candidateFor(id, now),
      applicability = await loadChatGPTPermission(snapshot, intake.provenance);
    const provenanceArtifactHash = sha256("controlled fixture"),
      rights = {
        applicabilityHash: applicability.hash,
        provenanceHash: provenanceArtifactHash,
        validUntil: source.reviewBy,
        permissions: applicability.record.evidence,
      };
    assert.deepEqual(
      operationalMechanicalChecks({
        candidate,
        policy,
        provenance: intake.provenance,
        provenanceArtifactHash,
        rights,
        applicability,
        snapshot,
        now,
      }).filter((c) => c.result !== "pass"),
      [],
      id,
    );
    const wrong = { ...intake.provenance, noteHash: "f".repeat(64) };
    await assert.rejects(
      () => templateCandidate(id, 42, now, { original: intake.section.body, provenance: wrong }),
      /MISMATCH/,
    );
  }
  for (const id of [
    "TPL-13",
    "TPL-16",
    "TPL-25",
    "TPL-29",
    "TPL-33",
    "TPL-36",
    "TPL-37",
    "TPL-39",
    "TPL-40",
    "GUD-01",
    "GUIDE-C01",
    "IND-C01",
  ])
    assert.equal(supportsOperationalInferenceTemplate(id), false, id);
  assert.equal(candidateArithmetic((await candidateFor("TPL-12", now)).candidate).pass, true);
});
test("reminder and procurement arithmetic rejects changed, repeated or invented numeric relationships", async () => {
  for (const [id, mutations] of [
    [
      "TPL-12",
      [
        (s: string) =>
          s.replace(
            "invoice amount − confirmed allocated payments",
            "invoice amount + confirmed allocated payments",
          ),
        (s: string) =>
          s.replace(
            "+ separately established additional adjustments",
            "− separately established additional adjustments",
          ),
        (s: string) => s.replace("Recorded balance =", "Unverified balance ="),
        (s: string) => s.replace("Recorded balance =", "Recorded balance = Recorded balance ="),
        (s: string) => s.replace("Do not infer interest", "Apply 5% interest; do not infer interest"),
      ],
    ],
    [
      "TPL-24",
      [
        (s: string) => s.replace("score ÷ 5 × weight", "score ÷ 4 × weight"),
        (s: string) => s.replace("weights total 100%", "weights total 110%"),
        (s: string) => s.replace("from 0 to 5", "from 0 to 10"),
        (s: string) => s.replace("Weighted points =", "Weighted points = Weighted points ="),
        (s: string) => s.replace("Unknown criteria", "Add 5% to each result. Unknown criteria"),
      ],
    ],
  ] as const) {
    const { candidate } = await candidateFor(id),
      actual = candidateArithmetic(candidate);
    assert.equal(actual.pass, true, id);
    assert.equal(actual.expressions.length, id === "TPL-12" ? 5 : 4);
    assert.ok(actual.expressions.every((e) => e.actual === e.expected));
    for (const mutate of mutations) {
      const altered = { ...candidate, body: mutate(candidate.body) };
      assert.notEqual(altered.body, candidate.body);
      altered.hash = candidateDigest(altered);
      assert.equal(candidateArithmetic(altered).pass, false, id);
    }
  }
});
test("commercial lease content cannot enter the general operational mechanical route", async () => {
  const { readTemplateIntake } = await import("./operational-intake"),
    now = new Date(),
    id = "TPL-39";
  const intake = await readTemplateIntake(id, 42),
    source = await templateCandidate(id, 42, now);
  const baseline = await candidateFor("TPL-12", now),
    candidate = {
      ...baseline.candidate,
      id,
      body: JSON.stringify(source.document),
      scope: source.scope,
      limitations: source.limitations,
    };
  candidate.hash = candidateDigest(candidate);
  const { policy } = await operationalPolicy(),
    checks = operationalMechanicalChecks({
      candidate,
      policy,
      provenance: intake.provenance,
      provenanceArtifactHash: sha256("controlled"),
      rights: {
        applicabilityHash: "controlled",
        provenanceHash: sha256("controlled"),
        validUntil: source.reviewBy,
        permissions: [],
      },
      applicability: { verified: false, hash: "controlled" },
      snapshot: controlledTermsSnapshot(now),
      now,
    });
  assert.equal(checks.find((c) => c.name === "scope")?.result, "fail");
});
test("TPL-07 reconstruction remains identical and TPL-09 selects exact intake lineage despite legacy shared path", async () => {
  const now = new Date(),
    intake = await readOperationalIntake("TPL-07", 42),
    recorded = { original: intake.section.body, provenance: intake.provenance };
  assert.deepEqual(
    await templateCandidate("TPL-07", 42, now, recorded),
    await inventoryCandidate(42, now, recorded),
  );
  const nine = await readOperationalIntake("TPL-09", 42);
  assert.equal(nine.sourcePath, chatGPTSourcePath);
  const result = await loadChatGPTPermission(controlledTermsSnapshot(now), nine.provenance);
  assert.equal(result.record.sourceBinding?.noteHash, nine.manifestHash);
  assert.equal(
    result.record.sourceBinding?.notePath,
    "docs/content-candidates/r1-content-intake-manifest.json",
  );
  assert.equal(result.verified, true);
  await assert.rejects(
    () =>
      loadChatGPTPermission(controlledTermsSnapshot(now), { ...nine.provenance, note: "changed lineage" }),
    /LINEAGE_MISMATCH/,
  );
  const legacy = await inventoryCandidate(42, now),
    legacyPermission = await loadChatGPTPermission(controlledTermsSnapshot(now), legacy.provenance);
  assert.equal(legacyPermission.record.sourceBinding?.noteHash, legacy.provenance.noteHash);
  assert.match(legacyPermission.record.sourceBinding!.notePath, /chatgpt-content-provenance-rights/);
  assert.equal(
    (await loadChatGPTPermission(controlledTermsSnapshot(new Date(+now - 91 * 86400000)), nine.provenance))
      .verified,
    false,
  );
});
