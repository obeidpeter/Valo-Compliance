import { createHash } from "node:crypto";
import {
  acceptedInferenceModels,
  requestDigest,
  tokenCost,
  validateBudgetState,
  type BudgetState,
} from "./inference-budget";

export type HistoricalPublicationAttempt = {
  id: string;
  candidateHash: string;
  role: string;
  requestHash: string | null;
  responseId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
};
export type HistoricalArtifactInput = {
  ref: { id: string; hash: string; extension: "json" };
  bytes: Uint8Array;
  reportCandidateHash: string;
  sourceReportSha256: string;
};
type Receipt = {
  artifactId: string;
  artifactHash: string;
  sourceReportSha256: string;
  candidateHash: string;
  role: "draft" | "factual" | "challenge";
  requestHash: string | null;
  responseId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
};
const hex = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const count = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** A retained JSON summary is not a receipt. Only the actual hash-matching
 * private response artifact supplies model, usage and response identity. This
 * proves the retained server record, not an account invoice or legal review. */
export function verifyHistoricalPublicationReceipt(input: HistoricalArtifactInput): Receipt {
  if (
    !hex(input.ref.hash) ||
    !hex(input.reportCandidateHash) ||
    !hex(input.sourceReportSha256) ||
    !/^[a-f0-9-]{36}$/.test(input.ref.id) ||
    input.ref.extension !== "json" ||
    input.bytes.byteLength > 2 * 1024 * 1024 ||
    sha256(input.bytes) !== input.ref.hash
  )
    throw Error("HISTORY_ARTIFACT_HASH_INVALID");
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(Buffer.from(input.bytes).toString("utf8"));
  } catch {
    throw Error("HISTORY_ARTIFACT_JSON_INVALID");
  }
  // A legacy drafting reservation is keyed to its actual drafting prompt,
  // not the subsequently edited final publication candidate.
  const binding = value?.role === "draft" ? value.promptHash : value?.candidateHash;
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !hex(binding) ||
    binding !== input.reportCandidateHash ||
    !["draft", "factual", "challenge"].includes(value.role as string) ||
    typeof value.providerResponseId !== "string" ||
    !value.providerResponseId.trim() ||
    value.providerResponseId.length > 200 ||
    typeof value.model !== "string" ||
    !acceptedInferenceModels.has(value.model) ||
    !count(value.inputTokens) ||
    !count(value.outputTokens) ||
    (value.requestHash !== undefined && value.requestHash !== null && !hex(value.requestHash))
  )
    throw Error("HISTORY_RECEIPT_FIELDS_INVALID");
  return {
    artifactId: input.ref.id,
    artifactHash: input.ref.hash,
    sourceReportSha256: input.sourceReportSha256,
    candidateHash: binding,
    role: value.role as Receipt["role"],
    requestHash: (value.requestHash as string | null) ?? null,
    responseId: value.providerResponseId,
    model: value.model,
    inputTokens: value.inputTokens,
    outputTokens: value.outputTokens,
  };
}

/** Produce auditable proposals only. Nothing updates old rows, grants a new
 * allocation, declares an unknown free or changes priorUseReconciled. Each
 * proposal binds the exact old entry, source row and private artifact. */
export function proposeHistoricalReceiptResolutions(
  state: BudgetState,
  attempts: HistoricalPublicationAttempt[],
  artifacts: HistoricalArtifactInput[],
) {
  validateBudgetState(state);
  const verified: Receipt[] = [],
    invalidArtifacts: { artifactId: string; reason: string }[] = [],
    seen = new Set<string>();
  for (const input of artifacts) {
    try {
      const receipt = verifyHistoricalPublicationReceipt(input),
        key = `${receipt.artifactId}:${receipt.artifactHash}`;
      // Repeated byte-identical references are one receipt. Different artifact
      // IDs containing the same provider receipt are also one charge.
      const same = verified.find(
        (r) =>
          r.responseId === receipt.responseId &&
          requestDigest({
            candidateHash: r.candidateHash,
            role: r.role,
            requestHash: r.requestHash,
            model: r.model,
            inputTokens: r.inputTokens,
            outputTokens: r.outputTokens,
          }) ===
            requestDigest({
              candidateHash: receipt.candidateHash,
              role: receipt.role,
              requestHash: receipt.requestHash,
              model: receipt.model,
              inputTokens: receipt.inputTokens,
              outputTokens: receipt.outputTokens,
            }),
      );
      if (!seen.has(key) && !same) {
        verified.push(receipt);
        seen.add(key);
      }
    } catch (error) {
      invalidArtifacts.push({
        artifactId: input.ref?.id ?? "unknown",
        reason: error instanceof Error ? error.message : "HISTORY_ARTIFACT_INVALID",
      });
    }
  }
  const uniqueSources = new Map<string, HistoricalPublicationAttempt>();
  const conflictingSources = new Set<string>();
  for (const source of attempts) {
    const old = uniqueSources.get(source.id);
    if (old && requestDigest(old) !== requestDigest(source)) conflictingSources.add(source.id);
    else uniqueSources.set(source.id, source);
  }
  const validSource = (s: HistoricalPublicationAttempt) =>
    /^\d+$/.test(s.id) &&
    hex(s.candidateHash) &&
    ["draft", "factual", "challenge"].includes(s.role) &&
    (s.requestHash === null || hex(s.requestHash)) &&
    (s.responseId === null || (typeof s.responseId === "string" && Boolean(s.responseId.trim()))) &&
    (s.inputTokens === null || count(s.inputTokens)) &&
    (s.outputTokens === null || count(s.outputTokens));
  const identityMatches = (s: HistoricalPublicationAttempt, r: Receipt) =>
    s.candidateHash === r.candidateHash &&
    s.role === r.role &&
    (s.requestHash === null || r.requestHash === null || s.requestHash === r.requestHash) &&
    (s.responseId === null || s.responseId === r.responseId);
  const rows = [...uniqueSources.values()];
  const proposed: {
    sourceKey: string;
    ledgerRunKey: string;
    beforeEntryHash: string;
    sourceRowHash: string;
    receipt: Receipt;
    joinKeys: string[];
    estimatedNanoUsd: string;
    proposalHash: string;
  }[] = [];
  const unresolved: { sourceKey: string; reason: string }[] = [];
  for (const source of rows) {
    const sourceKey = `publication:${source.id}`,
      ledgerRunKey = `pilot:${requestDigest(sourceKey)}`;
    const entry = state.entries.find((e) => e.runKey === ledgerRunKey);
    if (!entry || entry.legacy !== true || entry.status !== "unknown") continue;
    const hold = (reason: string) => unresolved.push({ sourceKey, reason });
    if (conflictingSources.has(source.id) || !validSource(source)) {
      hold("HISTORY_SOURCE_INVALID_OR_CONFLICTING");
      continue;
    }
    const matches = verified.filter((r) => identityMatches(source, r));
    if (matches.length !== 1) {
      hold(matches.length ? "HISTORY_RECEIPT_AMBIGUOUS" : "HISTORY_VERIFIED_RECEIPT_MISSING");
      continue;
    }
    const receipt = matches[0]!;
    if (rows.filter((s) => validSource(s) && identityMatches(s, receipt)).length !== 1) {
      hold("HISTORY_ATTEMPT_AMBIGUOUS");
      continue;
    }
    if (
      verified.filter((r) => r.responseId === receipt.responseId).length !== 1 ||
      state.entries.some((e) => e.runKey !== ledgerRunKey && e.responseId === receipt.responseId)
    ) {
      hold("HISTORY_PROVIDER_RECEIPT_REUSED");
      continue;
    }
    if (
      (source.inputTokens !== null && source.inputTokens !== receipt.inputTokens) ||
      (source.outputTokens !== null && source.outputTokens !== receipt.outputTokens) ||
      (entry.responseId !== undefined && entry.responseId !== receipt.responseId)
    ) {
      hold("HISTORY_SOURCE_RECEIPT_CONFLICT");
      continue;
    }
    const joinKeys = ["candidateHash", "role"];
    if (source.requestHash !== null && receipt.requestHash !== null) joinKeys.push("requestHash");
    if (source.responseId !== null) joinKeys.push("providerResponseId");
    const evidence = {
      sourceKey,
      ledgerRunKey,
      beforeEntryHash: requestDigest(entry),
      sourceRowHash: requestDigest(source),
      receipt,
      joinKeys,
      estimatedNanoUsd: tokenCost(receipt.inputTokens, receipt.outputTokens).toString(),
    };
    proposed.push({ ...evidence, proposalHash: requestDigest(evidence) });
  }
  return {
    version: 1,
    historyHash: requestDigest(state),
    proposed,
    unresolved,
    invalidArtifacts,
    verifiedRetainedArtifacts: verified.length,
    ledgerWrites: 0,
    approvalWrites: 0,
    providerCalls: 0,
    reconciliationApplied: false,
    unboundedLiabilitiesUnchanged: state.unboundedPrior.length,
    note: "Reported-token estimates are not account invoices. Proposed joins do not alter or discharge any liability.",
  };
}

/** Read-only exposure reconstruction. Retained receipt proposals can refine a
 * projection, never erase old rows or manufacture a remaining balance. */
export function projectHistoricalExposure(
  state: BudgetState,
  report: ReturnType<typeof proposeHistoricalReceiptResolutions>,
) {
  validateBudgetState(state);
  if (report.historyHash !== requestDigest(state)) throw Error("HISTORY_PROJECTION_CHANGED");
  const entries = structuredClone(state.entries),
    resolved = new Set<string>();
  for (const p of report.proposed) {
    const e = entries.find((x) => x.runKey === p.ledgerRunKey);
    const { proposalHash, ...bound } = p;
    if (
      !e ||
      e.status !== "unknown" ||
      !e.legacy ||
      requestDigest(e) !== p.beforeEntryHash ||
      requestDigest(bound) !== proposalHash ||
      !acceptedInferenceModels.has(p.receipt.model) ||
      tokenCost(p.receipt.inputTokens, p.receipt.outputTokens).toString() !== p.estimatedNanoUsd
    )
      throw Error("HISTORY_PROJECTION_BINDING_CHANGED");
    e.status = "settled";
    e.charged = p.estimatedNanoUsd;
    e.reserved = p.estimatedNanoUsd;
    resolved.add(e.runKey);
  }
  const unresolved = state.unboundedPrior.filter((key) => !resolved.has(key));
  return {
    potentialChargeRecords: entries.length,
    metadataReportedUsageRecords: state.entries.filter((e) => e.status === "settled").length,
    retainedReceiptRefinements: resolved.size,
    unresolvedLiabilities: unresolved.length,
    projectedUsageEstimateNanoUsd: entries
      .reduce((sum, e) => sum + BigInt(e.status === "settled" ? e.charged : e.reserved), 0n)
      .toString(),
    inclusiveRemainingNanoUsd: null,
    actualBillingVerified: false,
    ledgerWrites: 0,
    sourceRowsChanged: 0,
    modelCapacityAssumptionsApplied: 0,
    note: "No unsupported model-cap assumptions were applied. Missing per-attempt request/model evidence remains held; committed code alone does not prove what was dispatched. These are potential charges and usage estimates, not verified paid calls.",
  };
}
