import test from "node:test";
import assert from "node:assert/strict";
import { sha256 } from "@workspace/valo-core";
import { guideReviewInputs } from "../publication/guidance-review-inputs";
import { TEMPLATE_LAW_REVIEW_INPUT_CEILING } from "../publication/template-law-policy";
import {
  assembledLawTemplate,
  supposedlyApprovedTemplateLawPolicy,
  syntheticLawTemplateRecords,
} from "../publication/template-law-release.fixtures";
import { operationalReviewRequests, reviewInputCeiling } from "./operational-review";
import { REVIEW_INPUT_CEILING } from "./review-meter";

/**
 * The two review requests of a template that states the law (docs/architecture/reviewed-route.md,
 * part 4), made as the finite route makes them from TPL-31's bundle, built from stand-in passages under
 * a synthetic amendment record and a test's supposed approval of the policy. The files' report and the
 * server's checksums are stand-ins of the real ones' shape; no file was rendered and nothing was sent.
 */
const now = new Date("2026-11-27T10:00:00.000Z");
const kept = sha256("a checksum stands here");

test("a template that states the law has its own policy's limit for a review, and a form keeps the templates'", () => {
  assert.equal(TEMPLATE_LAW_REVIEW_INPUT_CEILING, 64000);
  assert.equal(
    reviewInputCeiling({ contentClass: "general_template", evidenceMode: "regulatory" }),
    TEMPLATE_LAW_REVIEW_INPUT_CEILING,
  );
  assert.equal(
    reviewInputCeiling({ contentClass: "general_template", evidenceMode: "original_operational" }),
    REVIEW_INPUT_CEILING,
  );
  // A template that does not say how it was prepared keeps the smaller limit.
  assert.equal(reviewInputCeiling({ contentClass: "general_template" }), REVIEW_INPUT_CEILING);
});

test("TPL-31's two review requests are within its policy's limit and carry its sources and their amendment basis", async () => {
  const read = new Date(+now - 3_600_000).toISOString();
  const assembled = await assembledLawTemplate({
    now,
    policy: await supposedlyApprovedTemplateLawPolicy(),
    records: syntheticLawTemplateRecords(read),
  });
  const { bundle, built, rights, applicability } = assembled;
  const { evidence: _withThePermissions, ...permissionScope } = applicability.record;
  const inputs = guideReviewInputs({
    provenance: built.provenance,
    originalText: built.original,
    rebuiltBody: JSON.stringify(built.document),
    candidateBody: bundle.candidate.body,
    rights,
    permissionScope,
    claimScope: built.claimScope,
  });
  // The body built again must be the candidate's own: the draft is not sent a second time.
  assert.throws(
    () =>
      guideReviewInputs({
        provenance: built.provenance,
        originalText: built.original,
        rebuiltBody: `${JSON.stringify(built.document)} `,
        candidateBody: bundle.candidate.body,
        rights,
        permissionScope,
        claimScope: built.claimScope,
      }),
    /SAVED_BODY_NOT_EXACT_CURRENT_INTAKE/,
  );
  const format = {
    parsed: true,
    completeContent: true,
    disclosureIncluded: true,
    scopeIncluded: true,
    limitationsIncluded: true,
    sourceDateIncluded: true,
    missingTextHashes: [],
  };
  const requests = operationalReviewRequests(
    bundle.candidate,
    inputs.rightsInput,
    inputs.provenanceInput,
    {
      version: "operational-export-inspection-4",
      candidateHash: bundle.candidate.hash,
      passed: true,
      hashes: { docx: kept, pdf: kept },
      formats: { docx: format, pdf: format },
    },
    {
      candidateHash: bundle.candidate.hash,
      policyHash: bundle.policy.hash,
      sourceCheckedAt: bundle.candidate.sourceCheckDate,
      sourceHash: kept,
      provenanceArtifactHash: kept,
      rightsArtifactHash: kept,
      exportReportArtifactHash: kept,
      providerSnapshotHash: kept,
      authoringRoute: "coordinator_chatgpt",
      sourceAttribution: "Retained authoring attribution; no independently certified upstream model/run",
      performedChecks: bundle.mechanicalChecks.map((check) => check.name),
    },
    now.toISOString(),
    bundle.sources,
  );
  assert.deepEqual(
    requests.map((r) => r.role),
    ["factual", "challenge"],
  );
  for (const request of requests) {
    // A contract is not general content: each review runs the five enhanced checks.
    assert.equal(request.request.response_format.json_schema.name, "operational_enhanced_review");
    assert.equal(request.promptVersion, `operational-${request.role}-enhanced-1`);
    assert.equal(request.meter.inputCeiling, TEMPLATE_LAW_REVIEW_INPUT_CEILING);
    assert.ok(
      request.meter.withinInputCeiling,
      `${request.role} measures ${request.meter.conservativeInputTokenBound}`,
    );
    const sent = JSON.parse(request.request.messages[1]!.content) as {
      candidate: { id: string; assumptions: string[] };
      sources: { id: string; text: string }[];
      rights: { officialText: { withinLimit: boolean; longestSharedWords: number } };
      provenance: { originalItemSha256: string; amendmentBasis: { text: string }[] };
    };
    assert.equal(sent.candidate.id, "TPL-31");
    // What it assumes and leaves open goes to the reviewers with it.
    assert.ok(sent.candidate.assumptions.some((line) => line.startsWith("Left for the parties to settle:")));
    // Its sources whole, the measure of the words it repeats from them, and the draft's checksum.
    assert.deepEqual(
      sent.sources.map((source) => [source.id, source.text]),
      bundle.sources.map((source) => [source.id, source.text]),
    );
    assert.equal(sent.rights.officialText.withinLimit, true);
    assert.equal(sent.provenance.originalItemSha256, sha256(built.original));
    // The Act and the directive it quotes, each as its amendment record bears on what is quoted.
    assert.deepEqual(
      sent.provenance.amendmentBasis.map((basis) => basis.text).sort(),
      [...new Set(built.claimScope.passages.map((p) => p.instrument.title))].sort(),
    );
  }
});
