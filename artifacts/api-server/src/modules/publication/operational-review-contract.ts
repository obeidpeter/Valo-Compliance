import { z } from "zod";
import { digest, mandatoryEnhancedChecks, type PublicationBundle } from "@workspace/valo-core";
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
/**
 * One reviewer's result for one of EDP-005's enhanced checks, with the passage it relied on. The
 * schema goes to the provider in strict mode, where every field is required; a passage's length and
 * where it occurs are checked when the checks are derived.
 */
export const enhancedCheckResultSchema = z
  .object({
    name: z.enum(mandatoryEnhancedChecks),
    result: z.enum(["pass", "fail"]),
    passage: z.string(),
    note: z.string(),
  })
  .strict();
export const operationalReviewSchema = z
  .object({
    verdict: z.enum(["pass", "hold"]),
    findings: z.array(z.string()),
    missingEvidence: z.array(z.string()),
    observations: z.array(z.string()),
  })
  .strict();
/** The review of content that is not general (decision 0014): the same answer, plus a result for
 * each enhanced check. A general item's review keeps the schema above. */
export const enhancedOperationalReviewSchema = z
  .object({
    ...operationalReviewSchema.shape,
    enhancedChecks: z.array(enhancedCheckResultSchema),
  })
  .strict();
export type EnhancedCheckResult = z.infer<typeof enhancedCheckResultSchema>;
export type OperationalReviewOutput = z.infer<typeof operationalReviewSchema> & {
  enhancedChecks?: EnhancedCheckResult[];
};
/** The schema a review of this candidate answers in. */
export function operationalReviewSchemaFor(candidate: { risk: string }) {
  return candidate.risk === "general" ? operationalReviewSchema : enhancedOperationalReviewSchema;
}

const passageLimit = 2000;
const normalised = (text: string) => text.replace(/\s+/g, " ").trim();
function strings(value: unknown, into: string[]) {
  if (typeof value === "string") into.push(value);
  else if (Array.isArray(value)) for (const item of value) strings(item, into);
  else if (value && typeof value === "object") for (const item of Object.values(value)) strings(item, into);
  return into;
}
/** The texts a passage may quote: the candidate's body, each text within it, and its sources. */
function quotableTexts(bundle: Pick<PublicationBundle, "candidate" | "sources">) {
  const texts = [bundle.candidate.body, ...bundle.sources.map((s) => s.text)];
  try {
    strings(JSON.parse(bundle.candidate.body), texts);
  } catch {
    // A body that is not JSON is quoted as written; it is already in the list.
  }
  return texts.map(normalised);
}

/**
 * Decision 0014: for content that is not general, each enhanced check (controlling text,
 * amendments, effective dates, exceptions, jurisdiction) passes only when both blind reviews pass
 * it, each with one result whose passage occurs word for word in the candidate or one of its
 * sources. A missing, repeated or failed result, or a passage found nowhere, fails the check. The
 * record is an AI check bound to those results, never legal, tax or regulatory review.
 */
export function enhancedChecksFromReviews(
  bundle: Pick<PublicationBundle, "candidate" | "sources">,
  reviews: { role: "factual" | "challenge"; output: OperationalReviewOutput }[],
) {
  if (reviews.length !== 2 || new Set(reviews.map((r) => r.role)).size !== 2)
    throw Error("ENHANCED_CHECKS_NEED_BOTH_REVIEWS");
  const texts = quotableTexts(bundle);
  const ordered = [...reviews].sort((a, b) => a.role.localeCompare(b.role));
  return mandatoryEnhancedChecks.map((name) => {
    const results = ordered.map((r) => ({
      role: r.role,
      results: (r.output.enhancedChecks ?? []).filter((c) => c.name === name),
    }));
    const pass = results.every(({ results: found }) => {
      const only = found.length === 1 ? found[0] : undefined;
      const passage = only ? normalised(only.passage) : "";
      return (
        only?.result === "pass" &&
        passage.length > 0 &&
        passage.length <= passageLimit &&
        texts.some((text) => text.includes(passage))
      );
    });
    return {
      name,
      candidateHash: bundle.candidate.hash,
      result: pass ? ("pass" as const) : ("fail" as const),
      evidenceHash: digest(results),
    };
  });
}
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
