import {emptyBudget,inferenceProposal,requestDigest,validateBudgetState,type BudgetState} from "./inference-budget";
/** One locked global row covers every lane; no sum-then-insert race.
 * No caller-facing endpoint and no enabled authority are provided. */
export class InferenceBudgetStore{
  schemaName(){return this.schema;}
  constructor(private pool:Pick<typeof import("@workspace/db").pool,"connect">,private schema="public"){
    if(!/^[a-z_][a-z0-9_]*$/.test(schema))throw Error("INVALID_LEDGER_SCHEMA");
  }
  async mutate<T>(action:string,fn:(s:BudgetState,c:import("pg").PoolClient)=>{state:BudgetState;value:T}|Promise<{state:BudgetState;value:T}>){
    const c=await this.pool.connect();
    const table=`"${this.schema}".valo_inference_budgets`,events=`"${this.schema}".valo_inference_budget_events`;
    try{
      await c.query("BEGIN");
      await c.query(`INSERT INTO ${table}(id,policy_hash,state) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING`,
        [inferenceProposal.id,requestDigest(inferenceProposal),JSON.stringify(emptyBudget())]);
      const selected=await c.query(`SELECT state,version,policy_hash FROM ${table} WHERE id=$1 FOR UPDATE`,[inferenceProposal.id]);
      const row=selected.rows[0];
      if(row.policy_hash!==requestDigest(inferenceProposal))throw Error("BUDGET_POLICY_CHANGED_REVIEW_REQUIRED");
      const before=row.state as BudgetState;
      validateBudgetState(before);
      const result=await fn(structuredClone(before),c);
      validateBudgetState(result.state);
      const version=row.version+1,beforeHash=requestDigest(before),afterHash=requestDigest(result.state);
      await c.query(`UPDATE ${table} SET state=$2,version=$3,updated_at=now() WHERE id=$1`,
        [inferenceProposal.id,JSON.stringify(result.state),version]);
      await c.query(`INSERT INTO ${events}(budget_id,version,action,before_hash,after_hash) VALUES($1,$2,$3,$4,$5)`,
        [inferenceProposal.id,version,action,beforeHash,afterHash]);
      await c.query("COMMIT");return result.value;
    }catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}
  }
  /** Explicit version adoption preserves every usage record and unknown
   * liability; it does not approve or enable any batch. */
  async adoptPolicy(expectedOldHash:string,evidenceReference:string){
    if(!/^[a-f0-9]{64}$/.test(expectedOldHash)||evidenceReference.length<12)throw Error("POLICY_EVIDENCE_REQUIRED");
    const c=await this.pool.connect();
    try{
      await c.query("BEGIN");
      const table=`"${this.schema}".valo_inference_budgets`;
      const r=await c.query(`SELECT * FROM ${table} WHERE id=$1 FOR UPDATE`,[inferenceProposal.id]);
      const row=r.rows[0];if(!row||row.policy_hash!==expectedOldHash)throw Error("POLICY_ADOPTION_CONFLICT");
      validateBudgetState(row.state);
      const current=requestDigest(inferenceProposal);
      if(current!==expectedOldHash){
        await c.query(`UPDATE ${table} SET policy_hash=$2,version=version+1,updated_at=now() WHERE id=$1`,[inferenceProposal.id,current]);
        await c.query(`INSERT INTO "${this.schema}".valo_inference_budget_events
          (budget_id,version,action,before_hash,after_hash) VALUES($1,$2,$3,$4,$4)`,
          [inferenceProposal.id,row.version+1,`policy-adopted:${requestDigest({expectedOldHash,current,evidenceReference})}`,requestDigest(row.state)]);
      }
      await c.query("COMMIT");
      return{policyHash:current,stateHash:requestDigest(row.state),ownerApproved:false,enabled:false};
    }catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}
  }
}
