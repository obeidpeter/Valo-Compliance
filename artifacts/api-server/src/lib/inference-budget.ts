import {createHash} from "node:crypto";
export type BudgetLane="publication"|"editorial_evaluation"|"checker_challenge"|"customer";
export const inferenceProposal={
  id:"valo-managed-inference-30-v1",model:"gpt-5.4-mini",enabled:false,ownerApproved:false,
  priceVersion:"public-gpt-5.4-mini-2026-11-14",capNanoUsd:"30000000000",
  inputNanoUsdPerToken:750,outputNanoUsdPerToken:4500,upliftBps:1000,
  lanes:{publication:{slots:216,input:32000,output:8192},editorial_evaluation:{slots:68,input:32000,output:8192},
    checker_challenge:{slots:80,input:32000,output:8192},customer:{slots:94,input:4096,output:8192}},
  tokenizationVerified:false,managedPriceUpperBoundVerified:false,
} as const;
export const requestDigest=(x:unknown):string=>{
  const canonical=(v:unknown):unknown=>Array.isArray(v)?v.map(canonical):v&&typeof v==="object"?
    Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,x])=>[k,canonical(x)])):v;
  return createHash("sha256").update(JSON.stringify(canonical(x))).digest("hex");
};
export function tokenCost(input:number,output:number,upliftBps:number=1000){
  if(![input,output,upliftBps].every(n=>Number.isSafeInteger(n)&&n>=0)||upliftBps>10000)throw Error("INVALID_COST_INPUT");
  const base=BigInt(input)*750n+BigInt(output)*4500n;
  return(base*BigInt(10000+upliftBps)+9999n)/10000n;
}
export function proposalTotals(){
  const lanes=Object.entries(inferenceProposal.lanes).map(([lane,l])=>({lane,slots:l.slots,
    baseNanoUsd:(tokenCost(l.input,l.output,0)*BigInt(l.slots)).toString(),
    upliftNanoUsd:(tokenCost(l.input,l.output)*BigInt(l.slots)).toString()}));
  return{lanes,baseNanoUsd:lanes.reduce((s,l)=>s+BigInt(l.baseNanoUsd),0n).toString(),
    upliftNanoUsd:lanes.reduce((s,l)=>s+BigInt(l.upliftNanoUsd),0n).toString()};
}
export type BudgetEntry={runKey:string;lane:BudgetLane;requestHash:string;bindingHash:string;scopeHash:string;
  inputBound:number;outputBound:number;reserved:string;charged:string;status:"reserved"|"dispatched"|"unknown"|"settled"|"cancelled";
  resultRef?:string;freshUntil?:number;responseId?:string;usageHash?:string;legacy?:boolean};
export type BudgetState={version:1;entries:BudgetEntry[];priorUseReconciled:boolean;unboundedPrior:string[];suspended:boolean};
export const emptyBudget=():BudgetState=>({version:1,entries:[],priorUseReconciled:false,unboundedPrior:[],suspended:false});
export type BudgetAuthority={enabled:boolean;ownerApproved:boolean;tokenizationVerified:boolean;managedPriceUpperBoundVerified:boolean};
export type FullRequestProof={requestHash:string;model:string;inputTokens:number;method:"provider-attested-full-request";
  attestationHash:string;includesInstructionsAndSchema:true};
export type ReserveInput={runKey:string;lane:BudgetLane;request:unknown;bindingHash:string;scopeHash:string;
  proof:FullRequestProof|null;now:number};
export function budgetUsed(s:BudgetState){
  validateBudgetState(s);
  return s.entries.reduce((sum,e)=>sum+BigInt(e.status==="settled"?e.charged:e.status==="cancelled"?"0":e.reserved),0n);
}
export function validateBudgetState(s:BudgetState){
  if(s.version!==1||!Array.isArray(s.entries)||!Array.isArray(s.unboundedPrior)||
    typeof s.priorUseReconciled!=="boolean"||typeof s.suspended!=="boolean")throw Error("INVALID_BUDGET_STATE");
  const keys=new Set<string>();
  for(const e of s.entries){
    if(!e.runKey||keys.has(e.runKey)||!inferenceProposal.lanes[e.lane]||
      !/^\d+$/.test(e.reserved)||!/^\d+$/.test(e.charged)||
      !["reserved","dispatched","unknown","settled","cancelled"].includes(e.status))throw Error("INVALID_LEDGER_ENTRY");
    keys.add(e.runKey);
    if(!e.legacy&&["reserved","dispatched","unknown"].includes(e.status)&&
      BigInt(e.reserved)<tokenCost(inferenceProposal.lanes[e.lane].input,inferenceProposal.lanes[e.lane].output))
      throw Error("UNDERFUNDED_RESERVATION");
  }
}
/** Pure admission logic. Authority/proof are server-owned, never browser input.
 * The production adapter currently supplies ONLY the disabled authority and no
 * attestation. Enabled authorities in tests are explicitly synthetic controls. */
export function reserveBudget(s:BudgetState,a:BudgetAuthority,i:ReserveInput){
  validateBudgetState(s);
  const h=requestDigest(i.request);
  const same=(e:BudgetEntry)=>e.requestHash===h&&e.bindingHash===i.bindingHash&&e.scopeHash===i.scopeHash&&e.lane===i.lane;
  const old=s.entries.find(e=>e.runKey===i.runKey);
  if(old&&!same(old))throw Error("RUN_BINDING_CONFLICT");
  // Retrieval incurs no new inference. Caller must still authorise the
  // referenced resource and check content withdrawal/deletion independently.
  const reuse=s.entries.find(e=>same(e)&&e.status==="settled"&&!e.legacy&&e.resultRef&&(e.freshUntil??0)>i.now);
  if(reuse)return{state:s,dispatch:false as const,reuse:reuse.resultRef!};
  if(!a.enabled||!a.ownerApproved)throw Error("INFERENCE_BUDGET_DISABLED");
  if(s.suspended||!s.priorUseReconciled||s.unboundedPrior.length)throw Error("PRIOR_CHARGES_UNRECONCILED");
  if(!a.tokenizationVerified||!a.managedPriceUpperBoundVerified)throw Error("INPUT_OR_PRICE_BOUND_UNPROVEN");
  const l=inferenceProposal.lanes[i.lane];if(!l)throw Error("LANE_NOT_ALLOWED");
  const p=i.proof;
  const body=i.request as {model?:unknown;max_completion_tokens?:unknown};
  if(!body||body.model!==inferenceProposal.model||body.max_completion_tokens!==8192)throw Error("REQUEST_LIMIT_MISMATCH");
  if(!p||p.method!=="provider-attested-full-request"||p.model!==inferenceProposal.model||
    p.requestHash!==h||p.includesInstructionsAndSchema!==true||!/^[a-f0-9]{64}$/.test(p.attestationHash)||
    !Number.isSafeInteger(p.inputTokens)||p.inputTokens<0||p.inputTokens>l.input)throw Error("FULL_REQUEST_TOKEN_BOUND_MISSING");
  if(!/^[a-f0-9]{64}$/.test(i.bindingHash)||!/^[a-f0-9]{64}$/.test(i.scopeHash)||!i.runKey||!Number.isFinite(i.now))
    throw Error("INVALID_BUDGET_BINDING");
  if(old)throw Error(old.status==="cancelled"?"RUN_CANCELLED":"RUN_ALREADY_RESERVED_OR_UNKNOWN");
  // Retries consume slots too. Cancelled no-outbound reservations do not.
  const used=s.entries.filter(e=>e.lane===i.lane&&e.status!=="cancelled").length;
  if(used>=l.slots)throw Error("LANE_SLOTS_EXHAUSTED");
  const worst=tokenCost(l.input,l.output);
  if(budgetUsed(s)+worst>BigInt(inferenceProposal.capNanoUsd))throw Error("INFERENCE_ALLOCATION_EXHAUSTED");
  const entry:BudgetEntry={runKey:i.runKey,lane:i.lane,requestHash:h,bindingHash:i.bindingHash,scopeHash:i.scopeHash,
    inputBound:l.input,outputBound:l.output,reserved:worst.toString(),charged:"0",status:"reserved"};
  return{state:{...s,entries:[...s.entries,entry]},dispatch:true as const,reuse:null};
}
export function transitionBudget(s:BudgetState,key:string,action:"dispatch"|"unknown"|"cancel"){
  const e=s.entries.find(e=>e.runKey===key);if(!e)throw Error("RESERVATION_MISSING");
  const target=action==="dispatch"?"dispatched":action==="unknown"?"unknown":"cancelled";
  if(e.status===target)return s;
  if(action==="dispatch"&&e.status!=="reserved"||action==="unknown"&&!["reserved","dispatched"].includes(e.status)||
    action==="cancel"&&e.status!=="reserved")throw Error("UNSAFE_BUDGET_TRANSITION");
  return{...s,entries:s.entries.map(x=>x===e?{...x,status:target as BudgetEntry["status"]}:x)};
}
export function settleBudget(s:BudgetState,key:string,usage:{input:number;output:number;responseId:string;resultRef:string;freshUntil:number}){
  validateBudgetState(s);
  const e=s.entries.find(e=>e.runKey===key);if(!e||!["dispatched","unknown","settled"].includes(e.status))throw Error("NO_DISPATCH_TO_SETTLE");
  const usageHash=requestDigest(usage);
  if(e.status==="settled"){if(e.usageHash!==usageHash)throw Error("SETTLEMENT_CONFLICT");return s;}
  const charged=tokenCost(usage.input,usage.output);
  if(!usage.responseId||!usage.resultRef||!Number.isFinite(usage.freshUntil))throw Error("INVALID_SETTLEMENT");
  if(usage.input>e.inputBound||usage.output>e.outputBound){
    // Do not hide a provider/proof violation behind the reserved estimate.
    return{...s,suspended:true,unboundedPrior:[...s.unboundedPrior,`reported-bound-breach:${key}`],
      entries:s.entries.map(x=>x===e?{...x,status:"unknown" as const,reserved:(charged>BigInt(x.reserved)?charged:BigInt(x.reserved)).toString()}:x)};
  }
  return{...s,entries:s.entries.map(x=>x===e?{...x,status:"settled" as const,charged:charged.toString(),
    responseId:usage.responseId,resultRef:usage.resultRef,freshUntil:usage.freshUntil,usageHash}:x)};
}
export type PilotUsage={sourceKey:string;lane:BudgetLane;responseId:string|null;input:number|null;output:number|null;model:string|null};
/** Reported-token estimates, not billing certification. Unknown charges remain
 * explicitly unbounded; no missing usage is converted to zero or expired. */
export function importPilotUsage(s:BudgetState,rows:PilotUsage[]){
  const next=structuredClone(s);let imported=0,duplicates=0;
  for(const r of rows){
    const key=`pilot:${requestDigest(r.sourceKey)}`;
    if(next.entries.some(e=>e.runKey===key)){duplicates++;continue;}
    const known=r.model?.startsWith("gpt-5.4-mini")&&Number.isSafeInteger(r.input)&&r.input!>=0&&
      Number.isSafeInteger(r.output)&&r.output!>=0&&r.responseId;
    if(r.responseId){
      const duplicate=next.entries.find(e=>e.responseId===r.responseId);
      if(duplicate){
        if(known&&duplicate.usageHash===requestDigest({input:r.input,output:r.output})){duplicates++;continue;}
        next.unboundedPrior.push(`conflicting-provider-receipt:${key}`);continue;
      }
    }
    const estimate=known?tokenCost(r.input!,r.output!):0n;
    next.entries.push({runKey:key,lane:r.lane,requestHash:requestDigest(r),bindingHash:requestDigest("legacy-import-v1"),
      scopeHash:requestDigest("system-accounting-no-prompt-bodies"),inputBound:r.input??0,outputBound:r.output??0,
      reserved:estimate.toString(),charged:estimate.toString(),status:known?"settled":"unknown",legacy:true,
      ...(r.responseId?{responseId:r.responseId}:{}),usageHash:requestDigest({input:r.input,output:r.output})});
    if(!known)next.unboundedPrior.push(key);
    imported++;
  }
  next.unboundedPrior=[...new Set(next.unboundedPrior)];
  next.priorUseReconciled=false;validateBudgetState(next);
  return{state:next,imported,duplicates};
}
