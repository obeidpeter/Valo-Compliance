import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {resolve} from "node:path";
const candidate={NODE_ENV:"production",PRIVATE_OBJECT_DIR:"/synthetic-bucket/development",VALO_PRODUCTION_PRIVATE_OBJECT_DIR:"/synthetic-bucket/production",
  VALO_WORKER_TOPOLOGY:"replit-reserved-vm-same-app",VALO_WORKER_REPLICAS:"1",VALO_RELEASE_SHA:"a".repeat(40),VALO_WORKER_HEALTH_PORT:"8082",PORT:"8080"};
function invoke(file:string,env:Record<string,string>,args:string[]=[]){
  const child=spawnSync(process.execPath,[resolve("dist",file+".mjs"),...args],{env,encoding:"utf8",timeout:10000});
  assert.equal(child.error,undefined);return child;
}
test("built preflight distinguishes configuration from launch and never echoes storage roots",()=>{
  const pending=invoke("production-preflight",candidate);assert.equal(pending.status,2,pending.stderr);
  const report=JSON.parse(pending.stdout);assert.equal(report.configurationValid,true);assert.equal(report.launchReady,false);
  assert.ok(!pending.stdout.includes("synthetic-bucket"));
  const configuration=invoke("production-preflight",candidate,["--configuration-only"]);assert.equal(configuration.status,0,configuration.stderr);
  assert.equal(invoke("production-preflight",{NODE_ENV:"production"}).status,1);
});
test("shipped worker still refuses production before starting work and probe requires explicit opt-in",()=>{
  const worker=invoke("export-worker",{...candidate,DATABASE_URL:"postgresql://synthetic@127.0.0.1:1/must_not_connect",SESSION_SECRET:"synthetic-only-no-external-calls"});
  assert.equal(worker.status,1);assert.match(worker.stderr,/Exports remain disabled pending production storage, worker, recovery and privacy approval/);
  assert.doesNotMatch(worker.stdout,/worker_started|worker_ready/);
  const supervisor=invoke("export-supervisor",candidate);
  assert.equal(supervisor.status,1);assert.match(supervisor.stderr,/Explicit non-deployed development is required/);
  assert.doesNotMatch(supervisor.stdout,/worker_supervisor.started/);
  const probe=invoke("production-storage-probe",candidate,["--start"]);assert.equal(probe.status,1);assert.match(probe.stderr,/EXPLICIT_STORAGE_PROBE_REQUIRED/);assert.equal(probe.stdout,"");
});
