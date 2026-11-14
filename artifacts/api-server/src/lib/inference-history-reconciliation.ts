import {createHash} from "node:crypto";
import {acceptedInferenceModels,requestDigest,tokenCost,validateBudgetState,type BudgetState} from "./inference-budget";

export type HistoricalPublicationAttempt={id:string;candidateHash:string;role:string;requestHash:string|null;
  responseId:string|null;inputTokens:number|null;outputTokens:number|null};
export type HistoricalArtifactInput={ref:{id:string;hash:string;extension:"json"};bytes:Uint8Array;
  reportCandidateHash:string;sourceReportSha256:string};
type Receipt={artifactId:string;artifactHash:string;sourceReportSha256:string;candidateHash:string;role:"factual"|"challenge";
  requestHash:string|null;responseId:string;model:string;inputTokens:number;outputTokens:number};
const hex=(v:unknown):v is string=>typeof v==="string"&&/^[a-f0-9]{64}$/.test(v);
const count=(v:unknown):v is number=>typeof v==="number"&&Number.isSafeInteger(v)&&v>=0;
const sha256=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex");

/** A retained JSON summary is not a receipt. Only the actual hash-matching
 * private response artifact supplies model, usage and response identity. This
 * proves the retained server record, not an account invoice or legal review. */
export function verifyHistoricalPublicationReceipt(input:HistoricalArtifactInput):Receipt{
  if(!hex(input.ref.hash)||!hex(input.reportCandidateHash)||!hex(input.sourceReportSha256)||
    !/^[a-f0-9-]{36}$/.test(input.ref.id)||input.ref.extension!=="json"||
    input.bytes.byteLength>2*1024*1024||sha256(input.bytes)!==input.ref.hash)
    throw Error("HISTORY_ARTIFACT_HASH_INVALID");
  let value:Record<string,unknown>;
  try{value=JSON.parse(Buffer.from(input.bytes).toString("utf8"));}catch{throw Error("HISTORY_ARTIFACT_JSON_INVALID");}
  if(!value||typeof value!=="object"||Array.isArray(value)||!hex(value.candidateHash)||
    value.candidateHash!==input.reportCandidateHash||!["factual","challenge"].includes(value.role as string)||
    typeof value.providerResponseId!=="string"||!value.providerResponseId.trim()||value.providerResponseId.length>200||
    typeof value.model!=="string"||!acceptedInferenceModels.has(value.model)||
    !count(value.inputTokens)||!count(value.outputTokens)||
    value.requestHash!==undefined&&value.requestHash!==null&&!hex(value.requestHash))
    throw Error("HISTORY_RECEIPT_FIELDS_INVALID");
  return{artifactId:input.ref.id,artifactHash:input.ref.hash,sourceReportSha256:input.sourceReportSha256,
    candidateHash:value.candidateHash,role:value.role as Receipt["role"],requestHash:(value.requestHash as string|null)??null,
    responseId:value.providerResponseId,model:value.model,inputTokens:value.inputTokens,outputTokens:value.outputTokens};
}

/** Produce auditable proposals only. Nothing updates old rows, grants a new
 * allocation, declares an unknown free or changes priorUseReconciled. Each
 * proposal binds the exact old entry, source row and private artifact. */
export function proposeHistoricalReceiptResolutions(state:BudgetState,attempts:HistoricalPublicationAttempt[],
  artifacts:HistoricalArtifactInput[]){
  validateBudgetState(state);
  const verified:Receipt[]=[],invalidArtifacts:{artifactId:string;reason:string}[]=[],seen=new Set<string>();
  for(const input of artifacts){
    try{
      const receipt=verifyHistoricalPublicationReceipt(input),key=`${receipt.artifactId}:${receipt.artifactHash}`;
      if(!seen.has(key)){verified.push(receipt);seen.add(key);}
    }catch(error){invalidArtifacts.push({artifactId:input.ref?.id??"unknown",
      reason:error instanceof Error?error.message:"HISTORY_ARTIFACT_INVALID"});}
  }
  const uniqueSources=new Map<string,HistoricalPublicationAttempt>();
  const conflictingSources=new Set<string>();
  for(const source of attempts){
    const old=uniqueSources.get(source.id);
    if(old&&requestDigest(old)!==requestDigest(source))conflictingSources.add(source.id);
    else uniqueSources.set(source.id,source);
  }
  const validSource=(s:HistoricalPublicationAttempt)=>/^\d+$/.test(s.id)&&hex(s.candidateHash)&&
    ["factual","challenge"].includes(s.role)&&(s.requestHash===null||hex(s.requestHash))&&
    (s.responseId===null||typeof s.responseId==="string"&&Boolean(s.responseId.trim()))&&
    (s.inputTokens===null||count(s.inputTokens))&&(s.outputTokens===null||count(s.outputTokens));
  const identityMatches=(s:HistoricalPublicationAttempt,r:Receipt)=>s.candidateHash===r.candidateHash&&s.role===r.role&&
    (s.requestHash===null||r.requestHash===null||s.requestHash===r.requestHash)&&
    (s.responseId===null||s.responseId===r.responseId);
  const rows=[...uniqueSources.values()];
  const proposed:{sourceKey:string;ledgerRunKey:string;beforeEntryHash:string;sourceRowHash:string;receipt:Receipt;
    joinKeys:string[];estimatedNanoUsd:string;proposalHash:string}[]=[];
  const unresolved:{sourceKey:string;reason:string}[]=[];
  for(const source of rows){
    const sourceKey=`publication:${source.id}`,ledgerRunKey=`pilot:${requestDigest(sourceKey)}`;
    const entry=state.entries.find(e=>e.runKey===ledgerRunKey);
    if(!entry||entry.legacy!==true||entry.status!=="unknown")continue;
    const hold=(reason:string)=>unresolved.push({sourceKey,reason});
    if(conflictingSources.has(source.id)||!validSource(source)){hold("HISTORY_SOURCE_INVALID_OR_CONFLICTING");continue;}
    const matches=verified.filter(r=>identityMatches(source,r));
    if(matches.length!==1){hold(matches.length?"HISTORY_RECEIPT_AMBIGUOUS":"HISTORY_VERIFIED_RECEIPT_MISSING");continue;}
    const receipt=matches[0]!;
    if(rows.filter(s=>validSource(s)&&identityMatches(s,receipt)).length!==1){hold("HISTORY_ATTEMPT_AMBIGUOUS");continue;}
    if(verified.filter(r=>r.responseId===receipt.responseId).length!==1||
      state.entries.some(e=>e.runKey!==ledgerRunKey&&e.responseId===receipt.responseId)){
      hold("HISTORY_PROVIDER_RECEIPT_REUSED");continue;
    }
    if(source.inputTokens!==null&&source.inputTokens!==receipt.inputTokens||
      source.outputTokens!==null&&source.outputTokens!==receipt.outputTokens||
      entry.responseId!==undefined&&entry.responseId!==receipt.responseId){hold("HISTORY_SOURCE_RECEIPT_CONFLICT");continue;}
    const joinKeys=["candidateHash","role"];
    if(source.requestHash!==null&&receipt.requestHash!==null)joinKeys.push("requestHash");
    if(source.responseId!==null)joinKeys.push("providerResponseId");
    const evidence={sourceKey,ledgerRunKey,beforeEntryHash:requestDigest(entry),sourceRowHash:requestDigest(source),
      receipt,joinKeys,estimatedNanoUsd:tokenCost(receipt.inputTokens,receipt.outputTokens).toString()};
    proposed.push({...evidence,proposalHash:requestDigest(evidence)});
  }
  return{version:1,historyHash:requestDigest(state),proposed,unresolved,invalidArtifacts,
    verifiedRetainedArtifacts:verified.length,ledgerWrites:0,approvalWrites:0,providerCalls:0,
    reconciliationApplied:false,unboundedLiabilitiesUnchanged:state.unboundedPrior.length,
    note:"Reported-token estimates are not account invoices. Proposed joins do not alter or discharge any liability."};
}
