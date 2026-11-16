import {
  acceptedInferenceModels,
  requestDigest,
  tokenCost,
  validateBudgetState,
  emptyBudget,
  importPilotUsage,
  type PilotUsage,
  type BudgetEntry,
  type BudgetState,
  type BudgetLane,
} from "./inference-budget";
import type {
  HistoricalPublicationAttempt,
  HistoricalArtifactInput,
} from "./inference-history-reconciliation";
import { proposeHistoricalReceiptResolutions } from "./inference-history-reconciliation";

export type HistoryRow = {
  sourceKey: string;
  lane: BudgetLane;
  id: string;
  role: string;
  model: string | null;
  responseId: string | null;
  input: number | null;
  output: number | null;
  status: string | null;
  failureCode: string | null;
  candidateHash: string | null;
  inputHash: string | null;
  pipelineId: string | null;
};
export type HistoryEvidence = {
  rows: HistoryRow[];
  publicationAttempts: HistoricalPublicationAttempt[];
  publicationArtifacts: HistoricalArtifactInput[];
  // These are retained, hash-bound report/run metadata, not generated verdicts.
  editorialReceipts: {
    sourceKey: string;
    sourceReportSha256: string;
    role: string;
    model: string;
    responseId: string;
    input: number;
    output: number;
    inputHash: string;
  }[];
  sourceReferences: { path: string; sha256: string }[];
  excludedNoOutboundCustomerRuns: number;
  excludedCustomerSources?: { sourceKey: string; metadataHash: string }[];
};
export type HistoryClassification = {
  sourceKey: string;
  runKey: string;
  kind: "reported_usage" | "no_outbound" | "unresolved_charge";
  sourceRowHash: string;
  provenance: unknown;
  model: string | null;
  responseId: string | null;
  input: number | null;
  output: number | null;
  reason: string;
};
export type HistoryResolution = {
  before: BudgetEntry;
  classification: HistoryClassification;
  classificationHash: string;
  afterHash: string;
  supersedes?: string;
};
const count = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
const hex = (s: unknown): s is string => typeof s === "string" && /^[a-f0-9]{64}$/.test(s);
function dependencyPreventedDispatch(row: HistoryRow, rows: HistoryRow[]) {
  return (
    row.lane === "editorial_evaluation" &&
    ["factual", "challenge"].includes(row.role) &&
    row.status === "dependency_held" &&
    row.failureCode === "DRAFT_NOT_READY" &&
    !!row.pipelineId &&
    row.candidateHash === null &&
    row.responseId === null &&
    row.input === null &&
    row.output === null &&
    rows.some((d) => d.pipelineId === row.pipelineId && d.role === "draft" && d.status === "failed")
  );
}
/** Future imports use actual retained model/usage and exclude only proven
 * no-dispatch dependency rows. Old imported entries are never removed. */
export function verifiedPilotImports(e: HistoryEvidence): PilotUsage[] {
  const initial = e.rows.map((r) => ({
    sourceKey: r.sourceKey,
    lane: r.lane,
    responseId: r.responseId,
    input: r.input,
    output: r.output,
    model: r.model,
  }));
  const baseline = importPilotUsage(emptyBudget(), initial).state;
  const pub = proposeHistoricalReceiptResolutions(baseline, e.publicationAttempts, e.publicationArtifacts);
  return e.rows
    .filter((r) => !dependencyPreventedDispatch(r, e.rows))
    .map((row) => {
      const receipt = pub.proposed.find((p) => p.sourceKey === row.sourceKey)?.receipt;
      return receipt
        ? {
            sourceKey: row.sourceKey,
            lane: row.lane,
            responseId: receipt.responseId,
            input: receipt.inputTokens,
            output: receipt.outputTokens,
            model: receipt.model,
          }
        : {
            sourceKey: row.sourceKey,
            lane: row.lane,
            responseId: row.responseId,
            input: row.input,
            output: row.output,
            model: row.model,
          };
    });
}

/** Metadata-only classification: source IDs, not aggregate counts, establish
 * joins. No historical model maximum is retroactively assigned. */
export function classifyHistoricalInference(state: BudgetState, e: HistoryEvidence) {
  validateBudgetState(state);
  const receiptCheckState = structuredClone(state);
  delete receiptCheckState.historyResolutions;
  for (const row of receiptCheckState.entries)
    if (row.legacy && row.lane === "publication" && row.status === "settled") row.status = "unknown";
  const publication = proposeHistoricalReceiptResolutions(
    receiptCheckState,
    e.publicationAttempts,
    e.publicationArtifacts,
  );
  const seenRows = new Set<string>(),
    seenResponses = new Map<string, string>();
  const classifications: HistoryClassification[] = [];
  for (const row of e.rows) {
    if (seenRows.has(row.sourceKey)) throw Error("HISTORY_DUPLICATE_SOURCE_ID");
    seenRows.add(row.sourceKey);
    const runKey = `pilot:${requestDigest(row.sourceKey)}`,
      entry = state.entries.find((x) => x.runKey === runKey);
    if (!entry) continue; // excluded fault controls are not subtracted a second time
    if (!entry.legacy || entry.lane !== row.lane) throw Error("HISTORY_SOURCE_LEDGER_MISMATCH");
    const base = { sourceKey: row.sourceKey, runKey, sourceRowHash: requestDigest(row) };
    const p = publication.proposed.find((p) => p.sourceKey === row.sourceKey);
    let c: HistoryClassification = {
      ...base,
      kind: "unresolved_charge",
      provenance: { sourceReferences: e.sourceReferences },
      model: row.model,
      responseId: row.responseId,
      input: row.input,
      output: row.output,
      reason: "No retained per-attempt usage/bounds; no zero-cost or later-model assumption",
    };
    if (p) {
      c = {
        ...base,
        kind: "reported_usage",
        provenance: { publicationReceipt: p.receipt, joinKeys: p.joinKeys },
        model: p.receipt.model,
        responseId: p.receipt.responseId,
        input: p.receipt.inputTokens,
        output: p.receipt.outputTokens,
        reason: "Hash-verified retained provider artifact, joined to exact candidate/prompt and role",
      };
    } else if (
      row.lane !== "publication" &&
      row.responseId &&
      acceptedInferenceModels.has(row.model ?? "") &&
      count(row.input) &&
      count(row.output)
    ) {
      if (
        entry.status === "settled" &&
        (entry.responseId !== row.responseId || entry.charged !== tokenCost(row.input, row.output).toString())
      )
        throw Error("HISTORY_SETTLED_SOURCE_CONFLICT");
      const receipt = e.editorialReceipts.filter((r) => r.sourceKey === row.sourceKey);
      if (
        row.lane === "editorial_evaluation" &&
        (receipt.length !== 1 ||
          !hex(receipt[0]!.sourceReportSha256) ||
          receipt[0]!.role !== row.role ||
          receipt[0]!.responseId !== row.responseId ||
          receipt[0]!.model !== row.model ||
          receipt[0]!.input !== row.input ||
          receipt[0]!.output !== row.output ||
          receipt[0]!.inputHash !== row.inputHash)
      )
        throw Error("HISTORY_EDITORIAL_RECEIPT_CONFLICT");
      c = {
        ...base,
        kind: "reported_usage",
        model: row.model,
        responseId: row.responseId,
        input: row.input,
        output: row.output,
        provenance:
          row.lane === "editorial_evaluation"
            ? receipt[0]
            : { source: "persisted provider_runs metadata", sourceRowHash: requestDigest(row) },
        reason: "Exact persisted reported usage; not an account invoice",
      };
    } else if (dependencyPreventedDispatch(row, e.rows)) {
      c = {
        ...base,
        kind: "no_outbound",
        model: row.model,
        responseId: null,
        input: null,
        output: null,
        provenance: {
          pipelineId: row.pipelineId,
          dependencySourceKey: e.rows.find((d) => d.pipelineId === row.pipelineId && d.role === "draft")!
            .sourceKey,
          sourceRowHash: requestDigest(row),
          sourceReferences: e.sourceReferences,
        },
        reason: "Exact reserved review row held before executeRun because this pipeline's drafting failed",
      };
    } else if (entry.status === "cancelled") {
      const old = state.historyResolutions?.find((r) => r.before.runKey === runKey);
      if (
        !old ||
        old.classification.kind !== "no_outbound" ||
        old.classification.sourceRowHash !== requestDigest(row)
      )
        throw Error("HISTORY_CANCELLATION_PROOF_MISSING");
      c = old.classification;
    } else if (entry.status === "settled" && row.lane === "publication")
      throw Error("HISTORY_PUBLICATION_RECEIPT_UNAVAILABLE");
    if (c.kind === "reported_usage") {
      if (!c.responseId || seenResponses.has(c.responseId)) throw Error("HISTORY_PROVIDER_RECEIPT_REUSED");
      seenResponses.set(c.responseId, runKey);
    }
    classifications.push(c);
  }
  if (classifications.length !== state.entries.filter((x) => x.legacy).length)
    throw Error("HISTORY_SOURCE_COVERAGE_INCOMPLETE");
  return {
    version: 2,
    historyHash: requestDigest(state),
    classifications,
    publication,
    excludedNoOutboundCustomerRuns: e.excludedNoOutboundCustomerRuns,
    excludedCustomerSources: e.excludedCustomerSources ?? [],
    customerExclusionsSubtractedFromLedger: 0,
    assumptions:
      "No invoice certification, inferred failed-call zero, historical context/retry cap, or new batch authority",
  };
}

/** Called only by the guarded operator's locked-store transaction after fresh
 * source/artifact verification. Every original entry is retained in full. */
export function applyHistoricalClassifications(
  state: BudgetState,
  report: ReturnType<typeof classifyHistoricalInference>,
) {
  if (report.historyHash !== requestDigest(state)) throw Error("HISTORY_STATE_CHANGED");
  const next = structuredClone(state);
  next.historyResolutions ??= [];
  for (const c of report.classifications) {
    const entry = next.entries.find((x) => x.runKey === c.runKey)!;
    const old = [...next.historyResolutions].reverse().find((x) => x.before.runKey === c.runKey);
    if (old) {
      if (old.afterHash !== requestDigest(entry)) throw Error("HISTORY_RESOLUTION_CHANGED");
      if (old.classificationHash === requestDigest(c)) continue;
      // A newly recovered exact receipt may resolve earlier uncertainty, but
      // cannot erase a charge or rewrite an already established payment fact.
      if (
        old.classification.kind !== "unresolved_charge" &&
        (old.classification.kind !== c.kind ||
          old.classification.responseId !== c.responseId ||
          old.classification.input !== c.input ||
          old.classification.output !== c.output ||
          old.classification.model !== c.model)
      )
        throw Error("HISTORY_CONTRARY_EVIDENCE_REQUIRES_REVIEW");
    }
    const before = structuredClone(entry);
    if (c.kind === "reported_usage") {
      if (
        !c.model ||
        !acceptedInferenceModels.has(c.model) ||
        !c.responseId ||
        !count(c.input) ||
        !count(c.output)
      )
        throw Error("HISTORY_RECEIPT_INVALID");
      if (next.entries.some((x) => x.runKey !== entry.runKey && x.responseId === c.responseId))
        throw Error("HISTORY_PROVIDER_RECEIPT_REUSED");
      entry.status = "settled";
      entry.charged = tokenCost(c.input, c.output).toString();
      entry.reserved = entry.charged;
      entry.inputBound = c.input;
      entry.outputBound = c.output;
      entry.responseId = c.responseId;
      entry.model = c.model;
      entry.usageHash = requestDigest({ input: c.input, output: c.output });
      next.unboundedPrior = next.unboundedPrior.filter((k) => k !== c.runKey);
    } else if (c.kind === "no_outbound") {
      if (entry.status !== "unknown" || entry.responseId || BigInt(entry.charged) !== 0n)
        throw Error("HISTORY_NO_OUTBOUND_CONFLICT");
      entry.status = "cancelled";
      next.unboundedPrior = next.unboundedPrior.filter((k) => k !== c.runKey);
    }
    next.historyResolutions.push({
      before,
      classification: c,
      classificationHash: requestDigest(c),
      afterHash: requestDigest(entry),
      ...(old ? { supersedes: requestDigest(old) } : {}),
    });
  }
  next.priorUseReconciled = next.unboundedPrior.length === 0;
  validateBudgetState(next);
  return next;
}
