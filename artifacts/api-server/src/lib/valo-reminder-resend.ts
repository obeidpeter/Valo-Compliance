import {ReplitConnectors} from "@replit/connectors-sdk";
import {clerkClient} from "@clerk/express";
import {z} from "zod";
import {sha256} from "@workspace/valo-core";
import {trustedSiteOrigin} from "./valo-site-origin";
import type {ReminderSender} from "./valo-reminder-worker";

const envelope=z.email().max(254);
type Config={from:string;recipient:string;origin:string};
type Proxy=(path:string,options:{method:string;body:string;headers:Record<string,string>;signal:AbortSignal})=>Promise<Response>;
export function reminderEmailConfiguration(env:NodeJS.ProcessEnv=process.env):Config|null{
  // This adapter cannot enable production email or arbitrary-recipient sending.
  if(env.NODE_ENV!=="development"||!!env.REPLIT_DEPLOYMENT||env.VALO_EMAIL_MODE!=="development-test")return null;
  const from=envelope.safeParse(env.VALO_EMAIL_FROM),to=envelope.safeParse(env.VALO_EMAIL_TEST_RECIPIENT);
  const origin=trustedSiteOrigin(env);
  if(!from.success||!to.success||!origin?.startsWith("https://"))return null;
  return{from:from.data,recipient:to.data.toLowerCase(),origin};
}
export function createResendReminderSender(config:Config,proxy:Proxy,
  verifiedRecipient:(identityId:string)=>Promise<string|null>,env:NodeJS.ProcessEnv=process.env):ReminderSender{
  return{
    // Resend retains idempotency keys for 24 hours. Stop conservatively before
    // expiry: an unknown old outcome must never become a fresh send.
    replayWindowMs:23*60*60*1000,
    async send(input){
      if(env.NODE_ENV!=="development"||!!env.REPLIT_DEPLOYMENT)throw Error("EMAIL_DEVELOPMENT_ONLY");
      const recipient=await verifiedRecipient(input.ownerIdentityId);
      if(!recipient||recipient.toLowerCase()!==config.recipient)throw Error("EMAIL_TEST_RECIPIENT_NOT_AUTHORIZED");
      const key=`valo-reminder-v1-${sha256(input.idempotencyKey)}`;
      const response=await proxy("/emails",{method:"POST",signal:input.signal,
        headers:{"Content-Type":"application/json","Idempotency-Key":key},
        body:JSON.stringify({from:`Valo <${config.from}>`,to:[recipient],
          subject:"Your Valo task reminder",
          // Do not send document bodies, task notes, names or raw task titles.
          // Date and stable configured URL keep retries byte-identical.
          text:`You opted in to Valo task reminders.\n\nA task has the confirmed due date ${input.dueDate} (Africa/Lagos).\nOpen Valo to view your tasks: ${config.origin}/\n\nYou can turn off reminders in your Valo notification preferences. This message is a development test, not a regulatory confirmation.`,
          tags:[{name:"purpose",value:"development_task_reminder"},{name:"notification_ref",value:sha256(input.idempotencyKey)}]})});
      if(!response.ok)throw Error(response.status===429?"EMAIL_PROVIDER_RATE_LIMITED":"EMAIL_PROVIDER_NOT_ACCEPTED");
      const text=await response.text();
      if(Buffer.byteLength(text,"utf8")>8192)throw Error("EMAIL_PROVIDER_RESPONSE_TOO_LARGE");
      const result=z.object({id:z.uuid()}).parse(JSON.parse(text));
      return{providerMessageId:result.id}; // Acceptance only, never delivery.
    },
  };
}
export function automaticReminderDeliveryReady(env:NodeJS.ProcessEnv=process.env){
  return env.VALO_EMAIL_OUTBOX_ENABLED==="development-test"&&reminderEmailConfiguration(env)!==null;
}
export function configuredReminderSender():ReminderSender|null{
  // Supplying a sender/test address must not silently release an existing
  // backlog. Automatic dispatch is a separate, default-off safety switch.
  if(!automaticReminderDeliveryReady())return null;
  const config=reminderEmailConfiguration();
  if(!config)return null;
  const connectors=new ReplitConnectors();
  return createResendReminderSender(config,(path,options)=>connectors.proxy("resend",path,options),async identityId=>{
    const user=await clerkClient.users.getUser(identityId);
    if(user.banned||user.locked)return null;
    const primary=user.emailAddresses.find(email=>email.id===user.primaryEmailAddressId);
    return primary?.verification?.status==="verified"?primary.emailAddress:null;
  });
}
