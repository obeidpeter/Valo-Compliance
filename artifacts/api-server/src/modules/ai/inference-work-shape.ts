import type { FiniteWork } from "./inference-types";
/** Admission is to a particular role and corpus, never a caller's lane label. */
export function assertFiniteWorkShape(work: FiniteWork) {
  const corpus = {
    publication: null,
    editorial_evaluation: "editorial",
    checker_challenge: "checker",
    customer: "customer-ai",
  } as const;
  const binding = work.bindings;
  if (!binding || !(work.lane in corpus) || binding.corpus !== corpus[work.lane])
    throw Error("WORK_LANE_CORPUS_MISMATCH");
  if (work.lane === "publication") {
    if (binding.caseId !== null || !binding.operationalPlan) throw Error("PUBLICATION_PLAN_REQUIRED");
    const candidate = binding.candidateArtifact;
    if (
      !candidate ||
      !/^[a-f0-9-]{36}$/.test(candidate.id) ||
      !/^[a-f0-9]{64}$/.test(candidate.hash) ||
      candidate.extension !== "json" ||
      // A template's ID or a guide's.
      !/^(?:TPL-\d{2,3}|GUD-\d{2})$/.test(candidate.templateId)
    )
      throw Error("PUBLICATION_CANDIDATE_REQUIRED");
  } else if (binding.candidateArtifact) throw Error("CANDIDATE_ARTIFACT_OUTSIDE_PUBLICATION");
  else if (typeof binding.caseId !== "string" || !binding.caseId.trim()) throw Error("CASE_BINDING_REQUIRED");
  if (work.lane === "customer") {
    if (
      work.role !== "customer" ||
      work.pair !== null ||
      binding.candidateVersionId !== null ||
      binding.operationalPlan
    )
      throw Error("CUSTOMER_WORK_SCOPE_INVALID");
  } else if (!binding.candidateVersionId || !/^[a-f0-9-]{36}$/.test(binding.candidateVersionId))
    throw Error("CANDIDATE_VERSION_REQUIRED");
  if (work.lane === "checker_challenge" && (work.role !== "challenge" || work.pair !== null))
    throw Error("CHECKER_CHALLENGE_SCOPE_INVALID");
  if (
    ["publication", "editorial_evaluation"].includes(work.lane) &&
    (!work.pair || !["factual", "challenge"].includes(work.role))
  )
    throw Error("REVIEW_PAIR_REQUIRED");
}
