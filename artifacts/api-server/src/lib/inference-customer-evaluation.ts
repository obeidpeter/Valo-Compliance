import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {sha256} from "@workspace/valo-core";
import {bindCustomerCase,expectedSourceNumbers,type AuthoredCustomerCase} from "./valo-customer-case-binding";
import {customerPromptVersion,customerNoticeVersion,customerProviderPayload,hashAI,type CustomerAIInput} from "./valo-customer-ai-domain";
import {customerCompletionRequest} from "./valo-customer-ai-model";
import {additionalInferenceAllocation,inferenceProposal,requestDigest} from "./inference-budget";
import type {FiniteManifest,FiniteWork} from "./inference-batch-dispatch";
import type {ArtifactRef} from "../editorial/publication-artifacts";

const root=resolve(import.meta.dirname,"../../../.."),corpusPath="docs/evaluation-candidates/customer-ai.json";
export const customerEvaluationCodePaths=[
  "artifacts/api-server/src/lib/valo-customer-case-binding.ts",
  "artifacts/api-server/src/lib/valo-customer-ai-domain.ts",
  "artifacts/api-server/src/lib/valo-customer-ai-model.ts",
  "artifacts/api-server/src/lib/valo-customer-ai.ts",
  "artifacts/api-server/src/lib/inference-customer-evaluation.ts",
  "artifacts/api-server/src/lib/inference-customer-runtime.ts",
  "artifacts/api-server/src/lib/inference-customer-controls.ts",
  "artifacts/api-server/src/scripts/finite-customer-evaluation.ts",
  "lib/valo-core/src/customer-document.ts","lib/valo-core/src/money.ts",
] as const;
type SourceCase=AuthoredCustomerCase&{expectedChecks:string[];criticalFailureConditions:string[];harnessConditions?:string[]};
export type CustomerEvaluationActor={workspaceId:string;identityId:string;anchorDraftId:string};
export type CustomerEvaluationFollowups=Record<string,Record<string,string>>;
export type CustomerCasePreparation={caseId:string;caseHash:string;category:string;expectedChecks:string[];harnessConditions:string[];
  criticalFailureConditions:string[];classification:"provider_ready"|"preflight_observed"|"mapping_hold"|"controlled_fault_hold"|"native_boundary_hold"|"provider_contract_hold";
  issues:string[];missing:string[];unmappedFacts:string[];unsupported:boolean;numericChecks:ReturnType<typeof expectedSourceNumbers>;
  input:CustomerAIInput|null;inputHash:string;providerInputHash:string|null;request:ReturnType<typeof customerCompletionRequest>|null;
  asWritten:{inputHash:string;issues:string[];missing:string[];unmappedFacts:string[];unsupported:boolean};
  followupValues:Record<string,string>;providerQualityAccepted:false;targetBoundaryProved:false;hold:string|null};
export type CustomerEvaluationPlan={version:1;kind:"original-customer60-finite-preparation";preparedAt:string;expiresAt:string;
  corpus:{path:typeof corpusPath;sha256:string};codeFiles:{path:string;sha256:string}[];
  promptVersion:string;noticeVersion:string;actor:CustomerEvaluationActor|null;followups:CustomerEvaluationFollowups;cases:CustomerCasePreparation[];
  providerCalls:0;approvalRowsWritten:0;formalAcceptance:false};
const faults=new Set(["invalid_schema_twice","provider_timeout","unsafe_provider_markup","provider_rate_limit",
  "invalid_schema_then_recovery","provider_outage_preserves_work"]);
const native=new Set(["quota_exhausted","feature_kill_switch","tenant_context_isolation"]);
export function prepareCustomerCase(c:SourceCase,followup:Record<string,string>={}):CustomerCasePreparation{
  const original=bindCustomerCase(c),supplied={documentNumber:c.suppliedFacts.reference??c.suppliedFacts.invoiceReference,
    issueDate:c.suppliedFacts.issueDate??c.suppliedFacts.asOfDate,dueDate:c.suppliedFacts.dueDate};
  for(const [key,value]of Object.entries(followup)){
    if(!["documentNumber","issueDate","dueDate"].includes(key)||typeof value!=="string"||!value.trim()||value.length>100||
      supplied[key as keyof typeof supplied]!==undefined&&supplied[key as keyof typeof supplied]!==null&&
      supplied[key as keyof typeof supplied]!=="")throw Error("FOLLOWUP_CANNOT_REPLACE_SUPPLIED_FACTS");
  }
  const bound=bindCustomerCase(c,followup),numericChecks=expectedSourceNumbers(c,bound);
  let classification:CustomerCasePreparation["classification"]="provider_ready",hold:string|null=null;
  if(faults.has(c.category)){classification="controlled_fault_hold";hold="DECLARED_FOLLOWUP_AND_REAL_FAULT_BOUNDARY_REQUIRED";}
  else if(native.has(c.category)){classification="native_boundary_hold";hold="ACTUAL_ISOLATED_STATE_AND_JOURNEY_EVIDENCE_REQUIRED";}
  else if(bound.issues.length||bound.unmappedFacts.length||numericChecks.some(n=>!n.pass)){
    classification="mapping_hold";hold="SOURCE_INPUT_OR_NUMERIC_CONTRACT_UNRESOLVED";
  }else if(!bound.input||bound.missing.length||bound.unsupported){
    classification="preflight_observed";hold=bound.unsupported?"UNSUPPORTED_INPUT_OBSERVED":"MISSING_INFORMATION_OBSERVED";
  }
  const payload=bound.input?customerProviderPayload(bound.input):null;
  return{caseId:c.caseID,caseHash:hashAI(c),category:c.category,expectedChecks:[...c.expectedChecks],harnessConditions:[...c.harnessConditions??[]],
    criticalFailureConditions:[...c.criticalFailureConditions],classification,issues:bound.issues,missing:bound.missing,
    unmappedFacts:bound.unmappedFacts,unsupported:bound.unsupported,numericChecks,input:bound.input,inputHash:bound.inputHash,
    providerInputHash:payload?hashAI(payload):null,request:classification==="provider_ready"?customerCompletionRequest(payload!):null,
    asWritten:{inputHash:original.inputHash,issues:original.issues,missing:original.missing,
      unmappedFacts:original.unmappedFacts,unsupported:original.unsupported},
    followupValues:{...followup},providerQualityAccepted:false,targetBoundaryProved:false,hold};
}
export async function prepareCustomerEvaluationPlan(actor:CustomerEvaluationActor|null,now=new Date(),
  followups:CustomerEvaluationFollowups={}):Promise<CustomerEvaluationPlan>{
  if(actor&&(!/^[a-f0-9-]{36}$/.test(actor.workspaceId)||!/^[a-f0-9-]{36}$/.test(actor.anchorDraftId)||
    !/^valo-ai-eval-invoice-[a-zA-Z0-9-]+$/.test(actor.identityId)))throw Error("EXISTING_SYNTHETIC_ACTOR_REQUIRED");
  const bytes=await readFile(resolve(root,corpusPath)),corpus=JSON.parse(bytes.toString()) as {cases:SourceCase[]};
  if(corpus.cases.length!==60||new Set(corpus.cases.map(c=>c.caseID)).size!==60||
    corpus.cases.some(c=>!/^CAI-CAND-(INV|QUO|REM|PRO)-(0[1-9]|1[0-5])$/.test(c.caseID)))throw Error("CUSTOMER_CORPUS_CHANGED");
  if(!followups||typeof followups!=="object"||Array.isArray(followups)||Object.entries(followups).some(([id,values])=>
    !corpus.cases.some(c=>c.caseID===id)||!values||typeof values!=="object"||Array.isArray(values)))
    throw Error("CUSTOMER_FOLLOWUP_MAP_INVALID");
  const codeFiles=await Promise.all(customerEvaluationCodePaths.map(async path=>({path,sha256:sha256(await readFile(resolve(root,path)))})));
  return{version:1,kind:"original-customer60-finite-preparation",preparedAt:now.toISOString(),
    expiresAt:new Date(+now+3600000).toISOString(),corpus:{path:corpusPath,sha256:sha256(bytes)},codeFiles,
    promptVersion:customerPromptVersion,noticeVersion:customerNoticeVersion,actor:actor?{...actor}:null,
    followups:structuredClone(followups),cases:corpus.cases.map(c=>prepareCustomerCase(c,followups[c.caseID]??{})),
    providerCalls:0,approvalRowsWritten:0,formalAcceptance:false};
}
export function prepareCustomerFiniteManifest(plan:CustomerEvaluationPlan,artifact:ArtifactRef,caseId:string,packageId:string):FiniteManifest{
  const entry=plan.cases.find(c=>c.caseId===caseId);
  if(!plan.actor||!entry?.input||entry.classification!=="provider_ready"||!entry.request||artifact.extension!=="json"||
    !/^[a-f0-9-]{36}$/.test(artifact.id)||!/^[a-f0-9]{64}$/.test(artifact.hash)||Date.parse(plan.preparedAt)>Date.now()||
    !/^finite-package:[a-f0-9]{64}$/.test(packageId)||!Number.isFinite(Date.parse(plan.expiresAt))||
    Date.parse(plan.expiresAt)<=Date.now())throw Error("CUSTOMER_PREPARATION_HELD");
  const key=`customer:${caseId}:${requestDigest({plan:artifact,caseHash:entry.caseHash})}`;
  const primary:FiniteWork={key:`${key}:attempt-1`,lane:"customer",role:"customer",pair:null,
    candidateHash:entry.caseHash,caseHash:entry.caseHash,sourceHashes:[plan.corpus.sha256],request:structuredClone(entry.request),
    bindings:{candidateVersionId:null,corpus:"customer-ai",caseId,sourceFiles:[{...plan.corpus}],customerPlan:{...artifact}}};
  return{version:2,policyVersion:inferenceProposal.priceVersion,allocation:{...additionalInferenceAllocation},
    packageId,preparedAt:plan.preparedAt,works:[primary,{...structuredClone(primary),key:`${key}:attempt-2`,retryOf:primary.key}]};
}
export async function validateCustomerEvaluationWork(work:FiniteWork,readArtifact:(ref:ArtifactRef)=>Promise<Buffer>){
  const ref=work.bindings.customerPlan;
  if(work.lane!=="customer"||work.role!=="customer"||work.pair||work.bindings.corpus!=="customer-ai"||
    work.bindings.candidateVersionId||!ref||!work.bindings.caseId)throw Error("CUSTOMER_PLAN_BINDING_REQUIRED");
  const plan=JSON.parse((await readArtifact(ref)).toString()) as CustomerEvaluationPlan;
  if(plan.version!==1||plan.kind!=="original-customer60-finite-preparation"||!plan.actor||
    Date.parse(plan.preparedAt)>Date.now()||!Number.isFinite(Date.parse(plan.expiresAt))||Date.parse(plan.expiresAt)<=Date.now())
    throw Error("CUSTOMER_PLAN_EXPIRED_OR_INVALID");
  const actual=await prepareCustomerEvaluationPlan(plan.actor,new Date(plan.preparedAt),plan.followups);
  if(requestDigest(actual)!==requestDigest(plan))throw Error("CUSTOMER_PLAN_INPUT_CHANGED");
  const expected=prepareCustomerFiniteManifest(actual,ref,work.bindings.caseId,"finite-package:"+"0".repeat(64));
  const member=expected.works.find(w=>w.key===work.key);
  if(!member||requestDigest(member)!==requestDigest(work))throw Error("CUSTOMER_PLAN_REQUEST_CHANGED");
  return{plan,entry:actual.cases.find(c=>c.caseId===work.bindings.caseId)!};
}
