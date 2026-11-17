import {
  inferenceProposal,
  additionalInferenceAllocation,
  requestDigest,
  validateBudgetState,
  type BudgetState,
} from "./inference-budget";
import { inspectInferenceBudget } from "./inference-budget-inspection";
/** One locked row covers every lane of this named allocation, not all historic
 * project spending. No caller-facing approval endpoint is provided. */
export class InferenceBudgetStore {
  schemaName() {
    return this.schema;
  }
  allocationId() {
    return this.scope === "additional-new" ? additionalInferenceAllocation.id : inferenceProposal.id;
  }
  constructor(
    private pool: Pick<import("pg").Pool, "connect">,
    private schema = "public",
    private scope: "legacy" | "additional-new" = "legacy",
  ) {
    if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw Error("INVALID_LEDGER_SCHEMA");
  }
  /** No initialization, policy adoption, approvals, reservations or audit writes.
   * One PostgreSQL snapshot binds the timestamp, policy, version and state. */
  async inspect() {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const result = await c.query(
        `SELECT clock.observed_at,b.id,b.version,b.policy_hash,b.state
        FROM (SELECT CURRENT_TIMESTAMP AS observed_at) clock
        LEFT JOIN "${this.schema}".valo_inference_budgets b ON b.id=$1`,
        [this.allocationId()],
      );
      const r = result.rows[0];
      if (!r) throw Error("BUDGET_INSPECTION_UNAVAILABLE");
      const value = inspectInferenceBudget({
        scope: this.scope,
        observedAt: new Date(r.observed_at).toISOString(),
        row: r.id ? { version: r.version, policyHash: r.policy_hash, state: r.state } : null,
      });
      await c.query("COMMIT");
      return value;
    } catch (error) {
      await c.query("ROLLBACK");
      throw error;
    } finally {
      c.release();
    }
  }
  /**
   * The ledger is changed only through its database functions, which run as their owner:
   * customer requests hold no write privilege on it, and the commit refuses any change a
   * customer AI attempt does not make (migration 20261117125444_workspace_row_security).
   */
  async mutate<T>(
    action: string,
    fn: (
      s: BudgetState,
      c: import("pg").PoolClient,
    ) => { state: BudgetState; value: T } | Promise<{ state: BudgetState; value: T }>,
  ) {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      // Creates the allocation the first time. Only the newly scoped allocation starts
      // reconciled; the legacy row and its events/unknown liabilities are never overwritten.
      const selected = await c.query(
        `SELECT state,version,policy_hash FROM "${this.schema}".valo_inference_budget_lock($1,$2)`,
        [this.allocationId(), requestDigest(inferenceProposal)],
      );
      const row = selected.rows[0];
      if (row.policy_hash !== requestDigest(inferenceProposal))
        throw Error("BUDGET_POLICY_CHANGED_REVIEW_REQUIRED");
      const before = row.state as BudgetState;
      validateBudgetState(before);
      const result = await fn(structuredClone(before), c);
      validateBudgetState(result.state);
      await c.query(`SELECT "${this.schema}".valo_inference_budget_commit($1,$2,$3,$4,$5,$6)`, [
        this.allocationId(),
        row.version,
        JSON.stringify(result.state),
        action,
        requestDigest(before),
        requestDigest(result.state),
      ]);
      await c.query("COMMIT");
      return result.value;
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  /** Explicit version adoption preserves every usage record and unknown
   * liability; it does not approve or enable any batch. */
  async adoptPolicy(expectedOldHash: string, evidenceReference: string) {
    if (!/^[a-f0-9]{64}$/.test(expectedOldHash) || evidenceReference.length < 12)
      throw Error("POLICY_EVIDENCE_REQUIRED");
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const table = `"${this.schema}".valo_inference_budgets`;
      const r = await c.query(`SELECT * FROM ${table} WHERE id=$1 FOR UPDATE`, [this.allocationId()]);
      const row = r.rows[0];
      if (!row || row.policy_hash !== expectedOldHash) throw Error("POLICY_ADOPTION_CONFLICT");
      validateBudgetState(row.state);
      const current = requestDigest(inferenceProposal);
      if (current !== expectedOldHash) {
        await c.query(`UPDATE ${table} SET policy_hash=$2,version=version+1,updated_at=now() WHERE id=$1`, [
          this.allocationId(),
          current,
        ]);
        await c.query(
          `INSERT INTO "${this.schema}".valo_inference_budget_events
          (budget_id,version,action,before_hash,after_hash) VALUES($1,$2,$3,$4,$4)`,
          [
            this.allocationId(),
            row.version + 1,
            `policy-adopted:${requestDigest({ expectedOldHash, current, evidenceReference })}`,
            requestDigest(row.state),
          ],
        );
      }
      await c.query("COMMIT");
      return {
        policyHash: current,
        stateHash: requestDigest(row.state),
        ownerApproved: false,
        enabled: false,
      };
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
}
