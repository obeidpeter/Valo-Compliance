import {AsyncLocalStorage} from "node:async_hooks";
import {inferenceProposal,type BudgetLane} from "./inference-budget";
import type {FiniteInferenceDispatcher} from "./inference-batch-dispatch";
import {assertDevelopmentRuntime} from "./valo-development-runtime";
import {createManagedSDKTransport,type ManagedSDKClient} from "./managed-sdk-transport";
export type ManagedRequest={model:string;max_completion_tokens?:number;messages:readonly unknown[];
  response_format?:unknown;stream?:boolean;tools?:unknown[];n?:number;tool_choice?:unknown};
export class InferenceHeld extends Error{
  constructor(public readonly code="INFERENCE_BUDGET_DISABLED"){super(code);this.name="InferenceHeld";}
}
// A disabled/no-context request does not load a database, provider SDK or network
// configuration. Only server-owned finite-work entry points can create context.
const active=new AsyncLocalStorage<FiniteInferenceDispatcher>();
/** Server composition only. The dispatcher still loads real durable approval,
 * checks every exact work binding and reserves before invoking its transport.
 * No HTTP input or boolean can establish this context. */
export function withBoundInferenceDispatcher<T>(d:FiniteInferenceDispatcher,fn:()=>Promise<T>){
  return active.run(d,fn);
}
let runtime:Promise<FiniteInferenceDispatcher>|undefined;
function requireDevelopment(){try{assertDevelopmentRuntime();}catch{throw new InferenceHeld("INFERENCE_DEVELOPMENT_ONLY");}}
async function dispatcher(){
  requireDevelopment();
  runtime??=(async()=>{
    const[{pool},{InferenceBudgetStore},{FiniteInferenceDispatcher},{assertFiniteWorkBindings}]=await Promise.all([
      import("@workspace/db"),import("./inference-budget-store"),import("./inference-batch-dispatch"),import("./inference-work-bindings")]);
    return new FiniteInferenceDispatcher(new InferenceBudgetStore(pool,"public","additional-new"),createManagedSDKTransport(async()=>{
      const {openai}=await import("@workspace/integrations-openai-ai-server");
      return openai as unknown as ManagedSDKClient;
    }),assertFiniteWorkBindings);
  })();
  return runtime;
}
export async function withApprovedInferenceWork<T>(batchId:string,key:string,fn:()=>Promise<T>){
  const d=await dispatcher();return withBoundInferenceDispatcher(d,()=>d.withWork(batchId,key,fn));
}
export async function withApprovedInferencePair<T>(batchId:string,pairKey:string,fn:()=>Promise<T>){
  const d=await dispatcher();return withBoundInferenceDispatcher(d,()=>d.withPair(batchId,pairKey,fn));
}
export async function withApprovedInferenceRole<T>(role:"factual"|"challenge",fn:()=>Promise<T>){
  const d=active.getStore();if(!d)throw new InferenceHeld();
  return d.withRole(role,fn);
}
export async function withApprovedInferenceAttempt<T>(attempt:number,fn:()=>Promise<T>){
  const d=active.getStore();if(!d)throw new InferenceHeld();
  try{return await d.withAttempt(attempt,fn);}
  catch(error){
    if(error instanceof Error&&["RETRY_NOT_ALLOWLISTED","RETRY_REQUIRES_SETTLED_PRIOR_ATTEMPT",
      "APPROVED_CUSTOMER_WORK_REQUIRED"].includes(error.message))throw new InferenceHeld(error.message);
    throw error;
  }
}
export const managedInferenceLane=(fallback:BudgetLane)=>active.getStore()?.current()?.lane??fallback;
export const hasApprovedInferenceContext=(lane?:BudgetLane)=>{
  const ctx=active.getStore()?.current();return !!ctx&&(!lane||ctx.lane===lane);
};
/** All provider paths require the same durable finite-work authorization. */
export async function managedCompletion(lane:BudgetLane,request:ManagedRequest,
  options:{timeout:number;maxRetries:0;onOutbound?:()=>void}):Promise<ManagedCompletionResult>{
  const limits=inferenceProposal.lanes[lane];
  if(!limits||request.model!==inferenceProposal.model||request.max_completion_tokens!==8192||
    request.stream||request.tools?.length||request.tool_choice!==undefined||
    (request.n!==undefined&&request.n!==1)||options.maxRetries!==0)throw new InferenceHeld("UNAPPROVED_INFERENCE_REQUEST");
  const d=active.getStore();if(!d?.current())throw new InferenceHeld();
  requireDevelopment();
  return d.complete(lane,request,options);
}
export type ManagedCompletionResult={id:string;model:string;created:number;_request_id?:string|null;
  choices:{finish_reason:string|null;message:{content:string|null}}[];
  usage?:{prompt_tokens:number;completion_tokens:number;total_tokens:number}};
export function assertManagedInferenceAvailable():void{if(!hasApprovedInferenceContext())throw new InferenceHeld();}
