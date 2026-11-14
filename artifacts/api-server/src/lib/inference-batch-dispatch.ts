import {AsyncLocalStorage} from "node:async_hooks";
import {InferenceBudgetStore} from "./inference-budget-store";
import {inferenceProposal,requestDigest,reserveBudget,reserveReviewPair,transitionBudget,settleBudget,
  type BudgetLane,type ReserveInput} from "./inference-budget";
import type {ManagedCompletionResult,ManagedRequest} from "./managed-inference";
export type FiniteWork={key:string;lane:BudgetLane;role:"factual"|"challenge"|"customer";
  pair:string|null;candidateHash:string;sourceHashes:string[];caseHash:string;request:ManagedRequest;
  bindings:{candidateVersionId:string|null;corpus:"editorial"|"checker"|"customer-ai"|null;caseId:string|null;
    sourceFiles:{path:string;sha256:string}[]}};
export type FiniteManifest={version:1;policyVersion:string;works:FiniteWork[]};
export type CompletionTransport=(request:ManagedRequest,options:{timeout:number;maxRetries:0})=>Promise<ManagedCompletionResult>;
type Context={batchId:string;key:string;lane:BudgetLane};
/** No HTTP configuration or caller-provided approval assertions. Authority is
 * an enabled, expiring durable approval of the exact stored work manifest.
 * Production uses the fixed public ledger; controlled tests inject an isolated
 * schema and a no-network transport into this same implementation. */
export class FiniteInferenceDispatcher{
  private context=new AsyncLocalStorage<Context>();
  constructor(private store:InferenceBudgetStore,private transport:CompletionTransport,
    private recheckBindings:(work:FiniteWork)=>Promise<void>){}
  current(){return this.context.getStore();}
  private async batch(c:import("pg").PoolClient,id:string){
    const r=await c.query(`SELECT * FROM "${this.storeSchema()}".valo_inference_batches WHERE id=$1 FOR SHARE`,[id]);
    const row=r.rows[0];
    if(!row||!row.enabled||!row.approved_by||!row.approval_reference||!row.approved_at)
      throw Error("INFERENCE_BATCH_NOT_AUTHORIZED");
    if(Date.parse(row.expires_at)<=Date.now()||Date.parse(row.approved_at)>Date.now())throw Error("INFERENCE_BATCH_EXPIRED");
    const manifest=row.manifest as FiniteManifest;
    if(row.policy_hash!==requestDigest(inferenceProposal)||row.manifest_hash!==requestDigest(manifest)||
      manifest.version!==1||manifest.policyVersion!==inferenceProposal.priceVersion||!Array.isArray(manifest.works)||
      manifest.works.length>458)throw Error("INFERENCE_MANIFEST_INVALID");
    const keys=new Set<string>();
    for(const work of manifest.works){
      if(!work.key||keys.has(work.key)||!inferenceProposal.lanes[work.lane]||
        ![work.candidateHash,work.caseHash,...work.sourceHashes].every(h=>/^[a-f0-9]{64}$/.test(h))||
        !["factual","challenge","customer"].includes(work.role)||
        (work.lane==="customer")!==(work.role==="customer")||
        work.lane==="checker_challenge"&&work.role!=="challenge"||
        ["publication","editorial_evaluation"].includes(work.lane)&&!work.pair)
        throw Error("INFERENCE_MANIFEST_INVALID");
      keys.add(work.key);
    }
    for(const lane of Object.keys(inferenceProposal.lanes) as BudgetLane[])
      if(manifest.works.filter(w=>w.lane===lane).length>inferenceProposal.lanes[lane].slots)throw Error("MANIFEST_LANE_EXHAUSTED");
    return{row,manifest};
  }
  private storeSchema(){return this.store.schemaName();}
  async withWork<T>(batchId:string,key:string,fn:()=>Promise<T>){
    const lane=await this.store.mutate("batch-authority-checked",async(s,c)=>{
      const {manifest}=await this.batch(c,batchId),work=manifest.works.find(w=>w.key===key);
      if(!work)throw Error("WORK_NOT_ALLOWLISTED");
      await this.recheckBindings(work);
      return{state:s,value:work.lane};
    });
    return this.context.run({batchId,key,lane},fn);
  }
  async complete(lane:BudgetLane,request:ManagedRequest,options:{timeout:number;maxRetries:0;onOutbound?:()=>void}){
    const ctx=this.current();if(!ctx)throw Error("INFERENCE_BUDGET_DISABLED");
    if(ctx.lane!==lane||options.maxRetries!==0||!Number.isSafeInteger(options.timeout)||options.timeout<1||options.timeout>45000)
      throw Error("INFERENCE_CONTEXT_MISMATCH");
    const admission=await this.store.mutate<{key:string;reused:ManagedCompletionResult|null}>("batch-reserve-dispatch",async(s,c)=>{
      const {row,manifest}=await this.batch(c,ctx.batchId),work=manifest.works.find(w=>w.key===ctx.key);
      if(!work||work.lane!==lane||requestDigest(work.request)!==requestDigest(request))throw Error("WORK_REQUEST_MISMATCH");
      await this.recheckBindings(work);
      const scopeHash=requestDigest({batchId:ctx.batchId,manifestHash:row.manifest_hash});
      const input=(w:FiniteWork):ReserveInput=>({runKey:`${ctx.batchId}:${w.key}`,lane:w.lane,request:w.request,
        bindingHash:requestDigest({candidateHash:w.candidateHash,sourceHashes:w.sourceHashes,caseHash:w.caseHash}),
        scopeHash,proof:null,now:Date.now(),reservationMode:"whole-context"});
      const key=input(work).runKey;
      const existing=s.entries.find(e=>e.runKey===key);
      if(existing&&!["reserved","settled"].includes(existing.status))throw Error("ATTEMPT_ALREADY_DISPATCHED_OR_UNKNOWN");
      if(existing?.status==="settled"){
        if((existing.freshUntil??0)<=Date.now())throw Error("EVIDENCE_EXPIRED_NEW_ATTEMPT_REQUIRED");
        const result=row.results[work.key] as ManagedCompletionResult|undefined;
        if(!result||requestDigest(result)!==existing.resultRef)throw Error("BOUND_RESULT_UNAVAILABLE");
        return{state:s,value:{key,reused:result}};
      }
      if(!existing){
        const authority={enabled:true,ownerApproved:true,tokenizationVerified:false,
          managedPriceUpperBoundVerified:true,contextCapacityVerified:true};
        // The booleans here are internal derivation AFTER durable authorization;
        // no caller controls them. The approved policy includes the price bound.
        if(work.pair){
          const pair=manifest.works.filter(w=>w.pair===work.pair);
          if(pair.length!==2||new Set(pair.map(w=>w.role)).size!==2||
            !pair.some(w=>w.role==="factual")||!pair.some(w=>w.role==="challenge"))throw Error("INVALID_REVIEW_PAIR");
          for(const w of pair)await this.recheckBindings(w);
          s=reserveReviewPair(s,authority,input(pair[0]!),input(pair[1]!)).state;
        }else s=reserveBudget(s,authority,input(work)).state;
      }
      s=transitionBudget(s,key,"dispatch");
      return{state:s,value:{key,reused:null}};
    });
    if(admission.reused)return admission.reused;
    try{
      options.onOutbound?.();
      const result=await this.transport(request,{timeout:options.timeout,maxRetries:0});
      await this.store.mutate("batch-result-settled",async(s,c)=>{
        const {row}=await this.batch(c,ctx.batchId);
        const u=result.usage;
        if(!result.id||!result.model.startsWith(inferenceProposal.model)||!u||
          ![u.prompt_tokens,u.completion_tokens,u.total_tokens].every(x=>Number.isSafeInteger(x)&&x>=0)||
          u.total_tokens!==u.prompt_tokens+u.completion_tokens)
          return{state:transitionBudget(s,admission.key,"unknown"),value:null};
        const resultHash=requestDigest(result);
        const state=settleBudget(s,admission.key,{input:u.prompt_tokens,output:u.completion_tokens,
          responseId:result.id,resultRef:resultHash,freshUntil:Date.parse(row.expires_at)});
        await c.query(`UPDATE "${this.storeSchema()}".valo_inference_batches
          SET results=jsonb_set(results,ARRAY[$2],$3::jsonb) WHERE id=$1`,
          [ctx.batchId,ctx.key,JSON.stringify(result)]);
        return{state,value:null};
      });
      return result;
    }catch(error){
      await this.store.mutate("batch-attempt-unknown",s=>({state:transitionBudget(s,admission.key,"unknown"),value:null}));
      throw error;
    }
  }
}
