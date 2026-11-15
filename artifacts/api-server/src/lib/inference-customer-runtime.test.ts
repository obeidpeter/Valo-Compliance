import test from "node:test";
import assert from "node:assert/strict";
import {prepareCustomerEvaluationPlan} from "./inference-customer-evaluation";
import {existingCustomerEvaluationActor,assertCustomerEvaluationActor} from "./inference-customer-runtime";
import {hashAI,customerPromptVersion,customerNoticeVersion} from "./valo-customer-ai-domain";
const actor={workspaceId:"11111111-1111-4111-8111-111111111111",anchorDraftId:"22222222-2222-4222-8222-222222222222",
  identityId:"valo-ai-eval-invoice-controlled"};
test("existing actor, safety and exact historical uncertainty checks make no mutations or provider calls",async t=>{
  const prior=process.env.NODE_ENV;process.env.NODE_ENV="development";
  t.after(()=>{if(prior===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=prior;});
  const plan=await prepareCustomerEvaluationPlan(actor,new Date(Date.now()-5000)),entry=plan.cases[0]!,input=entry.input!;
  const {idempotencyKey,...facts}=input;
  let active=true,paused=false,rows:Record<string,any>[]=[],reads=0;
  const read=async(sql:string)=>{reads++;assert.match(sql,/^select /);assert.doesNotMatch(sql,/insert|update|delete/i);
    if(sql.startsWith("select d.id")){assert.match(sql,/m.active='yes'/);assert.match(sql,/valo_privacy_tombstones/);
      return{rows:active?[{id:actor.anchorDraftId,workspace_id:actor.workspaceId,actor_id:actor.identityId}]:[]};}
    if(sql.startsWith("select enabled"))return{rows:paused?[{enabled:false}]:[]};
    return{rows};
  };
  assert.deepEqual(await existingCustomerEvaluationActor(read),actor);
  assert.deepEqual(await assertCustomerEvaluationActor(plan,entry,read),{reusableExisting:false});
  active=false;assert.equal(await existingCustomerEvaluationActor(read),null);
  await assert.rejects(()=>assertCustomerEvaluationActor(plan,entry,read),/ACTOR_UNAVAILABLE/);active=true;
  paused=true;await assert.rejects(()=>assertCustomerEvaluationActor(plan,entry,read),/SAFETY_SWITCH_HELD/);paused=false;
  const original={id:"controlled",workspace_id:actor.workspaceId,idempotency_key:idempotencyKey,input_hash:hashAI(facts),
    provider_input_hash:entry.providerInputHash,prompt_version:`${customerPromptVersion}/${customerNoticeVersion}`,
    provider_runs:[],status:"running",created_at:new Date()};
  rows=[original];await assertCustomerEvaluationActor(plan,entry,read);
  rows=[{...original,created_at:new Date(Date.now()-10000)}];await assert.rejects(()=>assertCustomerEvaluationActor(plan,entry,read),/COMPLETION_UNKNOWN/);
  rows=[{...original,input_hash:"f".repeat(64)}];await assert.rejects(()=>assertCustomerEvaluationActor(plan,entry,read),/IDEMPOTENCY_BINDING_CHANGED/);
  rows=[{...original,status:"manual_fallback",provider_runs:[{outboundAttempted:true,responseId:null,usage:null}]}];
  await assert.rejects(()=>assertCustomerEvaluationActor(plan,entry,read),/RECEIPT_UNKNOWN/);
  rows=[{...original,status:"manual_fallback"}];await assert.rejects(()=>assertCustomerEvaluationActor(plan,entry,read),/FALLBACK_REQUIRES_REVIEW/);
  rows=[{...original,status:"ready",provider_runs:[{outboundAttempted:true,responseId:"controlled-not-real",model:"gpt-5.4-mini",
    usage:{inputTokens:10,outputTokens:1,totalTokens:11}}]}];paused=true;
  assert.deepEqual(await assertCustomerEvaluationActor(plan,entry,read),{reusableExisting:true});
  rows=[{...rows[0],created_at:new Date(Date.now()-86400001)}];
  await assert.rejects(()=>assertCustomerEvaluationActor(plan,entry,read),/STALE_OR_CHANGED/);
  assert.ok(reads>10);
});
