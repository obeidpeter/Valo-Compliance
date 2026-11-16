import { z } from "zod";
export function assertBlindReviewInputs(...inputs: unknown[]) {
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    for (const [key, v] of Object.entries(value)) {
      if (/^(?:verdict|reviews|otherReview|factualReview|challengeReview|reviewerVerdict)$/i.test(key))
        throw Error("REVIEW_INPUT_CONTAINS_OTHER_VERDICT");
      visit(v);
    }
  };
  inputs.forEach(visit);
}
export const operationalReviewSchema = z
  .object({
    verdict: z.enum(["pass", "hold"]),
    findings: z.array(z.string()),
    missingEvidence: z.array(z.string()),
    observations: z.array(z.string()),
  })
  .strict();
/** Server-recorded facts a blind operational review is bound to. */
export type OperationalServerEvidence = {
  candidateHash: string;
  policyHash: string;
  sourceCheckedAt: string;
  sourceHash: string;
  provenanceArtifactHash: string;
  rightsArtifactHash: string;
  exportReportArtifactHash: string;
  providerSnapshotHash: string;
  authoringRoute: string;
  sourceAttribution: string;
  performedChecks: string[];
};
