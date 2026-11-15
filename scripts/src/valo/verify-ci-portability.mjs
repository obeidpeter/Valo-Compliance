/** Reproduce credential-free CI boundaries in disposable local PostgreSQL.
 * Native storage is forbidden; this is not a native-provider proof. */
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {mkdtemp,mkdir,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {createServer} from "node:net";
import {randomUUID} from "node:crypto";
import assert from "node:assert/strict";
const exec=promisify(execFile),root=fileURLToPath(new URL("../../../",import.meta.url));
assert.equal(process.env.NODE_ENV,"development");
assert.ok(!Object.keys(process.env).some(k=>(k==="REPLIT_DEPLOYMENT"||k.startsWith("REPLIT_DEPLOYMENT_"))&&process.env[k]));
const id=randomUUID(),out=join(root,"generated-artifacts/valo-ci-portability",id);
await mkdir(out,{recursive:true});
const temporary=await mkdtemp(join(tmpdir(),"valo-ci-proof-")),data=join(temporary,"postgres");
const env={NODE_ENV:"development",TZ:"UTC",CI:"true",
  SESSION_SECRET:"synthetic-ci-proof-only-not-a-provider-secret",
  VALO_RUN_DB_TESTS:"synthetic-development-only",VALO_ERASURE_STORAGE_PROOF:"portable"};
for(const key of ["PATH","HOME","LANG","PNPM_HOME"])if(process.env[key])env[key]=process.env[key];
const report={id,startedAt:new Date().toISOString(),sourceCommit:null,checks:[],outcome:"running",
  workspaceDatabaseUsed:false,providerCredentialsInherited:false,nativeStorageProof:false,maintenanceExecuted:false};
const privacyIntegration=process.argv.includes("--privacy-hardening"),failedGroups=[];
let started=false;
async function command(name,file,args){
  try{
    const r=await exec(file,args,{cwd:root,env,timeout:240000,maxBuffer:6*1024*1024});
    await writeFile(join(out,`${name}.log`),r.stdout+r.stderr,{mode:0o600});return r.stdout+r.stderr;
  }catch(error){
    await writeFile(join(out,`${name}.log`),(error.stdout??"")+(error.stderr??""),{mode:0o600});throw error;
  }
}
async function check(name,args,allowedSkips=0){
  const log=await command(name,"pnpm",["--filter","@workspace/api-server",...args]);
  const n=key=>Number(log.match(new RegExp(`(?:# |ℹ )${key} (\\d+)`))?.[1]??NaN);
  const tests=n("tests"),passed=n("pass"),failed=n("fail"),skipped=n("skipped");
  assert.ok(tests>0&&passed+skipped===tests&&failed===0&&skipped===allowedSkips,`${name}: invalid counts`);
  report.checks.push({name,tests,passed,failed,skipped});
}
async function independentCheck(name,args,allowedSkips=0){
  try{await check(name,args,allowedSkips);}catch(error){
    if(!privacyIntegration)throw error;
    failedGroups.push({name,error:error.message});
  }
}
try{
  report.sourceCommit=(await command("source","git",["rev-parse","HEAD"])).trim();
  await check("no-database-native-detector",["exec","tsx","--test","src/lib/inference-no-database.test.ts"]);
  await check("controlled-export-zero-effects",["exec","node","--experimental-test-module-mocks",
    "--import","tsx","--test","src/lib/valo-contract-runtime.test.ts"]);
  const server=createServer();await new Promise(r=>server.listen(0,"127.0.0.1",r));
  const port=server.address().port;await new Promise(r=>server.close(r));
  await command("initdb","initdb",["-D",data,"--username=valo_ci_proof","--auth=trust","--no-locale","--encoding=UTF8"]);
  await command("start","pg_ctl",["-D",data,"-l",join(out,"postgres.log"),"-o",`-h 127.0.0.1 -p ${port} -k ${temporary} -F`,"-w","start"]);
  started=true;env.DATABASE_URL=`postgresql://valo_ci_proof@127.0.0.1:${port}/postgres`;
  report.databaseIdentity=(await command("database-identity","psql",["-X","-A","-t","-d",env.DATABASE_URL,
    "-c","SELECT current_database()||'|'||current_user||'|'||host(inet_server_addr())||'|'||inet_server_port()"])).trim();
  assert.equal(report.databaseIdentity,`postgres|valo_ci_proof|127.0.0.1|${port}`);
  await command("migrations","pnpm",["--filter","@workspace/db","exec","drizzle-kit","migrate","--config","./drizzle.config.ts"]);
  env.VALO_DEV_QUEUE_MIGRATION="reviewed-synthetic-development";
  await command("queue-migration","pnpm",["--filter","@workspace/api-server","exec","tsx","src/scripts/queue-migration.ts","apply-development"]);
  delete env.VALO_DEV_QUEUE_MIGRATION;
  await check("rich-checker-contracts",["test:valo-rich-checker"]);
  await check("checker-current-source-task-guard",["test:valo-task-source-guard"]);
  await check("checker-http-journey",["test:valo-checker-http-db"]);
  await independentCheck("portable-erasure-storage",["test:valo-erasure-portable-db"],1);
  await independentCheck("privacy-http-role-session-origin",["test:valo-privacy-http-db"]);
  if(privacyIntegration){
    await independentCheck("ordered-migration-journal",["exec","tsx","--test","../../scripts/src/valo/migration-journal.test.ts"]);
    await independentCheck("erasure-lock-seal-cache",["test:valo-erasure-controls"]);
    await independentCheck("privacy-historical-keys",["exec","tsx","--test","src/lib/valo-privacy-keys.integration.test.ts"]);
    await independentCheck("portable-export-worker",["test:valo-export-worker-portable-db"]);
    await independentCheck("workspace-download-http",["test:valo-workspace-download-db"]);
  }
  if(failedGroups.length){report.failedGroups=failedGroups;throw Error("Independent regression groups failed; see retained per-group logs");}
  report.outcome="passed";
}catch(error){
  report.outcome="failed";report.failure=error.message;process.exitCode=1;
}finally{
  if(started)try{await command("stop","pg_ctl",["-D",data,"-m","immediate","-w","stop"]);}
  catch{report.outcome="failed";report.cleanup="cluster-stop-failed";process.exitCode=1;}
  if(report.cleanup!=="cluster-stop-failed")await rm(temporary,{recursive:true,force:true});
  report.finishedAt=new Date().toISOString();
  await writeFile(join(out,"result.json"),JSON.stringify(report,null,2),{mode:0o600});
  console.log(JSON.stringify({...report,reportPath:join(out,"result.json")}));
}
