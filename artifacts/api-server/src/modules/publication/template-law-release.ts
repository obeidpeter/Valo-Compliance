import { digest, evaluatePublication, sha256, type PublicationBundle } from "@workspace/valo-core";
import type { AmendmentRecord } from "./guidance-amendments";
import type { ArtifactRef } from "./publication-artifacts";
import type { buildLawTemplateCandidate } from "./template-law-candidate";
import { lawTemplateMechanicalChecks } from "./template-law-mechanical";
import {
  lawTemplateBundleRights,
  lawTemplateRightsProblems,
  lawTemplateRightsRecord,
} from "./template-law-rights";

type BuiltLawTemplate = Awaited<ReturnType<typeof buildLawTemplateCandidate>>;
type ExportFormat = {
  parsed: boolean;
  disclosureIncluded: boolean;
  scopeIncluded: boolean;
  limitationsIncluded: boolean;
  sourceDateIncluded: boolean;
};

/**
 * A template's whole publication bundle, short of its two reviews, as a guide's is: the candidate
 * and its sources, the policy, the rights record, the mechanical checks and the two files'
 * inspection, bound together as the gate reads them.
 *
 * Nothing here publishes or approves. `eligibility` is the gate's own answer: until the two reviews
 * have run it is always a hold, and every other reason it gives is something the template still
 * lacks, the owner's approval of the policy among them.
 */
export async function assembleLawTemplateBundle(input: {
  built: BuiltLawTemplate;
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
  const rights = lawTemplateRightsRecord({
    bundle: content,
    snapshot: input.snapshotRef,
    provenanceArtifactHash: input.provenanceRef.hash,
    applicability,
    policy,
    now,
  });
  const rightsProblems = lawTemplateRightsProblems({
    rights,
    bundle: content,
    provenanceArtifactHash: input.provenanceRef.hash,
    applicability,
    policy,
    now,
  });
  const mechanicalChecks = await lawTemplateMechanicalChecks({
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
    rights: lawTemplateBundleRights(rights, rightsProblems),
    policy,
    // The draft was written in ChatGPT and imported; no model run of Valo's own produced it.
    draftRun: {
      runId: `source-import:${sha256(built.original)}`,
      model: "ChatGPT; upstream model unrecorded",
      promptVersion: "coordinator-template-law-prose-import-1",
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
