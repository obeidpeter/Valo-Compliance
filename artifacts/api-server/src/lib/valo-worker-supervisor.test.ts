import test from "node:test";
import assert from "node:assert/strict";
import {spawn, type ChildProcess} from "node:child_process";
import {superviseWorker, supervisorTiming} from "./valo-worker-supervisor";

const timing = {...supervisorTiming, pollMs: 10, startupMs: 2000, unhealthyMs: 50,
  drainMs: 150, killMs: 1000, restartBaseMs: 30, restartMaxMs: 60, maxRestarts: 1};
// Allow for sub-millisecond differences between Windows child/parent wall clocks.
const healthy = `const heartbeat={version:2,instanceId:'11111111-1111-4111-8111-111111111111',phase:'running',lastSuccessAt:new Date(Date.now()-1000).toISOString(),dispatchStartedAt:null,dispatches:1};
process.send({type:'valo.worker.health',heartbeat});`;
function child(code: string) {
  return spawn(process.execPath, ["-e", code], {env: {}, stdio: ["ignore", "ignore", "ignore", "ipc"]});
}
function harness() {
  const controller = new AbortController(), children: ChildProcess[] = [];
  const events: Array<{event: string; reason?: string}> = [];
  return {controller, children, events, cleanup: () => {controller.abort(); for (const c of children) c.kill("SIGKILL");}};
}
test("crashed child is reaped before replacement; shutdown never launches another", {timeout: 10_000}, async () => {
  const h = harness();
  try {
    const code = await superviseWorker({signal: h.controller.signal, timing,
      launch: () => {
        for (const old of h.children) assert.ok(old.exitCode !== null || old.signalCode !== null);
        const c = child(h.children.length ? "process.on('SIGTERM',()=>process.exit(0));" + healthy + "setInterval(()=>{},1000)" : "process.exit(1)");
        h.children.push(c); return c;
      }, report: e => {h.events.push(e); if (e.event === "worker_supervisor.ready") h.controller.abort();}});
    assert.equal(code, process.platform === "win32" ? 1 : 0); assert.equal(h.children.length, 2);
    assert.equal(h.events.filter(e => e.event === "worker_supervisor.restart").length, 1);
    assert.ok(h.children.every(c => c.exitCode !== null || c.signalCode !== null));
  } finally {h.cleanup();}
});
test("failed readiness recycles a worker even if its process remains alive", {timeout: 10_000}, async () => {
  const h = harness();
  try {
    const code = await superviseWorker({signal: h.controller.signal, timing: {...timing, maxRestarts: 0},
      launch: () => {const c = child(healthy + "setTimeout(()=>process.send({type:'valo.worker.health',heartbeat:{...heartbeat,phase:'failed'}}),30);setInterval(()=>{},1000)");h.children.push(c);return c;},
      report: e => h.events.push(e)});
    assert.equal(code, 1); assert.equal(h.children.length, 1);
    assert.ok(h.events.some(e => e.event === "worker_supervisor.stopping" && e.reason === "unhealthy"));
  } finally {h.cleanup();}
});
test("a stuck startup is killed after its drain deadline and restart budget is bounded", {timeout: 10_000}, async () => {
  const h = harness();
  try {
    const code = await superviseWorker({signal: h.controller.signal, timing: {...timing, startupMs: 300},
      launch: () => {const c = child("process.on('SIGTERM',()=>{});setInterval(()=>{},1000)");h.children.push(c);return c;},
      report: e => h.events.push(e)});
    assert.equal(code, 1); assert.equal(h.children.length, 2);
    assert.ok(h.events.some(e => e.event === "worker_supervisor.exhausted"));
    assert.ok(h.children.every(c => c.exitCode !== null || c.signalCode !== null));
    if (process.platform !== "win32") assert.ok(h.children.every(c => c.signalCode === "SIGKILL"));
  } finally {h.cleanup();}
});
test("shutdown interrupts restart backoff; spawning errors exhaust the same budget", {timeout: 10_000}, async () => {
  const h = harness(); let launches = 0;
  const code = await superviseWorker({signal: h.controller.signal, timing,
    launch: () => {launches++;throw Error("PRIVATE_PROVIDER_DETAIL_MUST_NOT_BE_LOGGED");},
    report: e => {h.events.push(e);if(e.event === "worker_supervisor.restart")h.controller.abort();}});
  assert.equal(code, 0); assert.equal(launches, 1);
  assert.ok(!JSON.stringify(h.events).includes("PRIVATE_PROVIDER"));
  const second = new AbortController(); launches = 0;
  assert.equal(await superviseWorker({signal: second.signal, timing, launch: () => {launches++;throw Error("synthetic");}, report: () => {}}), 1);
  assert.equal(launches, 2);
});
test("SIGTERM allows an in-flight child to finish before supervisor exits", {skip: process.platform === "win32", timeout: 10_000}, async () => {
  const h = harness();
  try {
    const code = await superviseWorker({signal: h.controller.signal, timing: {...timing, drainMs: 1000},
      launch: () => {const c = child("process.on('SIGTERM',()=>setTimeout(()=>process.exit(0),100));" + healthy + "setInterval(()=>{},1000)");h.children.push(c);return c;},
      report: e => {if(e.event === "worker_supervisor.ready")h.controller.abort();}});
    assert.equal(code, 0); assert.equal(h.children[0].exitCode, 0); assert.equal(h.children[0].signalCode, null);
  } finally {h.cleanup();}
});
test("unconfirmed process termination fails closed without launching a replacement", {timeout: 10_000}, async () => {
  const controller=new AbortController();let launched=0;
  const c=child("setInterval(()=>{},1000)"),kill=c.kill.bind(c);
  c.kill=()=>false;
  try{
    assert.equal(await superviseWorker({signal:controller.signal,
      timing:{...timing,startupMs:50,drainMs:30,killMs:30},
      launch:()=>{launched++;return c;},report:()=>{}}),1);
    assert.equal(launched,1);
  }finally{kill("SIGKILL");await new Promise<void>(resolve=>c.once("exit",()=>resolve()));}
});
test("failed or forced shutdown is never reported as a clean drain", {timeout: 10_000}, async () => {
  const h=harness();
  try{
    assert.equal(await superviseWorker({signal:h.controller.signal,timing,
      launch:()=>{const c=child("process.on('SIGTERM',()=>process.exit(2));"+healthy+"setInterval(()=>{},1000)");h.children.push(c);return c;},
      report:e=>{h.events.push(e);if(e.event==="worker_supervisor.ready")h.controller.abort();}}),1);
    assert.ok(h.events.some(e=>e.reason==="shutdown_failed"));assert.equal(h.children.length,1);
  }finally{h.cleanup();}
});

test("only the supervised child supplies monitoring state; shutdown clears it before completion",{timeout:10_000},async()=>{
  const h=harness(),observed:Array<string|null>=[],operations:unknown[]=[];
  try{
    await superviseWorker({signal:h.controller.signal,timing,
      launch:()=>{const c=child("process.send({type:'valo.worker.operations',healthy:true,checkedAt:new Date().toISOString()});"+
        healthy+"setInterval(()=>{},1000)");h.children.push(c);return c;},
      observeWorker:value=>observed.push(value?.instanceId??null),observeOperations:value=>operations.push(value),
      report:e=>{if(e.event==="worker_supervisor.ready")h.controller.abort();}});
    assert.equal(operations.length,1);assert.equal(observed[0],null);
    const readyIndex=observed.indexOf("11111111-1111-4111-8111-111111111111");assert.ok(readyIndex>=0);
    assert.ok(observed.slice(readyIndex+1).length>0);assert.ok(observed.slice(readyIndex+1).every(v=>v===null));
  }finally{h.cleanup();}
});
