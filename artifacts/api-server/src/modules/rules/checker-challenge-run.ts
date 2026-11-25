import { createHash } from "node:crypto";
import {
  managedCompletion,
  managedInferenceLane,
  parseBoundedProviderJSON,
  requestDigest,
  withApprovedInferenceWork,
  type FiniteWork,
} from "../ai";
import { putPublicationArtifact } from "../publication";
import { checkerChallengeVerdictSchema } from "./checker-challenge";

type Put = typeof putPublicationArtifact;

/**
 * RUL-008 (docs/architecture/checker-scenarios.md, slice 2b): runs an admitted manifest of challenge
 * requests, one approved work at a time through the dispatcher's own authorization (withApprovedInferenceWork),
 * and keeps each answer, or its failure, as a private record. A failed or invalid attempt is recorded
 * as it happened, never replaced by an invented answer. The records accept nothing: an AI challenge
 * of an expected result is not professional review, and the corpus's expected results stay as they
 * are until a person decides on each (decision 0016).
 */
export async function executeCheckerChallenges(
  batchId: string,
  works: readonly FiniteWork[],
  put: Put = putPublicationArtifact,
) {
  // Each challenge opens its own approved work below, and the completion inside it refuses to run
  // without one, so no inference context is open, or needed, before the first.
  const [first] = works;
  if (
    !first ||
    works.some(
      (w) =>
        w.lane !== "checker_challenge" ||
        w.role !== "challenge" ||
        w.pair !== null ||
        !w.bindings.caseId ||
        w.bindings.candidateVersionId !== first.bindings.candidateVersionId,
    )
  )
    throw Error("CHECKER_CHALLENGE_MANIFEST_INVALID");
  const results: {
    caseId: string;
    outcome: "completed" | "failed";
    artifact: Awaited<ReturnType<Put>>;
    providerResponseId: string | null;
  }[] = [];
  for (const work of works) {
    const caseId = work.bindings.caseId!;
    const common = {
      caseId,
      caseHash: work.caseHash,
      releaseId: work.bindings.candidateVersionId,
      candidateHash: work.candidateHash,
      workKey: work.key,
      requestHash: requestDigest(work.request),
      accepted: false,
    };
    let outboundAttempted = false,
      received = false;
    try {
      const response = await withApprovedInferenceWork(batchId, work.key, () =>
        managedCompletion(managedInferenceLane("checker_challenge"), work.request, {
          timeout: 45000,
          maxRetries: 0,
          onOutbound: () => {
            outboundAttempted = true;
          },
        }),
      );
      received = true;
      if (response.choices[0]?.finish_reason !== "stop") throw Error("CHECKER_CHALLENGE_INCOMPLETE");
      const output = checkerChallengeVerdictSchema.parse(
        parseBoundedProviderJSON(response.choices[0].message.content ?? ""),
      );
      const record = {
        kind: "checker-challenge-answer-v1",
        ...common,
        providerResponseId: response.id,
        model: response.model,
        providerCreatedAt: new Date(response.created * 1000).toISOString(),
        outboundAttempted,
        output,
        outputHash: createHash("sha256").update(JSON.stringify(output)).digest("hex"),
        completedAt: new Date().toISOString(),
      };
      const artifact = await put(Buffer.from(JSON.stringify(record)), "json");
      results.push({ caseId, outcome: "completed", artifact, providerResponseId: response.id });
    } catch (error) {
      const code =
        error instanceof Error && /^[A-Z_]{3,80}$/.test(error.message)
          ? error.message
          : received
            ? "CHECKER_CHALLENGE_RESPONSE_INVALID"
            : "CHECKER_CHALLENGE_PROVIDER_FAILURE";
      const record = {
        kind: "checker-challenge-failure-v1",
        ...common,
        outboundAttempted,
        responseReceived: received,
        code,
        completedAt: new Date().toISOString(),
      };
      const artifact = await put(Buffer.from(JSON.stringify(record)), "json");
      results.push({ caseId, outcome: "failed", artifact, providerResponseId: null });
    }
  }
  return results;
}
