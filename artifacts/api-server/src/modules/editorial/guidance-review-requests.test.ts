import test from "node:test";
import assert from "node:assert/strict";
import { sha256 } from "@workspace/valo-core";
import { repositoryBuiltGuideIds } from "../publication/guidance-bundle";
import { GUIDE_REVIEW_INPUT_CEILING } from "../publication/guidance-policy";
import { assembledGuide } from "../publication/guidance-release.fixtures";
import { guideReviewInputs } from "../publication/guidance-review-inputs";
import { guideSlug } from "./guidance-preparation";
import { operationalReviewRequests, reviewInputCeiling } from "./operational-review";
import { REVIEW_INPUT_CEILING } from "./review-meter";

const day = new Date("2026-11-22T08:00:00Z");
const kept = sha256("a checksum stands here");

/**
 * The two review requests of a guide, made as the finite route makes them, from a bundle put
 * together on `day`. The files' report and the server's checksums are stand-ins of the real ones'
 * shape and length; no file was rendered and nothing was sent.
 */
async function requestsFor(id: string) {
  const guide = await assembledGuide(id, day);
  const { evidence: _withThePermissions, ...permissionScope } = guide.applicability.record;
  const inputs = guideReviewInputs({
    provenance: guide.built.provenance,
    originalText: guide.built.original,
    rebuiltBody: JSON.stringify(guide.built.document),
    candidateBody: guide.bundle.candidate.body,
    rights: guide.rights,
    permissionScope,
    claimScope: guide.built.claimScope,
  });
  const format = {
    parsed: true,
    completeContent: true,
    disclosureIncluded: true,
    scopeIncluded: true,
    limitationsIncluded: true,
    sourceDateIncluded: true,
    missingTextHashes: [],
  };
  const exportReport = {
    version: "operational-export-inspection-4",
    candidateHash: guide.bundle.candidate.hash,
    passed: true,
    hashes: { docx: kept, pdf: kept },
    formats: { docx: format, pdf: format },
    checks: [
      "docx_reader_and_active_content",
      "pdf_reader_a4_geometry",
      "pdf_text_within_pages",
      "docx_complete_content_and_disclosures",
      "pdf_complete_content_and_disclosures",
    ].map((name) => ({ name, passed: true })),
    geometry: { pages: 3, width: 595.91998, height: 842.88, tolerancePoints: 2 },
    readerNormalization: {
      rendererFooterLinesIgnored: 3,
      rendererHeaderOccurrencesIgnored: 3,
      rule: "Only exact renderer-owned template header text and Valo page-number footer lines excluded from content comparison.",
    },
    manualWordApplicationReview: false,
    manualAccessibilityReview: false,
  };
  const requests = operationalReviewRequests(
    guide.bundle.candidate,
    inputs.rightsInput,
    inputs.provenanceInput,
    exportReport,
    {
      candidateHash: guide.bundle.candidate.hash,
      policyHash: kept,
      sourceCheckedAt: guide.bundle.candidate.sourceCheckDate,
      sourceHash: kept,
      provenanceArtifactHash: kept,
      rightsArtifactHash: kept,
      exportReportArtifactHash: kept,
      providerSnapshotHash: kept,
      authoringRoute: "coordinator_chatgpt",
      sourceAttribution: "Retained authoring attribution; no independently certified upstream model/run",
      performedChecks: guide.bundle.mechanicalChecks.map((check) => check.name),
    },
    day.toISOString(),
    guide.bundle.sources,
  );
  return { guide, requests };
}

test("a guide's review has a size limit of its own, and a template's keeps the limit it had", () => {
  assert.equal(REVIEW_INPUT_CEILING, 32000);
  assert.equal(GUIDE_REVIEW_INPUT_CEILING, 64000);
  assert.equal(reviewInputCeiling({ contentClass: "sourced_guidance" }), GUIDE_REVIEW_INPUT_CEILING);
  assert.equal(reviewInputCeiling({ contentClass: "general_template" }), REVIEW_INPUT_CEILING);
});

// The ten guides whose passages the repository keeps. A guide whose texts are not kept there is
// measured from captures, outside the tests.
test("the two review requests of each guide built from the repository are within the guides' limit", async () => {
  const measured: number[] = [];
  for (const id of repositoryBuiltGuideIds) {
    const { guide, requests } = await requestsFor(id);
    assert.deepEqual(
      requests.map((r) => r.role),
      ["factual", "challenge"],
    );
    for (const request of requests) {
      assert.equal(request.meter.inputCeiling, GUIDE_REVIEW_INPUT_CEILING, id);
      assert.ok(
        request.meter.withinInputCeiling,
        `${id} ${request.role} measures ${request.meter.conservativeInputTokenBound}`,
      );
      assert.equal(request.promptVersion, `operational-${request.role}-enhanced-1`);
      measured.push(request.meter.conservativeInputTokenBound);
      // The request carries the guide's sources whole, and each Act's amendment basis.
      const sent = JSON.parse(request.request.messages[1]!.content) as {
        sources: { id: string; text: string }[];
        provenance: { amendmentBasis: unknown[] };
      };
      assert.deepEqual(
        sent.sources.map((source) => [source.id, source.text]),
        guide.bundle.sources.map((source) => [source.id, source.text]),
      );
      const acts = new Set(
        guide.built.claimScope.passages
          .filter((p) => p.instrument.kind === "act")
          .map((p) => p.instrument.id),
      );
      assert.equal(sent.provenance.amendmentBasis.length, acts.size, id);
    }
  }
  // Why guides have a limit of their own: measured the same way, most of these requests are larger
  // than a template's request may be, because they carry the official passages.
  const overTemplates = measured.filter((bound) => bound > REVIEW_INPUT_CEILING).length;
  assert.ok(overTemplates > measured.length / 2, `${overTemplates} of ${measured.length}`);
  // And the limit leaves room: the largest is under nine tenths of it.
  assert.ok(Math.max(...measured) < GUIDE_REVIEW_INPUT_CEILING * 0.9, String(Math.max(...measured)));
});

test("a guide's page address is its title in lower case, joined by hyphens", () => {
  assert.equal(guideSlug("Check the name you trade under"), "check-the-name-you-trade-under");
  assert.equal(guideSlug("  Tax ID: what it is — and isn’t  "), "tax-id-what-it-is-and-isn-t");
  assert.equal(guideSlug("Café & Co."), "cafe-co");
  const long = guideSlug("word ".repeat(40));
  assert.ok(long.length <= 80 && !long.endsWith("-") && !long.startsWith("-"));
});
