import {additionalInferenceAllocation,inferenceProposal,requestDigest,tokenCost} from "./inference-budget";
import type {FiniteManifest,FiniteWork} from "./inference-batch-dispatch";
import type {ManagedRequest} from "./managed-inference";

export type OperationalPlanRef={id:string;hash:string;extension:"json"};
export type PreparedOperationalPlan={
  manifest:{candidateHash:string;preparedAt:string;expiresAt:string;status:string};
  artifact:OperationalPlanRef;
  entries:{role:"factual"|"challenge";request:ManagedRequest}[];
};
export type OperationalFiniteInput={candidateVersionId:string;candidateHash:string;bundleHash:string;
  sourceHashes:string[];sourceFiles:{path:string;sha256:string}[];plan:PreparedOperationalPlan};

/** Prepare only exact, already measured operational review requests. The
 * caller must obtain inputs from the database and hash-checked private
 * artifacts. This does not approve a budget or make any publication eligible.
 * Execution rechecks the retained artifacts and live database bindings. */
export function prepareOperationalFiniteManifest(input:OperationalFiniteInput,now=new Date()):FiniteManifest{
  const hex=(s:string)=>/^[a-f0-9]{64}$/.test(s);
  const timestamp=now.getTime(),p=input.plan;
  if(!Number.isFinite(timestamp)||!/^[a-f0-9-]{36}$/.test(input.candidateVersionId)||
    ![input.candidateHash,input.bundleHash,p.artifact.hash,...input.sourceHashes].every(hex)||
    !/^[a-f0-9-]{36}$/.test(p.artifact.id)||p.artifact.extension!=="json"||
    p.manifest.candidateHash!==input.candidateHash||p.manifest.status!=="mechanically_planned_not_reserved")
    throw Error("FINITE_PREPARATION_BINDING_INVALID");
  if(!Number.isFinite(Date.parse(p.manifest.preparedAt))||Date.parse(p.manifest.preparedAt)>timestamp||
    !Number.isFinite(Date.parse(p.manifest.expiresAt))||Date.parse(p.manifest.expiresAt)<=timestamp||
    Date.parse(p.manifest.expiresAt)<=Date.parse(p.manifest.preparedAt))throw Error("FINITE_PREPARATION_STALE");
  if(p.entries.length!==2||!p.entries.some(e=>e.role==="factual")||!p.entries.some(e=>e.role==="challenge")||
    new Set(p.entries.map(e=>requestDigest(e.request))).size!==2)throw Error("FINITE_PREPARATION_PAIR_INVALID");
  if(input.sourceFiles.some(f=>!hex(f.sha256)||!/^docs\/[a-zA-Z0-9_./ -]+$/.test(f.path)||
    f.path.split("/").some(p=>p===".."||p===".")))throw Error("FINITE_PREPARATION_SOURCE_INVALID");
  const planKey=requestDigest({candidateVersionId:input.candidateVersionId,candidateHash:input.candidateHash,
    bundleHash:input.bundleHash,plan:p.artifact,sourceHashes:[...input.sourceHashes].sort()});
  const pair=`operational:${input.candidateVersionId}:${planKey}`;
  const works:FiniteWork[]=p.entries.map(entry=>{
    if(entry.request.model!==inferenceProposal.model||entry.request.max_completion_tokens!==8192||
      entry.request.stream||entry.request.tools?.length||entry.request.tool_choice!==undefined||
      entry.request.n!==undefined&&entry.request.n!==1)throw Error("FINITE_PREPARATION_REQUEST_INVALID");
    return{key:`${pair}:${entry.role}:attempt-1`,lane:"publication",role:entry.role,pair,
      candidateHash:input.candidateHash,sourceHashes:[...input.sourceHashes],caseHash:input.bundleHash,
      request:structuredClone(entry.request),bindings:{candidateVersionId:input.candidateVersionId,
        corpus:null,caseId:null,sourceFiles:structuredClone(input.sourceFiles),historicalCutoff:now.toISOString(),
        operationalPlan:{...p.artifact}}};
  });
  return{version:2,policyVersion:inferenceProposal.priceVersion,allocation:{...additionalInferenceAllocation},
    preparedAt:now.toISOString(),works};
}

export function finiteManifestProposal(manifest:FiniteManifest,expiresAt:string){
  const pairKeys=[...new Set(manifest.works.map(w=>w.pair).filter((p):p is string=>p!==null))];
  const perAttempt=tokenCost(inferenceProposal.fallback.inputTokens,inferenceProposal.fallback.outputTokens);
  return{schemaVersion:1,manifestHash:requestDigest(manifest),manifest,expiresAt,
    enabled:false,ownerApproved:false,providerCalls:0,attemptCount:manifest.works.length,pairCount:pairKeys.length,
    worstCaseReservationNanoUsd:(perAttempt*BigInt(manifest.works.length)).toString(),
    allocationCapNanoUsd:additionalInferenceAllocation.capNanoUsd,
    additionalScope:additionalInferenceAllocation.scope,historicalChargesIncluded:false,
    automaticRetries:0,concurrency:inferenceProposal.batch.concurrency,
    acceptedResponseModels:[inferenceProposal.model,"gpt-5.4-mini-2026-03-17"],
    approvalRequiredForExactManifest:!manifest.packageId,ownerApprovalScope:manifest.packageId?"finite-allocation-package":"exact-manifest",
    packageId:manifest.packageId??null,publicationAccepted:false};
}
