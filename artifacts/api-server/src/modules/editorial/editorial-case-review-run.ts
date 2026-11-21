import { digest } from "@workspace/valo-core";
import {
  assertManagedInferenceAvailable,
  hasApprovedInferencePairContext,
  managedCompletion,
  managedInferenceLane,
  parseBoundedProviderJSON,
  requestDigest,
  withApprovedInferenceRole,
  type FiniteWork,
} from "../ai";
import { operationalReviewSchemaFor, putPublicationArtifact } from "../publication";
import { editorialCaseCandidate } from "./editorial-case-reviews";
import { providerUsage } from "./review-meter";

type Put = typeof putPublicationArtifact;

/**
 * Runs one editorial case's admitted review pair inside the approved pair the runner opens
 * (withApprovedInferencePair), and keeps each reviewer's answer, or its failure, as a private
 * record. The reviews run one after the other and neither sees the other's verdict; a failed or held
 * attempt is recorded as it happened, never replaced by an invented answer. The records are the
 * case's provider evidence. They score nothing and accept nothing: an independent reviewer still
 * confirms each case's expected outcome (decision 0015, point 5).
 */
export async function executeEditorialCaseReviews(works: FiniteWork[], put: Put = putPublicationArtifact) {
  assertManagedInferenceAvailable();
  if (!hasApprovedInferencePairContext()) throw Error("APPROVED_REVIEW_PAIR_REQUIRED");
  const [first] = works;
  if (
    works.length !== 2 ||
    !first?.bindings.caseId ||
    works.some(
      (w) =>
        w.lane !== "editorial_evaluation" ||
        w.pair !== first.pair ||
        w.bindings.caseId !== first.bindings.caseId,
    ) ||
    new Set(works.map((w) => w.role)).size !== 2
  )
    throw Error("EDITORIAL_CASE_PAIR_INVALID");
  const c = editorialCaseCandidate(first.bindings.caseId);
  if (works.some((w) => w.candidateHash !== c.candidate.hash || w.caseHash !== c.caseHash))
    throw Error("EDITORIAL_CASE_PAIR_INVALID");
  const common = {
    caseId: c.caseId,
    caseHash: c.caseHash,
    candidateHash: c.candidate.hash,
    evidenceHash: digest(c.sources),
    pair: first.pair,
    formalCaseAccepted: false,
  };
  const results: {
    role: "factual" | "challenge";
    outcome: "completed" | "failed";
    artifact: Awaited<ReturnType<Put>>;
    providerResponseId: string | null;
  }[] = [];
  for (const work of works) {
    const role = work.role as "factual" | "challenge";
    const started = performance.now();
    let outboundAttempted = false,
      received = false;
    try {
      const response = await withApprovedInferenceRole(role, () =>
        managedCompletion(managedInferenceLane("editorial_evaluation"), work.request, {
          timeout: 45000,
          maxRetries: 0,
          onOutbound: () => {
            outboundAttempted = true;
          },
        }),
      );
      received = true;
      if (response.choices[0]?.finish_reason !== "stop") throw Error("EDITORIAL_CASE_REVIEW_INCOMPLETE");
      const output = operationalReviewSchemaFor(c.candidate).parse(
        parseBoundedProviderJSON(response.choices[0].message.content ?? ""),
      );
      const record = {
        kind: "editorial-case-review-v1",
        ...common,
        role,
        workKey: work.key,
        requestHash: requestDigest(work.request),
        providerResponseId: response.id,
        model: response.model,
        providerCreatedAt: new Date(response.created * 1000).toISOString(),
        receivedOtherVerdict: false,
        outboundAttempted,
        output,
        ...providerUsage(response.usage),
        latencyMs: Math.round(performance.now() - started),
        completedAt: new Date().toISOString(),
      };
      const artifact = await put(Buffer.from(JSON.stringify(record)), "json");
      results.push({ role, outcome: "completed", artifact, providerResponseId: response.id });
    } catch (error) {
      const code =
        error instanceof Error && /^[A-Z_]{3,80}$/.test(error.message)
          ? error.message
          : received
            ? "EDITORIAL_CASE_REVIEW_RESPONSE_INVALID"
            : "EDITORIAL_CASE_REVIEW_PROVIDER_FAILURE";
      const record = {
        kind: "editorial-case-review-failure-v1",
        ...common,
        role,
        workKey: work.key,
        requestHash: requestDigest(work.request),
        outboundAttempted,
        responseReceived: received,
        code,
        completedAt: new Date().toISOString(),
      };
      const artifact = await put(Buffer.from(JSON.stringify(record)), "json");
      results.push({ role, outcome: "failed", artifact, providerResponseId: null });
    }
  }
  return results;
}
