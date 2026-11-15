import {assertDevelopmentRuntime} from "./valo-development-runtime";
import {acceptedInferenceModels,requestDigest} from "./inference-budget";
import {customerPromptVersion,customerNoticeVersion,hashAI,type CustomerPreview} from "./valo-customer-ai-domain";
import type {CustomerEvaluationActor,CustomerEvaluationPlan,CustomerCasePreparation} from "./inference-customer-evaluation";
import type {FiniteManifest} from "./inference-batch-dispatch";
type Query=(text:string,values:unknown[])=>Promise<{rows:Record<string,any>[]} >;
async function query(text:string,values:unknown[]){const{pool}=await import("@workspace/db");return pool.query(text,values);}
const membership=`from valo_ai_drafts d join valo_memberships m on m.workspace_id=d.workspace_id
  and m.identity_id=d.actor_id and m.active='yes' join valo_workspaces w on w.id=d.workspace_id
  where d.actor_id like 'valo-ai-eval-invoice-%' and not exists
  (select 1 from valo_privacy_tombstones t where t.workspace_id=d.workspace_id)`;
/** Select only a retained synthetic actor. Never create a replacement identity,
 * workspace, quota fixture, safety-switch override or new financial allocation. */
export async function existingCustomerEvaluationActor(read:Query=query):Promise<CustomerEvaluationActor|null>{
  assertDevelopmentRuntime();
  const row=(await read(`select d.id,d.workspace_id,d.actor_id ${membership} order by d.created_at,d.id limit 1`,[])).rows[0];
  return row?{anchorDraftId:row.id,workspaceId:row.workspace_id,identityId:row.actor_id}:null;
}
function measuredReceipt(run:Record<string,any>){
  const u=run.usage;
  return typeof run.responseId==="string"&&run.responseId.length>0&&
    typeof run.model==="string"&&acceptedInferenceModels.has(run.model)&&u&&
    [u.inputTokens,u.outputTokens,u.totalTokens].every(n=>Number.isSafeInteger(n)&&n>=0)&&
    u.totalTokens===u.inputTokens+u.outputTokens;
}
export async function assertCustomerEvaluationActor(plan:CustomerEvaluationPlan,entry:CustomerCasePreparation,read:Query=query){
  assertDevelopmentRuntime();const actor=plan.actor;
  if(!actor||!entry.input||entry.classification!=="provider_ready")throw Error("CUSTOMER_EVALUATION_INPUT_HELD");
  const anchor=(await read(`select d.id ${membership} and d.id=$1 and d.workspace_id=$2 and d.actor_id=$3`,
    [actor.anchorDraftId,actor.workspaceId,actor.identityId])).rows[0];
  if(!anchor)throw Error("EXISTING_SYNTHETIC_ACTOR_UNAVAILABLE");
  const {idempotencyKey,...facts}=entry.input,inputHash=hashAI(facts);
  const prior=(await read(`select id,workspace_id,idempotency_key,input_hash,provider_input_hash,prompt_version,
    provider_runs,status,created_at from valo_ai_drafts where input_hash=$1
    or (workspace_id=$2 and idempotency_key=$3)`,
    [inputHash,actor.workspaceId,idempotencyKey])).rows;
  let reusableExisting=false;
  for(const row of prior){
    const own=row.workspace_id===actor.workspaceId&&row.idempotency_key===idempotencyKey;
    if(own&&row.input_hash!==inputHash)throw Error("CUSTOMER_IDEMPOTENCY_BINDING_CHANGED");
    if(!Array.isArray(row.provider_runs))throw Error("HISTORICAL_CUSTOMER_RECEIPT_UNKNOWN");
    if(row.provider_runs.some((r:Record<string,any>)=>r.outboundAttempted===true&&!measuredReceipt(r)))
      throw Error("HISTORICAL_CUSTOMER_RECEIPT_UNKNOWN");
    if(own&&row.status==="ready"&&!row.provider_runs.some((r:Record<string,any>)=>r.outboundAttempted===true&&measuredReceipt(r)))
      throw Error("HISTORICAL_CUSTOMER_RECEIPT_UNKNOWN");
    if(row.status==="running"&&(!own||+new Date(row.created_at)<Date.parse(plan.preparedAt)))
      throw Error("HISTORICAL_CUSTOMER_COMPLETION_UNKNOWN");
    if(own&&row.status!=="running"&&row.status!=="ready")throw Error("EXISTING_CUSTOMER_FALLBACK_REQUIRES_REVIEW");
    if(own&&row.status==="ready"&&(row.prompt_version!==`${customerPromptVersion}/${customerNoticeVersion}`||
      row.provider_input_hash!==entry.providerInputHash||
      Date.now()-+new Date(row.created_at)>=86400000))throw Error("EXISTING_CUSTOMER_RESULT_STALE_OR_CHANGED");
    if(own&&row.status==="ready")reusableExisting=true;
  }
  if(!reusableExisting){
    const flags=(await read("select enabled from valo_safety_switches where key=any($1::text[])",
      [["customer_ai",`customer_ai_workspace:${actor.workspaceId}`]])).rows;
    if(flags.some(row=>row.enabled!==true))throw Error("CUSTOMER_AI_SAFETY_SWITCH_HELD");
  }
  return{reusableExisting};
}
export type CustomerExecutionDependencies={
  recheck:()=>Promise<{reusableExisting:boolean}>;withWork:<T>(batchId:string,key:string,fn:()=>Promise<T>)=>Promise<T>;
  usage:()=>Promise<{enabled:boolean;workspaceUsed:number;workspaceDailyLimit:number;globalAvailable:boolean;minuteLimit:number}>;
  recentRequests:()=>Promise<number>;create:(input:NonNullable<CustomerCasePreparation["input"]>)=>Promise<{
    preview:CustomerPreview;newProviderAttempts:number|null}>;
  stored:(id:string)=>Promise<{inputHash:string;providerInputHash:string|null;providerRuns:Record<string,any>[]}>;
};
/** The actual customer service owns persistence, quota reservation and the
 * default organizer. Results retain partial evidence, never invented acceptance. */
export async function executePreparedCustomerCase(batchId:string,manifest:FiniteManifest,plan:CustomerEvaluationPlan,
  deps:CustomerExecutionDependencies){
  assertDevelopmentRuntime();
  const primary=manifest.works.find(w=>!w.retryOf),retry=manifest.works.find(w=>w.retryOf);
  if(manifest.works.length!==2||!primary||!retry||primary.lane!=="customer"||retry.retryOf!==primary.key||
    primary.bindings.caseId!==retry.bindings.caseId)throw Error("CUSTOMER_RUNNER_SCOPE_INVALID");
  const entry=plan.cases.find(c=>c.caseId===primary.bindings.caseId);
  if(!entry?.input||entry.classification!=="provider_ready")throw Error("CUSTOMER_EVALUATION_INPUT_HELD");
  const input=entry.input;
  const checked=await deps.recheck();
  const {preview,newProviderAttempts}=await deps.withWork(batchId,primary.key,async()=>{
    if(!checked.reusableExisting){
      const usage=await deps.usage();
      if(!usage.enabled||!usage.globalAvailable||usage.workspaceUsed>=usage.workspaceDailyLimit)
        throw Error("CUSTOMER_SERVICE_QUOTA_OR_SWITCH_HELD");
      if(await deps.recentRequests()>=usage.minuteLimit)throw Error("CUSTOMER_MINUTE_QUOTA_HELD");
    }
    return deps.create(input);
  });
  const retained=await deps.stored(preview.id),{idempotencyKey:_key,...facts}=input;
  if(retained.inputHash!==hashAI(facts)||preview.inputHash!==hashAI(facts)||
    preview.status==="ready"&&retained.providerInputHash!==entry.providerInputHash)
    throw Error("CUSTOMER_RESULT_BINDING_CHANGED");
  // Stored providerRuns may include an exact prior replay. Do not call their
  // cumulative count the number of new outbound calls in this invocation.
  const receipts=retained.providerRuns.filter(r=>r.outboundAttempted===true).map(r=>({attempt:r.attempt,
    responseId:r.responseId??null,model:r.model??null,usage:r.usage??null,measured:measuredReceipt(r)}));
  const factsPreserved=requestDigest(preview.content.financialInput)===requestDigest(input.financialInput)&&
    (["issuerName","recipientName","documentNumber","issueDate","dueDate"] as const).every(k=>preview.content.fields[k]===input[k]);
  const usable=preview.status==="ready"&&factsPreserved&&receipts.length>0&&receipts.every(r=>r.measured);
  return{caseId:entry.caseId,caseHash:entry.caseHash,previewId:preview.id,previewStatus:preview.status,
    inputHash:entry.inputHash,providerInputHash:entry.providerInputHash,retainedProviderReceipts:receipts,
    asWrittenPreflight:entry.asWritten,declaredFollowup:entry.followupValues,
    generationAfterDeclaredClarification:Object.keys(entry.followupValues).length>0,
    actualNewProviderAttempts:newProviderAttempts,actualBilling:null,factsPreserved,numericChecks:entry.numericChecks,
    expectedChecks:entry.expectedChecks,criticalFailureConditions:entry.criticalFailureConditions,
    status:usable?"partial_provider_evidence":"application_or_provider_hold",providerQualityAccepted:false,
    fullRubricAssessed:false,routineLogPrivacyInspected:false,formalAcceptance:false,
    scope:"Actual customer service/organizer result; original full rubric, privacy log inspection and independent quality assessment remain required."};
}
