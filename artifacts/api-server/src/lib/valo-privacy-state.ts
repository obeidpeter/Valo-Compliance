import {createHmac,createHash,timingSafeEqual} from "node:crypto";
import type {PrivacyStep} from "@workspace/db";
import {ValoProblem} from "./valo-problem";
export type PrivacyStatus="awaiting_verification"|"verified"|"assigned"|"in_progress"|"needs_information"|"held"|"partially_fulfilled"|"fulfilled"|"rejected"|"cancelled"|"failed";
export const terminalPrivacyStatus=(s:PrivacyStatus)=>["fulfilled","rejected","cancelled"].includes(s);
export function assertPrivacyVersion(current:number,expected:number){
  if(current!==expected)throw new ValoProblem(409,"This request changed. Reload its current state before retrying.",current);
}
export function assertPrivacyTransition(from:PrivacyStatus,to:PrivacyStatus){
  const allowed:Record<PrivacyStatus,PrivacyStatus[]>={
    awaiting_verification:["verified","cancelled","needs_information","rejected","held"],
    verified:["assigned","cancelled","needs_information","held","rejected"],
    assigned:["assigned","in_progress","cancelled","needs_information","held","rejected"],
    in_progress:["in_progress","partially_fulfilled","fulfilled","held","failed","needs_information"],
    needs_information:["awaiting_verification","assigned","verified","cancelled","held","rejected"],
    held:["awaiting_verification","verified","assigned","in_progress","partially_fulfilled","cancelled","rejected"],
    partially_fulfilled:["in_progress","partially_fulfilled","fulfilled","held","failed"],
    failed:["in_progress","held","cancelled"],fulfilled:[],rejected:[],cancelled:[],
  };
  if(!allowed[from]?.includes(to))throw new ValoProblem(409,`A ${from.replaceAll("_"," ")} request cannot move to ${to.replaceAll("_"," ")}.`);
}
export function assertPrivacyCompletion(steps:PrivacyStep[]){
  const required=["identity_verification","application","private_files","managed_identity","external_processors","retention_and_recovery"];
  if(steps.length!==required.length||required.some(name=>steps.filter(s=>s.system===name).length!==1)||
    steps.some(s=>!["confirmed","not_applicable"].includes(s.status)||!s.detail.trim())||
    steps.some(s=>["identity_verification","application"].includes(s.system)&&s.status!=="confirmed"))
    throw new ValoProblem(409,"Required systems still have unconfirmed, held or failed outcomes. Partial preparation is not fulfilment.");
}
export type PrivacyAuditInput={caseId:string;workspaceId:string;sequence:number;actorType:"customer"|"staff"|"worker";
  actorHash:string;action:string;reason:string;createdAt:Date;previousHash:string;stateHash:string;keyVersion:string};
/** JSONB may reorder keys; Date values become JSON strings before canonical sorting. */
export function privacySnapshotHash(value:unknown){
  function sorted(v:unknown):unknown{
    if(Array.isArray(v))return v.map(sorted);
    if(v&&typeof v==="object")return Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,x])=>[k,sorted(x)]));
    return v;
  }
  const normalized=JSON.parse(JSON.stringify(value));
  return createHash("sha256").update(JSON.stringify(sorted(normalized))).digest("hex");
}
export function privacyAuditHash(input:PrivacyAuditInput,key:string){
  if(key.length<32)throw Error("PRIVACY_AUDIT_KEY_CONFIGURATION_REQUIRED");
  const bytes=JSON.stringify([input.workspaceId,input.caseId,input.sequence,input.actorType,input.actorHash,
    input.action,input.reason,input.createdAt.toISOString(),input.previousHash,input.stateHash,input.keyVersion]);
  return createHmac("sha256",key).update("valo/privacy/audit/v1\0"+bytes).digest("hex");
}
export function privacyAuditEqual(a:string,b:string){
  return /^[a-f0-9]{64}$/.test(a)&&/^[a-f0-9]{64}$/.test(b)&&timingSafeEqual(Buffer.from(a,"hex"),Buffer.from(b,"hex"));
}
export const privacyInitialSteps=(kind:"correction"|"export"|"deletion"):PrivacyStep[]=>[
  {system:"identity_verification",status:"pending",detail:"The signed-in request has not yet been explicitly verified."},
  {system:"application",status:"pending",detail:kind==="correction"?"No corrected profile revision has been confirmed.":
    kind==="export"?"No application result has been prepared.":"No erasure has begun."},
  {system:"private_files",status:"pending",detail:"Private-file handling has not been checked."},
  {system:"managed_identity",status:"pending",detail:"Managed identity scope and outcome have not been checked."},
  {system:"external_processors",status:"pending",detail:"Provider use and any required coordinated action have not been checked."},
  {system:"retention_and_recovery",status:"pending",detail:"Retention, holds and restoration handling have not been confirmed."},
];
