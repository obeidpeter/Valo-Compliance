import test from "node:test";
import assert from "node:assert/strict";
import {ExternalMonitor,externalMonitorConfiguration,pingExternalMonitor} from "./valo-external-monitor";
import {WorkerHealth} from "./valo-worker-health";

const worker="https://hc-ping.com/11111111-1111-4111-8111-111111111111";
const operations="https://hc-ping.com/22222222-2222-4222-8222-222222222222";
const env={VALO_EXTERNAL_MONITORING:"healthchecks",VALO_WORKER_MONITOR_URL:worker,VALO_OPERATIONS_MONITOR_URL:operations};
const config=externalMonitorConfiguration(env)!;

test("monitoring is optional but partial, ambiguous or redirected destinations fail closed without leaking capabilities",()=>{
  assert.equal(externalMonitorConfiguration({}),null);
  assert.deepEqual(config,{worker,operations});
  for(const vars of [{VALO_WORKER_MONITOR_URL:worker},{...env,VALO_EXTERNAL_MONITORING:"other"},
    {...env,VALO_OPERATIONS_MONITOR_URL:worker},...[
      "http://hc-ping.com/11111111-1111-4111-8111-111111111111",worker+"/",worker+"?create=1",worker+"#secret",
      worker.replace("hc-ping.com","hc-ping.com.evil.invalid"),worker.replace("hc-ping.com","private@hc-ping.com"),
      worker.replace("hc-ping.com","hc-ping.com:443"),worker.replace("hc-ping.com","HC-PING.COM")," "+worker,
      worker.replace("/1111","/../1111"),"https://127.0.0.1/secret",
    ].map(url=>({...env,VALO_WORKER_MONITOR_URL:url}))]){
    assert.throws(()=>externalMonitorConfiguration(vars),{message:"EXTERNAL_MONITOR_CONFIGURATION_INVALID"});
  }
});

test("pings contain no body, follow no redirects and acknowledge only a provider 200",async()=>{
  const calls:Array<{url:string;init:RequestInit|undefined}>=[];
  const transport:typeof fetch=async(url,init)=>{calls.push({url:String(url),init});return new Response("OK");};
  assert.equal(await pingExternalMonitor(config,"worker",true,transport),true);
  assert.equal(await pingExternalMonitor(config,"operations",false,transport),true);
  assert.deepEqual(calls.map(c=>c.url),[worker,operations+"/fail"]);
  for(const call of calls){assert.equal(call.init?.method,"POST");assert.equal(call.init?.redirect,"manual");
    assert.equal(call.init?.body,undefined);assert.equal(call.init?.headers,undefined);assert.ok(call.init?.signal);}
  assert.equal(await pingExternalMonitor(config,"worker",true,async()=>new Response("",{status:302})),false);
  assert.equal(await pingExternalMonitor(config,"worker",true,async()=>{throw Error(worker+" SECRET");}),false);
});

test("worker and operation signals fail for stale health, active alerts and a replaced child",async()=>{
  let now=Date.now();const calls:string[]=[],events:unknown[]=[];
  const monitor=new ExternalMonitor(config,event=>events.push(event),async url=>{calls.push(String(url));return new Response("OK");},()=>now);
  const health=new WorkerHealth(()=>now);
  const ready=()=>{const start=health.begin()!;health.finish(start,true);monitor.observeWorker(health.snapshot());};
  const sample=(healthy=true)=>monitor.observeOperations({healthy,checkedAt:new Date(now).toISOString()});
  await monitor.tick();assert.deepEqual(calls.splice(0),[worker+"/fail",operations+"/fail"]);
  ready();sample();await monitor.tick();assert.deepEqual(calls.splice(0),[worker,operations]);
  health.fail();monitor.observeWorker(health.snapshot());ready();
  await monitor.tick();assert.deepEqual(calls.splice(0),[worker,operations+"/fail"]);
  sample(false);await monitor.tick();assert.deepEqual(calls.splice(0),[worker,operations+"/fail"]);
  sample();now+=90_001;await monitor.tick();assert.deepEqual(calls.splice(0),[worker+"/fail",operations+"/fail"]);
  now+=30_000;ready();await monitor.tick();assert.deepEqual(calls.splice(0),[worker,operations+"/fail"]);
  sample();monitor.observeWorker(null);ready();await monitor.tick();assert.deepEqual(calls.splice(0),[worker,operations+"/fail"]);
  monitor.observeOperations({healthy:true,checkedAt:new Date(now+1).toISOString()});
  await monitor.tick();assert.deepEqual(calls.splice(0),[worker,operations+"/fail"]);
  assert.ok(!JSON.stringify(events).includes("hc-ping"));await monitor.stop();
});

test("disabled monitoring never calls the network; overlapping ticks and shutdown are bounded",async()=>{
  let calls=0;const events:unknown[]=[];
  const disabled=new ExternalMonitor(null,()=>{},async()=>{throw Error("must not call");});
  disabled.start();await disabled.tick();await disabled.stop();
  const monitor=new ExternalMonitor(config,event=>events.push(event),async(_url,init)=>{
    calls++;return new Promise<Response>((_resolve,reject)=>{
      init!.signal!.addEventListener("abort",()=>reject(Error("private transport details")),{once:true});
    });
  });
  const first=monitor.tick();await monitor.tick();assert.equal(calls,2);
  await monitor.stop();await first;await monitor.tick();assert.equal(calls,2);assert.deepEqual(events,[]);
});
