import test from "node:test";
import assert from "node:assert/strict";
import {dispatchOperationalJobs} from "./valo-operational-dispatch";
test("failed or waiting reminders cannot stop payment events, refunds or reconciliation",async()=>{
  const called:string[]=[];let release!:()=>void;
  const waiting=new Promise<void>(resolve=>{release=resolve;});
  const run=dispatchOperationalJobs({
    reminders:async()=>{await waiting;throw Error("CONTROLLED_REMINDER_FAILURE");},
    events:async()=>{called.push("events");},
    refunds:async()=>{called.push("refunds");},
    reconciliation:async()=>{called.push("reconciliation");},
  });
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(called,["events","refunds","reconciliation"]);
  release();assert.deepEqual(await run,["reminders"]);
  assert.deepEqual(await dispatchOperationalJobs({a:async()=>{},b:async()=>{}}),[]);
});
