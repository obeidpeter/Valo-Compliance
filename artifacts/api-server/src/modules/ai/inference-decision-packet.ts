import { createHash } from "node:crypto";
import {
  additionalInferenceAllocation,
  inferenceProposal,
  requestDigest,
  tokenCost,
} from "./inference-budget";
import type { finiteManifestProposal } from "./inference-manifest";
import { assertFiniteWorkShape } from "./inference-work-shape";
type Proposal = ReturnType<typeof finiteManifestProposal>;
type Artifact = { id: string; hash: string; extension: "json" | "pdf" | "docx" };

/** A reviewable projection of actual private manifests, not a new authority
 * source. Full requests remain in the hash-verified private manifest artifacts. */
export function buildFiniteDecisionPacket(
  proposals: Proposal[],
  artifacts: Artifact[],
  capacity: { stateFingerprint: string; uncommittedCapacityNanoUsd: string | null; observedAt: string },
  now = new Date(),
) {
  if (!proposals.length || proposals.length !== artifacts.length) throw Error("EXACT_WORK_ROSTER_REQUIRED");
  const keys = new Set<string>(),
    packages = new Set<string>();
  const laneAttempts = { publication: 0, editorial_evaluation: 0, checker_challenge: 0, customer: 0 };
  let independentPairs = 0,
    customerCases = 0,
    editorialCases = 0;
  const attempts = proposals.reduce((n, p) => n + p.manifest.works.length, 0);
  const perAttempt = tokenCost(
    inferenceProposal.fallback.inputTokens,
    inferenceProposal.fallback.outputTokens,
  );
  const cost = perAttempt * BigInt(attempts);
  if (
    attempts > inferenceProposal.lanes.publication.slots ||
    cost > BigInt(additionalInferenceAllocation.capNanoUsd)
  )
    throw Error("PREPARED_ROSTER_EXCEEDS_ALLOCATION");
  const manifests = proposals.map((p, index) => {
    const artifact = artifacts[index]!;
    if (
      requestDigest(p.manifest) !== p.manifestHash ||
      p.ownerApproved ||
      p.enabled ||
      p.attemptCount !== p.manifest.works.length ||
      p.automaticRetries !== 0 ||
      p.worstCaseReservationNanoUsd !== (perAttempt * BigInt(p.attemptCount)).toString() ||
      requestDigest(p.manifest.allocation) !== requestDigest(additionalInferenceAllocation) ||
      p.manifest.policyVersion !== inferenceProposal.priceVersion ||
      artifact.extension !== "json" ||
      !/^[a-f0-9-]{36}$/.test(artifact.id) ||
      artifact.hash !== createHash("sha256").update(JSON.stringify(p.manifest)).digest("hex")
    )
      throw Error("PREPARED_MANIFEST_BINDING_INVALID");
    if (!Number.isFinite(Date.parse(p.expiresAt)) || Date.parse(p.expiresAt) <= now.getTime())
      throw Error("PREPARED_MANIFEST_EXPIRED");
    if (!p.packageId || p.packageId !== p.manifest.packageId) throw Error("PREPARED_PACKAGE_REQUIRED");
    packages.add(p.packageId);
    const customer = p.manifest.works.length > 0 && p.manifest.works.every((w) => w.lane === "customer");
    // An editorial case's manifest is its own factual and challenge review pair (decision 0015).
    const editorial =
      p.manifest.works.length > 0 && p.manifest.works.every((w) => w.lane === "editorial_evaluation");
    if (customer) {
      const [first, second] = p.manifest.works;
      if (
        !first ||
        p.manifest.works.length > 2 ||
        first.retryOf ||
        first.role !== "customer" ||
        first.pair !== null ||
        first.candidateHash !== first.caseHash ||
        first.bindings.corpus !== "customer-ai" ||
        !first.bindings.caseId ||
        (second &&
          (second.retryOf !== first.key ||
            second.role !== "customer" ||
            second.pair !== null ||
            second.candidateHash !== first.candidateHash ||
            second.caseHash !== first.caseHash ||
            requestDigest(second.bindings) !== requestDigest(first.bindings) ||
            requestDigest(second.sourceHashes) !== requestDigest(first.sourceHashes) ||
            requestDigest(second.request) !== requestDigest(first.request)))
      )
        throw Error("PREPARED_CUSTOMER_ATTEMPTS_INVALID");
      customerCases++;
    } else {
      if (
        p.manifest.works.length !== 2 ||
        new Set(p.manifest.works.map((w) => w.role)).size !== 2 ||
        !p.manifest.works[0]!.pair ||
        p.manifest.works[0]!.pair !== p.manifest.works[1]!.pair ||
        new Set(p.manifest.works.map((w) => requestDigest(w.request))).size !== 2 ||
        requestDigest(p.manifest.works[0]!.bindings) !== requestDigest(p.manifest.works[1]!.bindings) ||
        p.manifest.works[0]!.candidateHash !== p.manifest.works[1]!.candidateHash ||
        p.manifest.works[0]!.caseHash !== p.manifest.works[1]!.caseHash ||
        requestDigest(p.manifest.works[0]!.sourceHashes) !== requestDigest(p.manifest.works[1]!.sourceHashes)
      )
        throw Error("PREPARED_INDEPENDENT_PAIR_REQUIRED");
      independentPairs++;
      if (editorial) editorialCases++;
    }
    const works = p.manifest.works.map((w) => {
      assertFiniteWorkShape(w);
      if (
        (customer
          ? w.lane !== "customer" || w.role !== "customer"
          : w.lane !== (editorial ? "editorial_evaluation" : "publication") ||
            !["factual", "challenge"].includes(w.role) ||
            !!w.retryOf) ||
        keys.has(w.key) ||
        w.request.model !== inferenceProposal.model ||
        w.request.max_completion_tokens !== 8192
      )
        throw Error("PREPARED_WORK_NOT_SUPPORTED");
      keys.add(w.key);
      laneAttempts[w.lane]++;
      return {
        key: w.key,
        role: w.role,
        lane: w.lane,
        requestHash: requestDigest(w.request),
        candidateVersionId: w.bindings.candidateVersionId,
        candidateArtifact: w.bindings.candidateArtifact ?? null,
        candidateHash: w.candidateHash,
        publicationBundleHash: w.lane === "publication" ? w.caseHash : null,
        evaluationCase: customer
          ? { id: w.bindings.caseId, hash: w.caseHash, corpus: "customer-ai" }
          : editorial
            ? { id: w.bindings.caseId, hash: w.caseHash, corpus: "editorial" }
            : { id: null, reason: "Publication preparation is not an authored evaluation-corpus case." },
        ...(customer ? { retryOf: w.retryOf ?? null } : {}),
        sourceHashes: w.sourceHashes,
        sourceFiles: w.bindings.sourceFiles,
        planArtifact: w.bindings.operationalPlan,
        inputReservationTokens: 400000,
        maximumCompletionTokens: 8192,
        maximumAttempts: 1,
        worstCaseReservationNanoUsd: perAttempt.toString(),
      };
    });
    return { manifestHash: p.manifestHash, artifact, expiresAt: p.expiresAt, works };
  });
  if (laneAttempts.publication > 216 || laneAttempts.customer > 94 || laneAttempts.editorial_evaluation > 68)
    throw Error("PREPARED_LANE_LIMIT_EXCEEDED");
  if (packages.size !== 1) throw Error("PREPARED_PACKAGES_DIFFER");
  const room = capacity.uncommittedCapacityNanoUsd;
  if (room !== null && !/^\d+$/.test(room)) throw Error("CAPACITY_INSPECTION_INVALID");
  return {
    version: customerCases || editorialCases ? 2 : 1,
    status:
      room !== null && cost <= BigInt(room)
        ? "prepared-awaiting-approval-and-independent-review"
        : "held-capacity-unverified",
    preparedAt: now.toISOString(),
    expiresAt: new Date(Math.min(...proposals.map((p) => Date.parse(p.expiresAt)))).toISOString(),
    packageId: [...packages][0],
    manifests,
    attemptCount: attempts,
    independentPairs,
    ...(customerCases ? { customerCases, laneAttempts } : {}),
    ...(editorialCases ? { editorialCases, laneAttempts } : {}),
    worstCaseReservationNanoUsd: cost.toString(),
    allocationCapNanoUsd: additionalInferenceAllocation.capNanoUsd,
    capacityObservation: capacity,
    historicalChargesIncluded: false,
    startBoundary: additionalInferenceAllocation.startBoundary,
    concurrency: 2,
    automaticRetries: 0,
    completionsPerAttempt: 1,
    tools: false,
    reviewStatus: "independent-review-pending",
    ownerApproved: false,
    enabled: false,
    authorizesDispatch: false,
    stoppingConditions: [
      "No durable exact package/work approval",
      "Expired plan, policy, candidate, source, rights or export binding",
      "Insufficient shared allocation, daily/identity quota or provider capacity",
      "Unexpected model or untrustworthy usage retains reservation and holds outcome",
      "Timeout/process loss retains unknown reservation; no automatic retry",
      "A further attempt requires a new explicitly permitted work item and reservation",
      "A missing preparer or held source never becomes a fabricated request",
    ],
    excludedWork: editorialCases
      ? "Only the listed editorial case pairs are executable; template review pairs, customer and checker evaluation, new authoring and unsupported work remain excluded."
      : customerCases
        ? "Only the listed customer cases and publication pairs are executable; editorial/checker evaluation, new authoring and unsupported work remain excluded."
        : "No evaluation-case, regulatory-guidance or other unsupported request is implied by this actual roster.",
  };
}
