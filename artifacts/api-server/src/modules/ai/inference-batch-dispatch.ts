import { AsyncLocalStorage } from "node:async_hooks";
import { assertFinancialDispatchAllowed } from "./inference-budget";
import type { InferenceBudgetStore } from "./inference-budget-store";
import {
  inferenceProposal,
  additionalInferenceAllocation,
  acceptedInferenceModels,
  inferenceTimestamp,
  requestDigest,
  reserveBudget,
  reserveReviewPair,
  transitionBudget,
  settleBudget,
  type BudgetLane,
  type BudgetState,
  type ReserveInput,
} from "./inference-budget";
import type {
  CompletionTransport,
  FiniteManifest,
  FiniteWork,
  ManagedCompletionResult,
  ManagedRequest,
} from "./inference-types";
export type { CompletionTransport, FiniteManifest, FiniteWork } from "./inference-types";
import { assertDelegatedBatchAuthority } from "./inference-allocation-package";
import { assertFiniteWorkShape } from "./inference-work-shape";
import { assertManagedRatePolicy } from "./inference-price-evidence";
type Context = { batchId: string; key: string | null; lane: BudgetLane; pair?: string; rootKey?: string };
/** Approval is a durable, expiring authorization of this exact immutable
 * roster. Every batch shares the same additional allocation; legacy charges
 * remain in their own unchanged ledger. No HTTP input can create authority. */
export class FiniteInferenceDispatcher {
  private context = new AsyncLocalStorage<Context>();
  constructor(
    private store: InferenceBudgetStore,
    private transport: CompletionTransport,
    private recheckBindings: (work: FiniteWork) => Promise<void>,
  ) {}
  current() {
    return this.context.getStore();
  }
  private async batch(c: import("pg").PoolClient, id: string, admitting = true) {
    assertManagedRatePolicy(inferenceProposal);
    const r = await c.query(
      `SELECT * FROM "${this.store.schemaName()}".valo_inference_batches WHERE id=$1 FOR SHARE`,
      [id],
    );
    const row = r.rows[0];
    if (
      !row ||
      !row.approved_by ||
      !row.approval_reference ||
      !row.approved_at ||
      (admitting && !row.enabled)
    )
      throw Error("INFERENCE_BATCH_NOT_AUTHORIZED");
    const now = Date.now(),
      approvedAt = inferenceTimestamp(row.approved_at),
      expiresAt = inferenceTimestamp(row.expires_at);
    if (
      !Number.isFinite(approvedAt) ||
      !Number.isFinite(expiresAt) ||
      approvedAt > now ||
      (admitting && expiresAt <= now)
    )
      throw Error("INFERENCE_BATCH_EXPIRED");
    const manifest = row.manifest as FiniteManifest;
    if (
      row.policy_hash !== requestDigest(inferenceProposal) ||
      row.manifest_hash !== requestDigest(manifest) ||
      manifest.version !== 2 ||
      manifest.policyVersion !== inferenceProposal.priceVersion ||
      requestDigest(manifest.allocation) !== requestDigest(additionalInferenceAllocation) ||
      this.store.allocationId() !== additionalInferenceAllocation.id ||
      !Number.isFinite(Date.parse(manifest.preparedAt)) ||
      Date.parse(manifest.preparedAt) > approvedAt ||
      !Array.isArray(manifest.works) ||
      manifest.works.length === 0 ||
      manifest.works.length > 458
    )
      throw Error("INFERENCE_MANIFEST_INVALID");
    const keys = new Set<string>();
    for (const work of manifest.works) {
      assertFiniteWorkShape(work);
      if (
        !work.key ||
        keys.has(work.key) ||
        !inferenceProposal.lanes[work.lane] ||
        ![work.candidateHash, work.caseHash, ...work.sourceHashes].every((h) => /^[a-f0-9]{64}$/.test(h)) ||
        !["factual", "challenge", "customer"].includes(work.role) ||
        (work.lane === "customer") !== (work.role === "customer") ||
        (work.lane === "checker_challenge" && work.role !== "challenge") ||
        (["publication", "editorial_evaluation"].includes(work.lane) && !work.pair)
      )
        throw Error("INFERENCE_MANIFEST_INVALID");
      keys.add(work.key);
    }
    for (const work of manifest.works) {
      if (work.retryOf) {
        const original = manifest.works.find((w) => w.key === work.retryOf);
        if (
          !original ||
          original.retryOf ||
          original.role !== "customer" ||
          work.role !== "customer" ||
          work.pair ||
          requestDigest({ ...work, key: "", retryOf: undefined }) !==
            requestDigest({ ...original, key: "", retryOf: undefined })
        )
          throw Error("INVALID_EXPLICIT_RETRY");
        if (manifest.works.filter((w) => w.retryOf === original.key).length !== 1)
          throw Error("INVALID_EXPLICIT_RETRY");
      }
      if (work.pair) this.pair(manifest, work.pair);
    }
    for (const lane of Object.keys(inferenceProposal.lanes) as BudgetLane[])
      if (manifest.works.filter((w) => w.lane === lane).length > inferenceProposal.lanes[lane].slots)
        throw Error("MANIFEST_LANE_EXHAUSTED");
    if (manifest.packageId) await assertDelegatedBatchAuthority(c, this.store.schemaName(), row, admitting);
    return { row, manifest };
  }
  private pair(manifest: FiniteManifest, key: string) {
    const pair = manifest.works.filter((w) => w.pair === key);
    if (
      pair.length !== 2 ||
      new Set(pair.map((w) => w.role)).size !== 2 ||
      !pair.some((w) => w.role === "factual") ||
      !pair.some((w) => w.role === "challenge") ||
      pair[0]!.lane !== pair[1]!.lane
    )
      throw Error("INVALID_REVIEW_PAIR");
    const binding = (w: FiniteWork) =>
      requestDigest({
        candidate: w.candidateHash,
        case: w.caseHash,
        sources: [...w.sourceHashes].sort(),
        bindings: {
          ...w.bindings,
          sourceFiles: [...w.bindings.sourceFiles].sort((a, b) => a.path.localeCompare(b.path)),
        },
      });
    if (
      binding(pair[0]!) !== binding(pair[1]!) ||
      requestDigest(pair[0]!.request) === requestDigest(pair[1]!.request)
    )
      throw Error("REVIEW_PAIR_BINDING_MISMATCH");
    return pair;
  }
  private input(work: FiniteWork, batchId: string, manifestHash: string): ReserveInput {
    return {
      runKey: `${batchId}:${work.key}`,
      lane: work.lane,
      request: work.request,
      bindingHash: requestDigest({
        candidateHash: work.candidateHash,
        sourceHashes: [...work.sourceHashes].sort(),
        caseHash: work.caseHash,
      }),
      scopeHash: requestDigest({ batchId, manifestHash }),
      proof: null,
      now: Date.now(),
      reservationMode: "whole-context",
      allowResultReuse: !work.retryOf,
    };
  }
  private reservePair(s: BudgetState, pair: FiniteWork[], batchId: string, hash: string) {
    const inputs = pair.map((w) => this.input(w, batchId, hash));
    const existing = inputs.map((i) => s.entries.find((e) => e.runKey === i.runKey));
    if (existing.every(Boolean)) return s;
    if (existing.some(Boolean)) throw Error("PARTIAL_REVIEW_PAIR_RESERVATION");
    return reserveReviewPair(
      s,
      {
        enabled: true,
        ownerApproved: true,
        tokenizationVerified: false,
        managedPriceUpperBoundVerified: true,
        contextCapacityVerified: true,
      },
      inputs[0]!,
      inputs[1]!,
    ).state;
  }
  /**
   * The binding checks read retained files, saved versions and private artifacts, and take pooled
   * connections of their own, so each runs before the ledger transaction that acts on it: none
   * waits while that transaction is open and holds the allocation lock. The works are read from
   * the batch's approved manifest in a read that rolls back; the transaction then reads the batch
   * again and acts only on works exactly as checked (assertChecked).
   */
  private async checkBindings(
    batchId: string,
    pick: (manifest: FiniteManifest, row: { manifest_hash: string }) => FiniteWork[],
  ) {
    const works = await this.store.read(async (c) => {
      const { row, manifest } = await this.batch(c, batchId);
      return pick(manifest, row);
    });
    for (const work of works) await this.recheckBindings(work);
    return new Set(works.map((w) => requestDigest(w)));
  }
  private assertChecked(checked: Set<string>, works: FiniteWork[]) {
    if (works.some((w) => !checked.has(requestDigest(w)))) throw Error("WORK_CHANGED_AFTER_BINDING_CHECK");
  }
  private primaryWork(manifest: FiniteManifest, key: string) {
    const work = manifest.works.find((w) => w.key === key);
    if (!work) throw Error("WORK_NOT_ALLOWLISTED");
    if (work.retryOf) throw Error("RETRY_REQUIRES_PRIMARY_CONTEXT");
    return work;
  }
  private retryWork(manifest: FiniteManifest, rootKey: string | undefined) {
    const work = manifest.works.find((w) => w.retryOf === rootKey);
    if (!work) throw Error("RETRY_NOT_ALLOWLISTED");
    return work;
  }
  private requestedWork(manifest: FiniteManifest, key: string, lane: BudgetLane, request: ManagedRequest) {
    const work = manifest.works.find((w) => w.key === key);
    if (!work || work.lane !== lane || requestDigest(work.request) !== requestDigest(request))
      throw Error("WORK_REQUEST_MISMATCH");
    return work;
  }
  async withWork<T>(batchId: string, key: string, fn: () => Promise<T>) {
    const checked = await this.checkBindings(batchId, (m) => [this.primaryWork(m, key)]);
    const lane = await this.store.mutate("batch-authority-checked", async (s, c) => {
      const { manifest } = await this.batch(c, batchId),
        work = this.primaryWork(manifest, key);
      this.assertChecked(checked, [work]);
      return { state: s, value: work.lane };
    });
    return this.context.run({ batchId, key, rootKey: key, lane }, fn);
  }
  async withPair<T>(batchId: string, pairKey: string, fn: () => Promise<T>) {
    const checked = await this.checkBindings(batchId, (m) => this.pair(m, pairKey));
    const lane = await this.store.mutate("batch-pair-authority-checked", async (s, c) => {
      const { manifest } = await this.batch(c, batchId),
        pair = this.pair(manifest, pairKey);
      this.assertChecked(checked, pair);
      // The actual caller performs its plan/quota preflight first. The first
      // complete() atomically reserves both roles just before dispatch.
      return { state: s, value: pair[0]!.lane };
    });
    return this.context.run({ batchId, key: null, pair: pairKey, lane }, fn);
  }
  async withRole<T>(role: "factual" | "challenge", fn: () => Promise<T>) {
    const ctx = this.current();
    if (!ctx?.pair) throw Error("APPROVED_REVIEW_PAIR_REQUIRED");
    const pairKey = ctx.pair,
      roleWork = (m: FiniteManifest) => this.pair(m, pairKey).find((w) => w.role === role)!;
    const checked = await this.checkBindings(ctx.batchId, (m) => [roleWork(m)]);
    const key = await this.store.mutate("batch-review-role-checked", async (s, c) => {
      const { manifest } = await this.batch(c, ctx.batchId),
        work = roleWork(manifest);
      this.assertChecked(checked, [work]);
      return { state: s, value: work.key };
    });
    return this.context.run({ ...ctx, key }, fn);
  }
  async withAttempt<T>(attempt: number, fn: () => Promise<T>) {
    const ctx = this.current();
    if (!ctx?.key || ctx.lane !== "customer") throw Error("APPROVED_CUSTOMER_WORK_REQUIRED");
    if (attempt === 1) return fn();
    if (attempt !== 2) throw Error("RETRY_NOT_ALLOWLISTED");
    const checked = await this.checkBindings(ctx.batchId, (m) => [this.retryWork(m, ctx.rootKey)]);
    const key = await this.store.mutate("batch-retry-checked", async (s, c) => {
      const { manifest } = await this.batch(c, ctx.batchId),
        work = this.retryWork(manifest, ctx.rootKey);
      // Only a received/settled schema failure can use the separately approved
      // retry. A timeout or unknown provider completion is never retried here.
      if (s.entries.find((e) => e.runKey === `${ctx.batchId}:${ctx.rootKey}`)?.status !== "settled")
        throw Error("RETRY_REQUIRES_SETTLED_PRIOR_ATTEMPT");
      this.assertChecked(checked, [work]);
      return { state: s, value: work.key };
    });
    return this.context.run({ ...ctx, key }, fn);
  }
  async complete(
    lane: BudgetLane,
    request: ManagedRequest,
    options: { timeout: number; maxRetries: 0; onOutbound?: () => void },
  ) {
    const ctx = this.current();
    if (!ctx?.key) throw Error("INFERENCE_BUDGET_DISABLED");
    if (
      ctx.lane !== lane ||
      options.maxRetries !== 0 ||
      !Number.isSafeInteger(options.timeout) ||
      options.timeout < 1 ||
      options.timeout > 45000
    )
      throw Error("INFERENCE_CONTEXT_MISMATCH");
    // The caller must not be able to alter the approved payload while source
    // verification or lazy SDK loading is awaiting another task.
    request = structuredClone(request);
    const workKey = ctx.key;
    // A pair's first admission reserves both of its roles, so both are checked.
    const checked = await this.checkBindings(ctx.batchId, (m) => {
      const work = this.requestedWork(m, workKey, lane, request);
      return work.pair ? this.pair(m, work.pair) : [work];
    });
    const admission = await this.store.mutate<{
      key: string;
      reused: ManagedCompletionResult | null;
      manifestHash: string;
      expiresAt: number;
    }>("batch-reserve-dispatch", async (s, c) => {
      const { row, manifest } = await this.batch(c, ctx.batchId),
        work = this.requestedWork(manifest, workKey, lane, request);
      this.assertChecked(checked, [work]);
      const input = this.input(work, ctx.batchId, row.manifest_hash),
        key = input.runKey;
      const existing = s.entries.find((e) => e.runKey === key);
      if (
        s.entries.some(
          (e) =>
            e.runKey !== key &&
            e.requestHash === requestDigest(request) &&
            e.bindingHash === input.bindingHash &&
            ["dispatched", "unknown"].includes(e.status),
        )
      )
        throw Error("BOUND_ATTEMPT_COMPLETION_UNKNOWN");
      if (existing && !["reserved", "settled"].includes(existing.status))
        throw Error("ATTEMPT_ALREADY_DISPATCHED_OR_UNKNOWN");
      if (existing?.status === "settled") {
        if ((existing.freshUntil ?? 0) <= Date.now()) throw Error("EVIDENCE_EXPIRED_NEW_ATTEMPT_REQUIRED");
        const result = row.results[work.key] as ManagedCompletionResult | undefined;
        if (!result || requestDigest(result) !== existing.resultRef) throw Error("BOUND_RESULT_UNAVAILABLE");
        if (!validReceipt(result, request.model)) throw Error("RETAINED_PROVIDER_RECEIPT_INVALID");
        return {
          state: s,
          value: {
            key,
            reused: result,
            manifestHash: row.manifest_hash,
            expiresAt: inferenceTimestamp(row.expires_at),
          },
        };
      }
      if (!existing) {
        if (work.pair) {
          const pair = this.pair(manifest, work.pair);
          this.assertChecked(checked, pair);
          s = this.reservePair(s, pair, ctx.batchId, row.manifest_hash);
        } else
          s = reserveBudget(
            s,
            {
              enabled: true,
              ownerApproved: true,
              tokenizationVerified: false,
              managedPriceUpperBoundVerified: true,
              contextCapacityVerified: true,
            },
            input,
          ).state;
      }
      // Reuse above is free; every new transport admission below must observe
      // holds established since reservation, including by its sibling role.
      assertFinancialDispatchAllowed(s);
      s = transitionBudget(s, key, "dispatch");
      return {
        state: s,
        value: {
          key,
          reused: null,
          manifestHash: row.manifest_hash,
          expiresAt: inferenceTimestamp(row.expires_at),
        },
      };
    });
    if (admission.reused) return admission.reused;
    try {
      const beforeOutbound = async () => {
        const outbound = await this.checkBindings(ctx.batchId, (m, row) => {
          if (row.manifest_hash !== admission.manifestHash) throw Error("INFERENCE_MANIFEST_CHANGED");
          return [this.requestedWork(m, workKey, lane, request)];
        });
        await this.store.mutate("batch-outbound-revalidated", async (s, c) => {
          const { row, manifest } = await this.batch(c, ctx.batchId);
          if (row.manifest_hash !== admission.manifestHash) throw Error("INFERENCE_MANIFEST_CHANGED");
          const work = this.requestedWork(manifest, workKey, lane, request);
          if (s.entries.find((e) => e.runKey === admission.key)?.status !== "dispatched")
            throw Error("ATTEMPT_ALREADY_DISPATCHED_OR_UNKNOWN");
          this.assertChecked(outbound, [work]);
          assertFinancialDispatchAllowed(s);
          return { state: s, value: undefined };
        });
      };
      // All transports get a last check at invocation. The real SDK adapter
      // repeats it after its asynchronous load, immediately before SDK create.
      await beforeOutbound();
      const result = await this.transport(request, {
        timeout: options.timeout,
        maxRetries: 0,
        beforeOutbound,
        onOutbound: options.onOutbound,
      });
      const accepted = await this.store.mutate("batch-result-settled", async (s, c) => {
        // Expiry/revocation stops new dispatch, but never discards a verified
        // receipt from an attempt admitted before that change.
        const u = result?.usage;
        if (!validReceipt(result, request.model))
          return {
            state: {
              ...transitionBudget(s, admission.key, "unknown"),
              suspended: true,
              unboundedPrior: [
                ...new Set([
                  ...s.unboundedPrior,
                  `${!acceptedInferenceModels.has(result?.model) ? "unknown-priced-response" : "unverified-provider-usage"}:${admission.key}:${requestDigest(
                    { id: result?.id ?? null, model: result?.model ?? null, usage: result?.usage ?? null },
                  )}`,
                ]),
              ],
            },
            value: false,
          };
        const resultHash = requestDigest(result),
          state = settleBudget(s, admission.key, {
            input: u!.prompt_tokens,
            output: u!.completion_tokens,
            responseId: result.id,
            resultRef: resultHash,
            freshUntil: admission.expiresAt,
          });
        if (state.entries.find((e) => e.runKey === admission.key)?.status !== "settled")
          return { state, value: false };
        // Settlement accounts for already admitted exposure, not fresh spending.
        // Revocation/expiry (including parent-package revocation) cannot erase it.
        // The immutable admitted manifest identity fences the retained result.
        // Recorded once, for a key of the admitted manifest (database function).
        const saved = await c.query(
          `SELECT "${this.store.schemaName()}".valo_inference_batch_record_result($1,$2,$3,$4) AS saved`,
          [ctx.batchId, ctx.key, JSON.stringify(result), admission.manifestHash],
        );
        if (saved.rows[0]?.saved !== true) return { state, value: false };
        return { state, value: true };
      });
      if (!accepted) throw Error("PROVIDER_RECEIPT_INVALID_OR_BOUND_EXCEEDED");
      return result;
    } catch (error) {
      await this.store.mutate("batch-attempt-unknown", (s) => {
        const entry = s.entries.find((e) => e.runKey === admission.key);
        return {
          state:
            entry?.status === "settled" || entry?.status === "unknown"
              ? s
              : transitionBudget(s, admission.key, "unknown"),
          value: null,
        };
      });
      throw error;
    }
  }
}
function validReceipt(result: ManagedCompletionResult, requestedModel: string) {
  const u = result?.usage;
  return (
    requestedModel === inferenceProposal.model &&
    typeof result?.model === "string" &&
    acceptedInferenceModels.has(result.model) &&
    typeof result.id === "string" &&
    result.id.trim().length > 0 &&
    !!u &&
    [u.prompt_tokens, u.completion_tokens, u.total_tokens].every((x) => Number.isSafeInteger(x) && x >= 0) &&
    Number.isSafeInteger(u.prompt_tokens + u.completion_tokens) &&
    u.total_tokens === u.prompt_tokens + u.completion_tokens
  );
}
