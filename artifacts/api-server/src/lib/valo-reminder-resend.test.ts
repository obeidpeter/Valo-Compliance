import test from "node:test";
import assert from "node:assert/strict";
import {reminderEmailConfiguration,createResendReminderSender,automaticReminderDeliveryReady} from "./valo-reminder-resend";
const env={NODE_ENV:"development",VALO_EMAIL_MODE:"development-test",VALO_EMAIL_FROM:"sender@synthetic.invalid",
  VALO_EMAIL_TEST_RECIPIENT:"owner@synthetic.invalid",VALO_TRUSTED_ORIGIN:"https://valo.synthetic.invalid"};
const config=reminderEmailConfiguration(env)!;
const input={idempotencyKey:"synthetic-task/2026-11-20/1",ownerIdentityId:"synthetic-owner",
  title:"PRIVATE TASK TITLE",dueDate:"2026-11-20",timezone:"Africa/Lagos" as const,signal:new AbortController().signal};
const id="6ddc3cb1-a114-4a93-9c72-39f5720856bb";
test("real sending is disabled without complete development-only settings",()=>{
  assert.equal(reminderEmailConfiguration({}),null);
  assert.equal(reminderEmailConfiguration({...env,NODE_ENV:"production"}),null);
  assert.equal(reminderEmailConfiguration({...env,REPLIT_DEPLOYMENT:"1"}),null);
  assert.equal(reminderEmailConfiguration({...env,VALO_EMAIL_MODE:undefined}),null);
  assert.equal(reminderEmailConfiguration({...env,VALO_EMAIL_FROM:"a@b.invalid\r\nBcc:elsewhere@example.invalid"}),null);
  assert.equal(reminderEmailConfiguration({...env,VALO_TRUSTED_ORIGIN:"http://synthetic.invalid"}),null);
  assert.equal(automaticReminderDeliveryReady(env),false,"Addresses must not release an existing backlog");
  assert.equal(automaticReminderDeliveryReady({...env,VALO_EMAIL_OUTBOX_ENABLED:"development-test"}),true);
  assert.equal(automaticReminderDeliveryReady({...env,NODE_ENV:"production",VALO_EMAIL_OUTBOX_ENABLED:"development-test"}),false);
});
test("only the selected verified workspace owner's allowlisted email can reach transport",async()=>{
  let calls=0;
  for(const recipient of [null,"other@synthetic.invalid"]){
    const sender=createResendReminderSender(config,async()=>{calls++;return Response.json({id});},async()=>recipient,env);
    await assert.rejects(()=>sender.send(input),/RECIPIENT_NOT_AUTHORIZED/);
  }
  assert.equal(calls,0);
});
test("controlled acceptance preserves one bounded provider key and minimal stable body, not inbox delivery",async()=>{
  const requests:{body:string;headers:Record<string,string>}[]=[];
  const sender=createResendReminderSender(config,async(path,options)=>{
    assert.equal(path,"/emails");assert.equal(options.method,"POST");assert.equal(options.signal,input.signal);
    requests.push(options);return Response.json({id});
   },async()=>config.recipient,env);
  assert.deepEqual(await sender.send(input),{providerMessageId:id});
  await sender.send({...input,title:"RENAMED PRIVATE TITLE"});
  assert.equal(requests[0].body,requests[1].body);
  assert.equal(requests[0].headers["Idempotency-Key"],requests[1].headers["Idempotency-Key"]);
  assert.ok(requests[0].headers["Idempotency-Key"].length<=256);
  assert.equal(requests[0].headers.Authorization,undefined);
  const body=JSON.parse(requests[0].body);
  assert.deepEqual(body.to,[config.recipient]);
  assert.ok(!requests[0].body.includes("PRIVATE")&&!requests[0].body.includes(input.ownerIdentityId));
  assert.ok(!("attachments" in body)&&!("bcc" in body)&&!("deliveredAt" in body));
  assert.equal(sender.replayWindowMs,23*60*60*1000);
});
test("controlled provider rate failure, oversized data and invalid acknowledgement never become accepted",async()=>{
  for(const response of [
    new Response("untrusted response",{status:429}),
    new Response("x".repeat(8193)),Response.json({id:"not-a-provider-id"}),
  ]){
    const sender=createResendReminderSender(config,async()=>response,async()=>config.recipient,env);
    await assert.rejects(()=>sender.send(input));
  }
});
test("every nonempty deployment marker and production reject before transport, including after sender construction",async()=>{
  let calls=0;
  const runtime:NodeJS.ProcessEnv={...env};
  const sender=createResendReminderSender(config,async()=>{calls++;return Response.json({id});},async()=>config.recipient,runtime);
  for(const marker of ["1","0","false","true","production"," ","\t"]){
    runtime.REPLIT_DEPLOYMENT=marker;
    assert.equal(reminderEmailConfiguration(runtime),null);
    assert.equal(automaticReminderDeliveryReady({...runtime,VALO_EMAIL_OUTBOX_ENABLED:"development-test"}),false);
    await assert.rejects(()=>sender.send(input),/EMAIL_DEVELOPMENT_ONLY/);
  }
  delete runtime.REPLIT_DEPLOYMENT;runtime.NODE_ENV="production";
  await assert.rejects(()=>sender.send(input),/EMAIL_DEVELOPMENT_ONLY/);
  assert.equal(calls,0);
  runtime.NODE_ENV="development";runtime.VALO_ISOLATED_RECOVERY="synthetic-local-only";
  await assert.rejects(()=>sender.send(input),/RECOVERY_EXTERNAL_EFFECTS_DISABLED/);
  assert.equal(calls,0);
});
