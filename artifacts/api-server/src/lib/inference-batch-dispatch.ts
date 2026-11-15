import {AsyncLocalStorage} from "node:async_hooks";
import {assertFinancialDispatchAllowed} from "./inference-budget";
import {InferenceBudgetStore} from "./inference-budget-store";
import {inferenceProposal,additionalInferenceAllocation,acceptedInferenceModels,inferenceTimestamp,requestDigest,reserveBudget,reserveReviewPair,
  transitionBudget,settleBudget,type BudgetLane,type BudgetState,type ReserveInput} from "./inference-budget";
import type {ManagedCompletionResult,ManagedRequest} from "./managed-inference";
import {assertDelegatedBatchAuthority} from "./inference-allocation-package";
import {assertFiniteWorkShape} from "./inference-work-shape";
import {assertManagedRatePolicy} from "./inference-price-evidence";
export type FiniteWork={key:string;lane:BudgetLane;role:"factual"|"challenge"|"customer";
  pair:string|null;retryOf?:string;candidateHash:string;sourceHashes:string[];caseHash:string;request:ManagedRequest;
  bindings:{candidateVersionId:string|null;corpus:"editorial"|"checker"|"customer-ai"|null;caseId:string|null;
    sourceFiles:{path:string;sha256:string}[];historicalCutoff?:string;
    operationalPlan?:{id:string;hash:string;extension:"json"}}};
export type FiniteManifest={version:2;policyVersion:string;preparedAt:string;
  allocation:typeof additionalInferenceAllocation;packageId?:string;works:FiniteWork[]};
export type CompletionTransport=(request:ManagedRequest,options:{timeout:number;maxRetries:0;onOutbound?:()=>void})=>Promise<ManagedCompletionResult>;
type Context={batchId:string;key:string|null;lane:BudgetLane;pair?:string;rootKey?:string};
/** Approval is a durable, expiring authorization of this exact immutable
 * roster. Every batch shares the same additional allocation; legacy charges
 * remain in their own unchanged ledger. No HTTP input can create authority. */
export class FiniteInferenceDispatcher{
  private context=new AsyncLocalStorage<Context>();
  constructor(private store:InferenceBudgetStore,private transport:CompletionTransport,
    private recheckBindings:(work:FiniteWork)=>Promise<void>){}
  current(){return this.context.getStore();}
  private async batch(c:import("pg").PoolClient,id:string,admitting=true){
    assertManagedRatePolicy(inferenceProposal);
    const r=await c.query(`SELECT * FROM "${this.store.schemaName()}".valo_inference_batches WHERE id=$1 FOR SHARE`,[id]);
    const row=r.rows[0];
    if(!row||!row.approved_by||!row.approval_reference||!row.approved_at||admitting&&!row.enabled)
      throw Error("INFERENCE_BATCH_NOT_AUTHORIZED");
    const now=Date.now(),approvedAt=inferenceTimestamp(row.approved_at),expiresAt=inferenceTimestamp(row.expires_at);
    if(!Number.isFinite(approvedAt)||!Number.isFinite(expiresAt)||approvedAt>now||
      admitting&&expiresAt<=now)throw Error("INFERENCE_BATCH_EXPIRED");
    const manifest=row.manifest as FiniteManifest;
    if(row.policy_hash!==requestDigest(inferenceProposal)||row.manifest_hash!==requestDigest(manifest)||
      manifest.version!==2||manifest.policyVersion!==inferenceProposal.priceVersion||
      requestDigest(manifest.allocation)!==requestDigest(additionalInferenceAllocation)||
      this.store.allocationId()!==additionalInferenceAllocation.id||
      !Number.isFinite(Date.parse(manifest.preparedAt))||Date.parse(manifest.preparedAt)>approvedAt||
      !Array.isArray(manifest.works)||manifest.works.length===0||manifest.works.length>458)
      throw Error("INFERENCE_MANIFEST_INVALID");
    const keys=new Set<string>();
    for(const work of manifest.works){
      assertFiniteWorkShape(work);
      if(!work.key||keys.has(work.key)||!inferenceProposal.lanes[work.lane]||
        ![work.candidateHash,work.caseHash,...work.sourceHashes].every(h=>/^[a-f0-9]{64}$/.test(h))||
        !["factual","challenge","customer"].includes(work.role)||
        (work.lane==="customer")!==(work.role==="customer")||
        work.lane==="checker_challenge"&&work.role!=="challenge"||
        ["publication","editorial_evaluation"].includes(work.lane)&&!work.pair)
        throw Error("INFERENCE_MANIFEST_INVALID");
      keys.add(work.key);
    }
    for(const work of manifest.works){
      if(work.retryOf){
        const original=manifest.works.find(w=>w.key===work.retryOf);
        if(!original||original.retryOf||original.role!=="customer"||work.role!=="customer"||work.pair||
          requestDigest({...work,key:"",retryOf:undefined})!==requestDigest({...original,key:"",retryOf:undefined}))
          throw Error("INVALID_EXPLICIT_RETRY");
        if(manifest.works.filter(w=>w.retryOf===original.key).length!==1)throw Error("INVALID_EXPLICIT_RETRY");
      }
      if(work.pair)this.pair(manifest,work.pair);
    }
    for(const lane of Object.keys(inferenceProposal.lanes) as BudgetLane[])
      if(manifest.works.filter(w=>w.lane===lane).length>inferenceProposal.lanes[lane].slots)throw Error("MANIFEST_LANE_EXHAUSTED");
    if(manifest.packageId)await assertDelegatedBatchAuthority(c,this.store.schemaName(),row,admitting);
    return{row,manifest};
  }
  private pair(manifest:FiniteManifest,key:string){
    const pair=manifest.works.filter(w=>w.pair===key);
    if(pair.length!==2||new Set(pair.map(w=>w.role)).size!==2||
      !pair.some(w=>w.role==="factual")||!pair.some(w=>w.role==="challenge")||pair[0]!.lane!==pair[1]!.lane)
      throw Error("INVALID_REVIEW_PAIR");
    const binding=(w:FiniteWork)=>requestDigest({candidate:w.candidateHash,case:w.caseHash,
      sources:[...w.sourceHashes].sort(),bindings:{...w.bindings,sourceFiles:[...w.bindings.sourceFiles].sort((a,b)=>a.path.localeCompare(b.path))}});
    if(binding(pair[0]!)!==binding(pair[1]!)||requestDigest(pair[0]!.request)===requestDigest(pair[1]!.request))
      throw Error("REVIEW_PAIR_BINDING_MISMATCH");
    return pair;
  }
  private input(work:FiniteWork,batchId:string,manifestHash:string):ReserveInput{
    return{runKey:`${batchId}:${work.key}`,lane:work.lane,request:work.request,
      bindingHash:requestDigest({candidateHash:work.candidateHash,sourceHashes:[...work.sourceHashes].sort(),caseHash:work.caseHash}),
      scopeHash:requestDigest({batchId,manifestHash}),proof:null,now:Date.now(),reservationMode:"whole-context",
      allowResultReuse:!work.retryOf};
  }
  private reservePair(s:BudgetState,pair:FiniteWork[],batchId:string,hash:string){
    const inputs=pair.map(w=>this.input(w,batchId,hash));
    const existing=inputs.map(i=>s.entries.find(e=>e.runKey===i.runKey));
    if(existing.every(Boolean))return s;
    if(existing.some(Boolean))throw Error("PARTIAL_REVIEW_PAIR_RESERVATION");
    return reserveReviewPair(s,{enabled:true,ownerApproved:true,tokenizationVerified:false,
      managedPriceUpperBoundVerified:true,contextCapacityVerified:true},inputs[0]!,inputs[1]!).state;
  }
  async withWork<T>(batchId:string,key:string,fn:()=>Promise<T>){
    const lane=await this.store.mutate("batch-authority-checked",async(s,c)=>{
      const {manifest}=await this.batch(c,batchId),work=manifest.works.find(w=>w.key===key);
      if(!work)throw Error("WORK_NOT_ALLOWLISTED");
      if(work.retryOf)throw Error("RETRY_REQUIRES_PRIMARY_CONTEXT");
      await this.recheckBindings(work);
      return{state:s,value:work.lane};
    });
    return this.context.run({batchId,key,rootKey:key,lane},fn);
  }
  async withPair<T>(batchId:string,pairKey:string,fn:()=>Promise<T>){
    const lane=await this.store.mutate("batch-pair-authority-checked",async(s,c)=>{
      const {manifest}=await this.batch(c,batchId),pair=this.pair(manifest,pairKey);
      for(const work of pair)await this.recheckBindings(work);
      // The actual caller performs its plan/quota preflight first. The first
      // complete() atomically reserves both roles just before dispatch.
      return{state:s,value:pair[0]!.lane};
    });
    return this.context.run({batchId,key:null,pair:pairKey,lane},fn);
  }
  async withRole<T>(role:"factual"|"challenge",fn:()=>Promise<T>){
    const ctx=this.current();if(!ctx?.pair)throw Error("APPROVED_REVIEW_PAIR_REQUIRED");
    const key=await this.store.mutate("batch-review-role-checked",async(s,c)=>{
      const {manifest}=await this.batch(c,ctx.batchId),work=this.pair(manifest,ctx.pair!).find(w=>w.role===role)!;
      await this.recheckBindings(work);return{state:s,value:work.key};
    });
    return this.context.run({...ctx,key},fn);
  }
  async withAttempt<T>(attempt:number,fn:()=>Promise<T>){
    const ctx=this.current();if(!ctx?.key||ctx.lane!=="customer")throw Error("APPROVED_CUSTOMER_WORK_REQUIRED");
    if(attempt===1)return fn();
    if(attempt!==2)throw Error("RETRY_NOT_ALLOWLISTED");
    const key=await this.store.mutate("batch-retry-checked",async(s,c)=>{
      const {manifest}=await this.batch(c,ctx.batchId),work=manifest.works.find(w=>w.retryOf===ctx.rootKey);
      if(!work)throw Error("RETRY_NOT_ALLOWLISTED");
      // Only a received/settled schema failure can use the separately approved
      // retry. A timeout or unknown provider completion is never retried here.
      if(s.entries.find(e=>e.runKey===`${ctx.batchId}:${ctx.rootKey}`)?.status!=="settled")
        throw Error("RETRY_REQUIRES_SETTLED_PRIOR_ATTEMPT");
      await this.recheckBindings(work);return{state:s,value:work.key};
    });
    return this.context.run({...ctx,key},fn);
  }
  async complete(lane:BudgetLane,request:ManagedRequest,options:{timeout:number;maxRetries:0;onOutbound?:()=>void}){
    const ctx=this.current();if(!ctx?.key)throw Error("INFERENCE_BUDGET_DISABLED");
    if(ctx.lane!==lane||options.maxRetries!==0||!Number.isSafeInteger(options.timeout)||options.timeout<1||options.timeout>45000)
      throw Error("INFERENCE_CONTEXT_MISMATCH");
    const admission=await this.store.mutate<{key:string;reused:ManagedCompletionResult|null}>("batch-reserve-dispatch",async(s,c)=>{
      const {row,manifest}=await this.batch(c,ctx.batchId),work=manifest.works.find(w=>w.key===ctx.key);
      if(!work||work.lane!==lane||requestDigest(work.request)!==requestDigest(request))throw Error("WORK_REQUEST_MISMATCH");
      await this.recheckBindings(work);
      const input=this.input(work,ctx.batchId,row.manifest_hash),key=input.runKey;
      const existing=s.entries.find(e=>e.runKey===key);
      if(s.entries.some(e=>e.runKey!==key&&e.requestHash===requestDigest(request)&&e.bindingHash===input.bindingHash&&
        ["dispatched","unknown"].includes(e.status)))throw Error("BOUND_ATTEMPT_COMPLETION_UNKNOWN");
      if(existing&&!["reserved","settled"].includes(existing.status))throw Error("ATTEMPT_ALREADY_DISPATCHED_OR_UNKNOWN");
      if(existing?.status==="settled"){
        if((existing.freshUntil??0)<=Date.now())throw Error("EVIDENCE_EXPIRED_NEW_ATTEMPT_REQUIRED");
        const result=row.results[work.key] as ManagedCompletionResult|undefined;
        if(!result||requestDigest(result)!==existing.resultRef)throw Error("BOUND_RESULT_UNAVAILABLE");
        return{state:s,value:{key,reused:result}};
      }
      if(!existing){
        if(work.pair){
          const pair=this.pair(manifest,work.pair);for(const w of pair)await this.recheckBindings(w);
          s=this.reservePair(s,pair,ctx.batchId,row.manifest_hash);
        }else s=reserveBudget(s,{enabled:true,ownerApproved:true,tokenizationVerified:false,
          managedPriceUpperBoundVerified:true,contextCapacityVerified:true},input).state;
      }
      // Reuse above is free; every new transport admission below must observe
      // holds established since reservation, including by its sibling role.
      assertFinancialDispatchAllowed(s);
      s=transitionBudget(s,key,"dispatch");
      return{state:s,value:{key,reused:null}};
    });
    if(admission.reused)return admission.reused;
    try{
      const result=await this.transport(request,{timeout:options.timeout,maxRetries:0,onOutbound:options.onOutbound});
      const accepted=await this.store.mutate("batch-result-settled",async(s,c)=>{
        // Expiry/revocation stops new dispatch, but never discards a verified
        // receipt from an attempt admitted before that change.
        const {row}=await this.batch(c,ctx.batchId,false),u=result.usage;
        if(!result.id||!acceptedInferenceModels.has(result.model)||!u||
          ![u.prompt_tokens,u.completion_tokens,u.total_tokens].every(x=>Number.isSafeInteger(x)&&x>=0)||
          u.total_tokens!==u.prompt_tokens+u.completion_tokens)
          return{state:{...transitionBudget(s,admission.key,"unknown"),
            ...(!acceptedInferenceModels.has(result.model)?{suspended:true,
              unboundedPrior:[...new Set([...s.unboundedPrior,`unknown-priced-response:${admission.key}:${requestDigest({id:result.id,model:result.model})}`])]}:{})},value:false};
        const resultHash=requestDigest(result),state=settleBudget(s,admission.key,{input:u.prompt_tokens,output:u.completion_tokens,
          responseId:result.id,resultRef:resultHash,freshUntil:inferenceTimestamp(row.expires_at)});
        if(state.entries.find(e=>e.runKey===admission.key)?.status!=="settled")return{state,value:false};
        await c.query(`UPDATE "${this.store.schemaName()}".valo_inference_batches
          SET results=jsonb_set(results,ARRAY[$2],$3::jsonb) WHERE id=$1`,[ctx.batchId,ctx.key,JSON.stringify(result)]);
        return{state,value:true};
      });
      if(!accepted)throw Error("PROVIDER_RECEIPT_INVALID_OR_BOUND_EXCEEDED");
      return result;
    }catch(error){
      await this.store.mutate("batch-attempt-unknown",s=>{
        const entry=s.entries.find(e=>e.runKey===admission.key);
        return{state:entry?.status==="settled"||entry?.status==="unknown"?s:transitionBudget(s,admission.key,"unknown"),value:null};
      });
      throw error;
    }
  }
}
