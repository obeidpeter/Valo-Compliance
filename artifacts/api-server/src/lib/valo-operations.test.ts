import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,readFile,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {collectOperationalSample,recordOperationalAlerts,recordWorkerHeartbeat,readinessQueries} from "./valo-operations";
import {versionedEvidencePath} from "./versioned-evidence-path";
import {WorkerHealth} from "./valo-worker-health";
test("operator report names reject traversal and non-integer versions",()=>{
  for(const version of ["../../private","7","1000000","1.5",NaN,Infinity,0,-1,1.5,1000001,Number.MAX_SAFE_INTEGER,1e21,null,undefined,{},[],true])
    assert.throws(()=>versionedEvidencePath("/synthetic/root",version),/INVALID_EVIDENCE_VERSION/);
  assert.equal(versionedEvidencePath("/synthetic/root",7),resolve("/synthetic/root/docs/valo/evidence/operational-publication-v7.json"));
  for(const boundary of[1,1000000])
    assert.equal(versionedEvidencePath("/synthetic/root",boundary),resolve(`/synthetic/root/docs/valo/evidence/operational-publication-v${boundary}.json`));
});
test("internal probes measure failures independently and persist/deduplicate/recover alerts without transports",async()=>{
  const old=process.env.NODE_ENV;process.env.NODE_ENV="development";
  const originalFetch=globalThis.fetch;let externalCalls=0;
  globalThis.fetch=async()=>{externalCalls++;throw Error("EXTERNAL_MESSAGES_FORBIDDEN");};
  const dir=await mkdtemp(join(tmpdir(),"valo-ops-"));
  const worker=new WorkerHealth();worker.finish(worker.begin()!,true);
  try{
    await recordWorkerHeartbeat(worker.snapshot(),dir);
    const failures=await collectOperationalSample(async sql=>{
      if(sql===readinessQueries.database)throw Error("SYNTHETIC_PRIVATE_DB_ERROR");
      return{rows:[{value:sql===readinessQueries.payments?2:101}]};
    },dir);
    assert.equal(failures.database.status,"unavailable");assert.equal(failures.worker.status,"healthy");
    assert.equal(failures.payments.value,2);
    const parallel=await Promise.all(Array.from({length:32},()=>recordOperationalAlerts(failures,dir)));
    assert.equal(parallel.reduce((n,r)=>n+r.emitted,0),5);
    let history=JSON.parse(await readFile(join(dir,"alerts.json"),"utf8"));
    assert.equal(history.events.length,5);assert.ok(history.active.includes("WORKSPACE_CLEANUP_BACKLOG"));assert.ok(!JSON.stringify(history).includes("SYNTHETIC_PRIVATE"));
    await writeFile(join(dir,"worker.json"),JSON.stringify({at:new Date(Date.now()-100000).toISOString(),pid:process.pid}));
    const stale=await collectOperationalSample(async sql=>({rows:[{value:sql===readinessQueries.database?1:0}]}),dir);
    assert.equal(stale.worker.status,"stale");
    await recordOperationalAlerts(stale,dir);
    worker.finish(worker.begin()!,true);await recordWorkerHeartbeat(worker.snapshot(),dir);
    const healthy=await collectOperationalSample(async sql=>({rows:[{value:sql===readinessQueries.database?1:0}]}),dir);
    assert.deepEqual((await recordOperationalAlerts(healthy,dir)).active,[]);
    history=JSON.parse(await readFile(join(dir,"alerts.json"),"utf8"));
    assert.equal(history.events.filter((r:{state:string})=>r.state==="resolved").length,6);
    await writeFile(join(dir,"alerts.json"),"{bad");
    await assert.rejects(()=>recordOperationalAlerts(healthy,dir),/INTERNAL_ALERT_HISTORY_UNREADABLE/);
    await writeFile(join(dir,"alerts.json"),JSON.stringify(history));
    assert.equal((await recordOperationalAlerts(healthy,dir)).emitted,0,"a failed local write must not poison later queued work");
    await writeFile(join(dir,"worker.json"),"{bad");
    assert.equal((await collectOperationalSample(async()=>({rows:[{value:0}]}),dir)).worker.status,"unavailable");
    worker.finish(worker.begin()!,false);await recordWorkerHeartbeat(worker.snapshot(),dir);
    assert.equal((await collectOperationalSample(async()=>({rows:[{value:1}]}),dir)).worker.status,"unavailable","a fresh timestamp cannot hide a failed dispatch");
    assert.equal(externalCalls,0);
  }finally{globalThis.fetch=originalFetch;await rm(dir,{recursive:true,force:true});if(old===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=old;}
});
