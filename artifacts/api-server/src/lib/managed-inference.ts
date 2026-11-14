import {inferenceProposal} from "./inference-budget";
import {pool} from "@workspace/db";
import {InferenceBudgetStore} from "./inference-budget-store";
import {FiniteInferenceDispatcher} from "./inference-batch-dispatch";
import {assertFiniteWorkBindings} from "./inference-work-bindings";
export type ManagedRequest={model:string;max_completion_tokens?:number;messages:readonly unknown[];
  response_format?:unknown;stream?:boolean;tools?:unknown[];n?:number;tool_choice?:unknown};
export class InferenceHeld extends Error{
  constructor(public readonly code="INFERENCE_BUDGET_DISABLED"){super(code);this.name="InferenceHeld";}
}
const dispatcher=new FiniteInferenceDispatcher(new InferenceBudgetStore(pool),async(request,options)=>{
  const {openai}=await import("@workspace/integrations-openai-ai-server");
  return await openai.chat.completions.create(request as Parameters<typeof openai.chat.completions.create>[0],
    options) as ManagedCompletionResult;
},assertFiniteWorkBindings);
export const withApprovedInferenceWork=<T>(batchId:string,key:string,fn:()=>Promise<T>)=>dispatcher.withWork(batchId,key,fn);
export const managedInferenceLane=(fallback:"publication"|"editorial_evaluation"|"checker_challenge"|"customer")=>
  dispatcher.current()?.lane??fallback;
/** All provider paths need durable finite-work authorization; no environment
 * switch or caller boolean enables a batch. A production SDK call is reached
 * only after the global ledger commits both admission and dispatch. */
export async function managedCompletion(lane:"publication"|"editorial_evaluation"|"checker_challenge"|"customer",
  request:ManagedRequest,
  _options:{timeout:number;maxRetries:0;onOutbound?:()=>void}):Promise<ManagedCompletionResult>{
  const limits=inferenceProposal.lanes[lane];
  if(!limits||request.model!==inferenceProposal.model||request.max_completion_tokens!==8192||
    request.stream||request.tools?.length||request.tool_choice!==undefined||
    (request.n!==undefined&&request.n!==1)||_options.maxRetries!==0)throw new InferenceHeld("UNAPPROVED_INFERENCE_REQUEST");
  if(!dispatcher.current())throw new InferenceHeld();
  return dispatcher.complete(lane,request,_options);
}
export type ManagedCompletionResult={id:string;model:string;created:number;_request_id?:string|null;
  choices:{finish_reason:string|null;message:{content:string|null}}[];
  usage?:{prompt_tokens:number;completion_tokens:number;total_tokens:number}};
export function assertManagedInferenceAvailable():void{if(!dispatcher.current())throw new InferenceHeld();}
