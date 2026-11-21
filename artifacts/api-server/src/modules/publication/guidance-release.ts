import { digest, evaluatePublication, sha256, type PublicationBundle } from "@workspace/valo-core";
import type { AmendmentRecord } from "./guidance-amendments";
import type { buildGuideCandidate } from "./guidance-bundle";
import { guideMechanicalChecks } from "./guidance-mechanical";
import { guideBundleRights, guideRightsProblems, guideRightsRecord } from "./guidance-rights";
import type { ArtifactRef } from "./publication-artifacts";

type BuiltGuide = Awaited<ReturnType<typeof buildGuideCandidate>>;
type ExportFormat = {
  parsed: boolean;
  disclosureIncluded: boolean;
  scopeIncluded: boolean;
  limitationsIncluded: boolean;
  sourceDateIncluded: boolean;
};

/**
 * A guide's whole publication bundle, short of its two reviews: the candidate and its sources, the
 * policy, the rights record, the mechanical checks and the two files' inspection, bound together as
 * the gate reads them.
 *
 * Nothing here publishes or approves. The bundle says what is true of the guide on the day given,
 * and `eligibility` is the gate's own answer: until the two reviews have run it is always a hold,
 * and every other reason it gives is something the guide still lacks.
 */
export async function assembleGuideBundle(input: {
  built: BuiltGuide;
  policy: PublicationBundle["policy"];
  /** The provider's terms as captured, and where the capture and the provenance are kept. */
  termsSnapshot: { retrievedAt: string; pages: { url: string; text: string; truncated: boolean }[] };
  snapshotRef: ArtifactRef;
  provenanceRef: ArtifactRef;
  applicability: {
    record: { evidence: { url: string; hash: string; quote: string }[] };
    hash: string;
    verified: boolean;
  };
  /** The inspection of the Word and PDF files rendered from the candidate, and the files' hashes. */
  exportReport: { passed: boolean; formats: { docx: ExportFormat; pdf: ExportFormat } };
  exportHashes: { docx: string; pdf: string };
  now: Date;
  amendmentRecords?: readonly AmendmentRecord[];
}) {
  const { built, policy, applicability, now } = input;
  const content = { candidate: built.candidate, sources: built.sources };
  const rights = guideRightsRecord({
    bundle: content,
    snapshot: input.snapshotRef,
    provenanceArtifactHash: input.provenanceRef.hash,
    applicability,
    policy,
    now,
  });
  const rightsProblems = guideRightsProblems({
    rights,
    bundle: content,
    provenanceArtifactHash: input.provenanceRef.hash,
    applicability,
    policy,
    now,
  });
  const mechanicalChecks = await guideMechanicalChecks({
    bundle: { ...content, policy },
    canonicalBody: JSON.stringify(built.document),
    claimScope: built.claimScope,
    provenance: built.provenance,
    provenanceArtifactHash: input.provenanceRef.hash,
    rights,
    applicability,
    snapshot: input.termsSnapshot,
    trustedPolicy: policy,
    now,
    ...(input.amendmentRecords ? { amendmentRecords: input.amendmentRecords } : {}),
  });
  const evidenceHash = digest(built.sources);
  const bundle: PublicationBundle = {
    ...content,
    rights: guideBundleRights(rights, rightsProblems),
    policy,
    // The draft was written in ChatGPT and imported; no model run of Valo's own produced it.
    draftRun: {
      runId: `source-import:${sha256(built.original)}`,
      model: "ChatGPT; upstream model unrecorded",
      promptVersion: "coordinator-guidance-prose-import-1",
      candidateHash: built.candidate.hash,
      evidenceHash,
    },
    reviews: [],
    mechanicalChecks,
    enhancedChecks: [],
    exports: (["docx", "pdf"] as const).map((format) => ({
      format,
      candidateHash: built.candidate.hash,
      fileHash: input.exportHashes[format],
      rendered: input.exportReport.formats[format].parsed,
      disclosureIncluded: input.exportReport.formats[format].disclosureIncluded,
      scopeIncluded: input.exportReport.formats[format].scopeIncluded,
      limitationsIncluded: input.exportReport.formats[format].limitationsIncluded,
      sourceDateIncluded: input.exportReport.formats[format].sourceDateIncluded,
    })),
    manifest: {
      candidateHash: built.candidate.hash,
      evidenceHash,
      rightsHash: "",
      policyHash: policy.hash,
      reviewHash: "",
      checksHash: "",
      exportsHash: "",
      // A bundle with no reviews is never eligible.
      status: "review",
    },
  };
  Object.assign(bundle.manifest, {
    rightsHash: digest(bundle.rights),
    reviewHash: digest({ draft: bundle.draftRun, reviews: bundle.reviews }),
    checksHash: digest({ mechanical: bundle.mechanicalChecks, enhanced: bundle.enhancedChecks }),
    exportsHash: digest(bundle.exports),
  });
  return { bundle, rights, rightsProblems, eligibility: evaluatePublication(bundle, now) };
}

/** The gate's reasons that only the two reviews can clear. Any other reason is something the guide
 * itself still lacks. */
export const reasonsOnlyReviewsClear = [
  "manifest_not_eligible",
  "review_required:factual",
  "review_required:challenge",
  "check_not_passed:controlling_text",
  "check_not_passed:amendments",
  "check_not_passed:effective_dates",
  "check_not_passed:exceptions",
  "check_not_passed:jurisdiction",
] as const;

/** What still holds a guide apart from its two reviews, as the gate names it. */
export function guideOpenReasons(eligibility: { reasons: readonly string[] }) {
  return eligibility.reasons.filter(
    (reason) => !(reasonsOnlyReviewsClear as readonly string[]).includes(reason),
  );
}
