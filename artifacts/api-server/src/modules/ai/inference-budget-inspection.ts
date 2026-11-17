import {
  additionalInferenceAllocation,
  budgetUsed,
  emptyBudget,
  inferenceProposal,
  requestDigest,
  tokenCost,
  validateBudgetState,
  type BudgetState,
} from "./inference-budget";

/** Accounting information only. Reservation/dispatch still require the actual
 * approved immutable work and the locked shared ledger, not this snapshot. */
export function inspectInferenceBudget(input: {
  scope: "legacy" | "additional-new";
  observedAt: string;
  row: null | { version: number; policyHash: string; state: BudgetState };
}) {
  const { row, scope } = input;
  if (!Number.isFinite(Date.parse(input.observedAt))) throw Error("INVALID_INSPECTION_TIME");
  if (
    row &&
    (!Number.isSafeInteger(row.version) || row.version < 0 || !/^[a-f0-9]{64}$/.test(row.policyHash))
  )
    throw Error("INVALID_INSPECTION_METADATA");
  const state = row?.state ?? { ...emptyBudget(), priorUseReconciled: scope === "additional-new" };
  validateBudgetState(state);
  const policyMatches = !row || row.policyHash === requestDigest(inferenceProposal);
  const cap = BigInt(inferenceProposal.capNanoUsd),
    committed = budgetUsed(state);
  const settled = state.entries
    .filter((e) => e.status === "settled")
    .reduce((n, e) => n + BigInt(e.charged), 0n);
  const outstanding = committed - settled;
  const counts = Object.fromEntries(
    ["reserved", "dispatched", "unknown", "settled", "cancelled"].map((status) => [
      status,
      state.entries.filter((e) => e.status === status).length,
    ]),
  );
  const holds = [
    ...(!policyMatches ? ["STORED_POLICY_DIFFERS"] : []),
    ...(!state.priorUseReconciled ? ["SCOPED_PRIOR_USAGE_UNRECONCILED"] : []),
    ...(state.unboundedPrior.length ? ["UNBOUNDED_PRIOR_EXPOSURE"] : []),
    ...(state.suspended ? ["ALLOCATION_SUSPENDED"] : []),
    ...(committed > cap ? ["COMMITMENTS_EXCEED_CURRENT_PROPOSAL"] : []),
  ];
  // Never present a legacy exposure register as a remaining project balance.
  const room = scope === "additional-new" && !holds.length ? (committed <= cap ? cap - committed : 0n) : null;
  const attempt = tokenCost(inferenceProposal.fallback.inputTokens, inferenceProposal.fallback.outputTokens);
  return {
    observedAt: input.observedAt,
    scope,
    allocationId: scope === "additional-new" ? additionalInferenceAllocation.id : inferenceProposal.id,
    accountingBasis: row ? "persisted-ledger" : "uninitialized-policy-default",
    ledgerVersion: row?.version ?? null,
    policyMatches,
    stateFingerprint: requestDigest({
      scope,
      version: row?.version ?? null,
      policyHash: row?.policyHash ?? null,
      state,
    }),
    records: state.entries.length,
    statusCounts: counts,
    unboundedPriorRecords: state.unboundedPrior.length,
    boundedCommittedNanoUsd: committed.toString(),
    settledNanoUsd: settled.toString(),
    outstandingReservedNanoUsd: outstanding.toString(),
    proposedCapNanoUsd: cap.toString(),
    uncommittedCapacityNanoUsd: room?.toString() ?? null,
    fallbackPerAttemptNanoUsd: attempt.toString(),
    maximumWholeContextAttempts: room === null ? null : (room / attempt).toString(),
    maximumWholeContextPairs: room === null ? null : (room / (attempt * 2n)).toString(),
    holds,
    authorizesDispatch: false as const,
    scopeNotice:
      scope === "legacy"
        ? "Historical exposure only; not an approved project allocation or a verified bill."
        : "Additional work begins only at durable owner approval. Capacity is not approval, a funded balance or a promise of completing the roster.",
  };
}
