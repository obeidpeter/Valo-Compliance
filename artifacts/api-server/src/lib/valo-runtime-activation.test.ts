import test from "node:test";
import assert from "node:assert/strict";
import {rehearsalConfiguration,verifyRehearsalDatabase,assertApplicationRuntime} from "./valo-runtime-activation";
const env={NODE_ENV:"production",PRIVATE_OBJECT_DIR:"/synthetic-bucket/development",VALO_PRODUCTION_PRIVATE_OBJECT_DIR:"/synthetic-bucket/production",
  VALO_WORKER_TOPOLOGY:"replit-reserved-vm-same-app",VALO_WORKER_REPLICAS:"1",VALO_RELEASE_SHA:"a".repeat(40),VALO_WORKER_HEALTH_PORT:"8082",PORT:"8080",
  VALO_RUNTIME_ACTIVATION:"private-rehearsal-v1",VALO_PRODUCTION_DATABASE_ID:"11111111-1111-4111-8111-111111111111",
  VALO_EXTERNAL_MONITORING:"healthchecks",VALO_WORKER_MONITOR_URL:"https://hc-ping.com/"+"11111111-1111-4111-8111-111111111111",VALO_OPERATIONS_MONITOR_URL:"https://hc-ping.com/"+"22222222-2222-4222-8222-222222222222",
  SESSION_SECRET:"synthetic-production-rehearsal-only-key",
  VALO_CUSTOMER_AI_ENABLED:"false",VALO_SANDBOX_CHECKOUT_ENABLED:"false",VALO_SANDBOX_REFUNDS_ENABLED:"false",VALO_SANDBOX_DISPUTES_ENABLED:"false"};
test("production activation cannot be granted by configuration inspection or a development copy",async()=>{
  const config=rehearsalConfiguration(env);
  const marker={instance_id:config.databaseId,environment:"production-rehearsal",storage_fingerprint:config.storageFingerprint};
  let actual=marker,unsafe=false,queueMissing=false;
  const query=async(sql:string)=>({rows:sql.includes("valo_runtime_identity")?[actual]:sql.includes(" AS unsafe")?[{unsafe}]:queueMissing?[]:[
    {name:"valo-manual-export-v1",retry_limit:2,expire_seconds:120},{name:"valo-workspace-data-v1",retry_limit:0,expire_seconds:360}]});
  assert.equal((await verifyRehearsalDatabase(query,env)).customerTrafficEnabled,false);
  for(const changed of [{environment:"development"},{instance_id:"other"},{storage_fingerprint:"0".repeat(64)}]){
    actual={...marker,...changed};await assert.rejects(verifyRehearsalDatabase(query,env),/IDENTITY_MISMATCH/);
  }
  actual=marker;unsafe=true;await assert.rejects(verifyRehearsalDatabase(query,env),/FIXTURE_ONLY/);
  unsafe=false;queueMissing=true;await assert.rejects(verifyRehearsalDatabase(query,env),/QUEUE_PREFLIGHT/);
  for(const name of ["VALO_CUSTOMER_AI_ENABLED","VALO_SANDBOX_CHECKOUT_ENABLED","VALO_SANDBOX_REFUNDS_ENABLED","VALO_SANDBOX_DISPUTES_ENABLED"])
    for(const value of [undefined,"true"])assert.throws(()=>rehearsalConfiguration({...env,[name]:value}),/EFFECTS_MUST_BE_DISABLED/);
  assert.throws(()=>rehearsalConfiguration({...env,VALO_ISOLATED_RECOVERY:"synthetic-local-only"}),/RECOVERY_CANNOT/);
  const saved={...process.env};
  try{Object.assign(process.env,env);assert.throws(assertApplicationRuntime,/RUNTIME_NOT_VERIFIED/);}
  finally{for(const key of Object.keys(env))if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}
});
