/** Real production-mode API/worker on a disposable Linux DB. No provider credentials. */
import {execFile,spawn,type ChildProcess} from "node:child_process";
import {promisify} from "node:util";
import {mkdtemp,mkdir,readFile,writeFile,rm,open} from "node:fs/promises";
import {tmpdir,userInfo} from "node:os";
import {join,resolve} from "node:path";
import {randomBytes} from "node:crypto";
import {Client} from "pg";
import assert from "node:assert/strict";
import {rehearsalConfiguration,verifyRehearsalDatabase} from "../lib/valo-runtime-activation";
import {assignEmptyRehearsalDatabase,prepareEmptyRehearsalQueue} from "../lib/valo-production-bootstrap";
const exec=promisify(execFile),root=resolve(import.meta.dirname,"../../../..");
assert.equal(process.platform,"linux");
const directory=await mkdtemp(join(tmpdir(),"valo-production-drill-")),data=join(directory,"data"),user=userInfo().username;
assert.match(user,/^[a-z_][a-z0-9_-]*$/);
const env:NodeJS.ProcessEnv={PATH:process.env.PATH,HOME:directory,NODE_ENV:"development",PGHOST:directory,PGPORT:"58464",PGUSER:user,
  PGDATABASE:"postgres",DATABASE_URL:`postgresql://${user}@localhost:58464/valo_rehearsal?host=${encodeURIComponent(directory)}`};
const options={env,cwd:root,maxBuffer:2000000};
const report:Record<string,unknown>={scope:"disposable-production-mode-runtime",managedDatabaseRead:false,providerCalls:0,customerTrafficEnabled:false};
let running=false,database:Client|undefined,api:ChildProcess|undefined,worker:ChildProcess|undefined;
const logs:Awaited<ReturnType<typeof open>>[]=[];
async function child(name:string,vars:NodeJS.ProcessEnv){
  const log=await open(join(directory,name+".log"),"w",0o600);logs.push(log);
  return spawn(process.execPath,[join(root,"artifacts/api-server/dist",name+".mjs")],{cwd:directory,env:vars,stdio:["ignore",log.fd,log.fd]});
}
async function stop(child:ChildProcess|undefined){
  if(!child||child.exitCode!==null)return;
  child.kill("SIGTERM");
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{await Promise.race([new Promise<void>(done=>child.once("exit",()=>done())),new Promise<never>((_,reject)=>{
    timer=setTimeout(()=>{child.kill("SIGKILL");reject(Error("RUNTIME_DRAIN_FAILED"));},85000);timer.unref();
  })]);}finally{clearTimeout(timer);}
  assert.equal(child.exitCode,0);
}
async function ready(port:number,path:string,process:ChildProcess){
  for(let n=0;n<120;n++){
    if(process.exitCode!==null)throw Error("RUNTIME_EXITED_BEFORE_READY");
    try{const r=await fetch(`http://127.0.0.1:${port}${path}`,{signal:AbortSignal.timeout(500)});if(r.status===200){await r.body?.cancel();return;}}catch{}
    await new Promise(r=>setTimeout(r,250));
  }throw Error("RUNTIME_READY_TIMEOUT");
}
try{
  report.phase="fresh-schema";
  await exec("initdb",["-D",data,"--auth=trust","--no-locale"],options);
  await exec("pg_ctl",["-D",data,"-l",join(directory,"postgres.log"),"-o",`-k ${directory} -h '' -p 58464`,"-w","start"],options);running=true;
  const admin=new Client({host:directory,port:58464,user,database:"postgres"});
  try{await admin.connect();await admin.query("CREATE DATABASE valo_rehearsal");}finally{await admin.end();}
  await exec("pnpm",["--filter","@workspace/db","exec","drizzle-kit","migrate","--config","./drizzle.config.ts"],options);
  const construction=await readFile(join(root,"lib/db/drizzle/pg-boss-development.sql"),"utf8");
  database=new Client({host:directory,port:58464,user,database:"valo_rehearsal"});
  database.on("error",()=>{report.databaseConnectionFailed=true;process.exitCode=1;});
  await database.connect();
  const marker=(await database.query("SELECT * FROM valo_runtime_identity")).rows[0];assert.equal(marker.environment,"development");
  const prod={...env,NODE_ENV:"production",PORT:"8095",VALO_WORKER_HEALTH_PORT:"8096",SESSION_SECRET:randomBytes(32).toString("hex"),
    PRIVATE_OBJECT_DIR:"/synthetic-bucket/development",VALO_PRODUCTION_PRIVATE_OBJECT_DIR:"/synthetic-bucket/production",
    VALO_WORKER_TOPOLOGY:"replit-reserved-vm-same-app",VALO_WORKER_REPLICAS:"1",VALO_RELEASE_SHA:"a".repeat(40),
    VALO_RUNTIME_ACTIVATION:"private-rehearsal-v1",VALO_PRODUCTION_DATABASE_ID:marker.instance_id,
    VALO_EXTERNAL_MONITORING:"healthchecks",VALO_WORKER_MONITOR_URL:"https://hc-ping.com/"+"11111111-1111-4111-8111-111111111111",VALO_OPERATIONS_MONITOR_URL:"https://hc-ping.com/"+"22222222-2222-4222-8222-222222222222",
    VALO_CUSTOMER_AI_ENABLED:"false",VALO_SANDBOX_CHECKOUT_ENABLED:"false",VALO_SANDBOX_REFUNDS_ENABLED:"false",VALO_SANDBOX_DISPUTES_ENABLED:"false",
    VALO_EMPTY_DATABASE_BOOTSTRAP:"approved-empty-rehearsal"};
  report.phase="database-binding";
  await assert.rejects(verifyRehearsalDatabase(s=>database!.query(s),prod),/IDENTITY_MISMATCH/);
  const c=database;
  report.phase="bootstrap-rollback";
  await c.query("BEGIN");await prepareEmptyRehearsalQueue((s,v)=>c.query(s,v),prod,construction);await assignEmptyRehearsalDatabase((s,v)=>c.query(s,v),prod);await c.query("ROLLBACK");
  assert.equal((await c.query("SELECT environment FROM valo_runtime_identity")).rows[0].environment,"development");
  assert.equal((await c.query("SELECT to_regnamespace('valo_jobs') AS schema")).rows[0].schema,null);
  report.phase="bootstrap-commit";
  await c.query("BEGIN");await prepareEmptyRehearsalQueue((s,v)=>c.query(s,v),prod,construction);await assignEmptyRehearsalDatabase((s,v)=>c.query(s,v),prod);await c.query("COMMIT");
  await c.query("BEGIN");await assert.rejects(assignEmptyRehearsalDatabase((s,v)=>c.query(s,v),prod),/NEW_DATABASE_IDENTITY/);await c.query("ROLLBACK");
  await verifyRehearsalDatabase(s=>database!.query(s),prod);report.bootstrapRollbackVerified=true;report.developmentCopyRejected=true;
  const scoped=rehearsalConfiguration(prod);assert.equal((await database.query("SELECT storage_fingerprint FROM valo_runtime_identity")).rows[0].storage_fingerprint,scoped.storageFingerprint);
  report.phase="production-runtime";
  api=await child("index",prod);worker=await child("export-worker",prod);
  await ready(8095,"/api/healthz",api);await ready(8096,"/readyz",worker);
  for(const [path,method] of [["/api/v1/workspace","GET"],["/api/admin/staff-roles","GET"],["/api/paystack/webhook","POST"],["/","GET"]]){
    const r=await fetch("http://127.0.0.1:8095"+path,{method});assert.equal(r.status,503);assert.equal((await r.json() as {code:string}).code,"PRODUCTION_REHEARSAL_ONLY");
  }
  report.apiReady=true;report.realProductionWorkerReady=true;report.customerAndWebhookRoutesClosed=true;
  await stop(api);await stop(worker);report.cleanDrain=true;report.passed=true;
}catch(error){
  const candidate=(error as {code?:string}).code??(error instanceof Error?error.message:"");
  report.errorCode=/^[A-Z0-9_]{5,80}$/.test(candidate)?candidate:"PRODUCTION_DRILL_FAILED";
  report.passed=false;process.exitCode=1;
}
finally{
  try{await stop(api);await stop(worker);}catch{report.cleanDrain=false;process.exitCode=1;}
  await database?.end();for(const log of logs)await log.close();
  if(running)await exec("pg_ctl",["-D",data,"-m","fast","-w","stop"],options).catch(()=>{report.clusterStopFailed=true;process.exitCode=1;});
  // On failure retain only a fixed error code, never connection strings or child logs.
  if(!report.passed){for(const name of ["index","export-worker"]){const log=await readFile(join(directory,name+".log"),"utf8").catch(()=>"");
    report[name+"FailureCode"]=/Error: ([A-Z_]{5,80})\b/.exec(log)?.[1]??null;}}
  await rm(directory,{recursive:true,force:true});
  if(process.exitCode)report.passed=false;
  const output=join(root,"generated-artifacts/valo-production-rehearsal");await mkdir(output,{recursive:true});
  await writeFile(join(output,"runtime.json"),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
