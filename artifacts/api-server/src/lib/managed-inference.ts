import {inferenceProposal,requestDigest} from "./inference-budget";
type ManagedRequest={model:string;max_completion_tokens?:number;messages:readonly unknown[];
  response_format?:unknown;stream?:boolean;tools?:unknown[];n?:number;tool_choice?:unknown};
export class InferenceHeld extends Error{
  constructor(public readonly code="INFERENCE_BUDGET_DISABLED"){super(code);this.name="InferenceHeld";}
}
/** All Valo managed SDK dispatches pass here. There is intentionally no env
 * switch, caller certificate, enabled authority or automatic activation path.
 * See the durable offline ledger; production full-request attestation remains
 * unsupported/unproved. A byte estimate is never accepted as token proof;
 * the prepared context-capacity fallback does not activate this transport. */
export async function managedCompletion(lane:"publication"|"editorial_evaluation"|"checker_challenge"|"customer",
  request:ManagedRequest,
  _options:{timeout:number;maxRetries:0}):Promise<ManagedCompletionResult>{
  const limits=inferenceProposal.lanes[lane];
  if(!limits||request.model!==inferenceProposal.model||request.max_completion_tokens!==8192||
    request.stream||request.tools?.length||request.tool_choice!==undefined||
    (request.n!==undefined&&request.n!==1)||_options.maxRetries!==0)throw new InferenceHeld("UNAPPROVED_INFERENCE_REQUEST");
  // Hash includes instructions/messages AND schema/options. Metadata only.
  requestDigest(request);
  throw new InferenceHeld();
  // Deliberately no SDK import/call until owner approval, pilot reconciliation
  // and a price-bound adapter is supplied. Whole-context reservations need no
  // exact tokenization, but remain disabled pending the same authorization.
  // This return annotation preserves the existing SDK response contract.
}
export type ManagedCompletionResult={id:string;model:string;created:number;_request_id?:string|null;
  choices:{finish_reason:string|null;message:{content:string|null}}[];
  usage?:{prompt_tokens:number;completion_tokens:number;total_tokens:number}};
export function assertManagedInferenceAvailable():void{throw new InferenceHeld();}
