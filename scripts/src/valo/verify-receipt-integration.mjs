/** Receipt integration proof in a new local PostgreSQL cluster, never the
 * workspace database. No maintenance command, provider credentials or worker. */
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {mkdtemp,mkdir,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {randomUUID} from "node:crypto";
import {createServer} from "node:net";
import assert from "node:assert/strict";

const exec=promisify(execFile),root=fileURLToPath(new URL("../../../",import.meta.url));
if(process.env.NODE_ENV!=="development"||
  ["REPLIT_DEPLOYMENT","REPLIT_DEPLOYMENT_ID","REPLIT_DEPLOYMENT_TYPE","REPLIT_DEPLOYMENT_TARGET"].some(k=>!!process.env[k]))
  throw Error("EXPLICIT_NONDEPLOYED_DEVELOPMENT_REQUIRED");
const runId=randomUUID(),output=join(root,"generated-artifacts/valo-receipt-integration",runId);
await mkdir(output,{recursive:true});
const temporary=await mkdtemp(join(tmpdir(),"valo-receipt-proof-"));
const data=join(temporary,"postgres"),guard=join(temporary,"network-guard.mjs");
const env={};
for(const key of ["PATH","HOME","LANG","LC_ALL","PNPM_HOME","NIX_SSL_CERT_FILE","SSL_CERT_FILE"])
  if(process.env[key])env[key]=process.env[key];
Object.assign(env,{NODE_ENV:"development",VALO_RUN_DB_TESTS:"synthetic-development-only",
  SESSION_SECRET:"synthetic-receipt-proof-only-not-a-provider-secret",TZ:"UTC"});
const report={runId,sourceCommit:"",startedAt:new Date().toISOString(),finishedAt:null,
  database:"new-disposable-local-postgresql",workspaceDatabaseUsed:false,
  maintenanceCommandExecuted:false,providerCredentialsInherited:false,workerStarted:false,
  newEligibleContent:0,checks:[],outcome:"running"};
let started=false;
async function command(label,file,args,extra={}){
  const begin=Date.now();
  try{
    const result=await exec(file,args,{cwd:root,env,timeout:120000,maxBuffer:4*1024*1024,...extra});
    await writeFile(join(output,`${label}.log`),result.stdout+result.stderr,{mode:0o600});
    return{...result,elapsedMs:Date.now()-begin};
  }catch(error){
    await writeFile(join(output,`${label}.log`),(error.stdout??"")+(error.stderr??""),{mode:0o600});
    throw Error(`${label}_FAILED`,{cause:error});
  }
}
try{
  report.sourceCommit=(await command("source","git",["rev-parse","HEAD"])).stdout.trim();
  const listener=createServer();
  await new Promise(resolve=>listener.listen(0,"127.0.0.1",resolve));
  const port=listener.address().port;
  await new Promise(resolve=>listener.close(resolve));
  await command("initdb","initdb",["-D",data,"--username=valo_receipt_proof","--auth=trust","--no-locale","--encoding=UTF8"]);
  await command("postgres-start","pg_ctl",["-D",data,"-l",join(output,"postgres.log"),"-o",
    `-h 127.0.0.1 -p ${port} -k ${temporary} -F`,"-w","start"]);
  started=true;
  env.DATABASE_URL=`postgresql://valo_receipt_proof@127.0.0.1:${port}/postgres`;
  const target=await command("database-identity","psql",["-X","-A","-t","-d",env.DATABASE_URL,"-c",
    "SELECT current_database()||'|'||current_user||'|'||host(inet_server_addr())||'|'||inet_server_port()"]);
  assert.equal(target.stdout.trim(),`postgres|valo_receipt_proof|127.0.0.1|${port}`);
  report.databaseIdentity=target.stdout.trim();
  await command("journalled-migrations","pnpm",["--filter","@workspace/db","exec","drizzle-kit","migrate","--config","./drizzle.config.ts"]);
  await writeFile(guard,`
import http from "node:http";import https from "node:https";
import {syncBuiltinESMExports} from "node:module";
function blocked(){console.error("RECEIPT_PROOF_NETWORK_BLOCKED");throw Error("RECEIPT_PROOF_NETWORK_BLOCKED");}
http.request=blocked;http.get=blocked;https.request=blocked;https.get=blocked;
globalThis.fetch=blocked;globalThis.__valoReceiptNetworkGuard=true;syncBuiltinESMExports();
`,{mode:0o600});
  env.NODE_OPTIONS=`--import=${guard}`;
  const canary=await command("network-guard-canary","node",["-e",
    "const a=require('node:assert/strict');a.equal(globalThis.__valoReceiptNetworkGuard,true);a.throws(()=>fetch('https://example.invalid/receipt-canary'),/RECEIPT_PROOF_NETWORK_BLOCKED/);"]);
  assert.match(canary.stderr,/RECEIPT_PROOF_NETWORK_BLOCKED/);
  for(const [name,file]of [
    ["receipt-reporting","valo-receipt-recovery-report.test.ts"],
    ["receipt-database-integration","valo-receipt-recovery.integration.test.ts"],
    ["commerce-regressions","valo-commerce.integration.test.ts"],
  ]){
    const result=await command(name,"pnpm",["--filter","@workspace/api-server","exec","node","--import","tsx","--test",`src/lib/${file}`]);
    const log=result.stdout+result.stderr;
    const count=key=>Number(log.match(new RegExp(`(?:# |ℹ )${key} (\\d+)`))?.[1]??NaN);
    const tests=count("tests"),passed=count("pass"),failed=count("fail"),skipped=count("skipped");
    assert.ok(tests>0&&passed===tests&&failed===0&&skipped===0,`${name}: real positive counts required`);
    assert.ok(!log.includes("RECEIPT_PROOF_NETWORK_BLOCKED"),`${name}: unexpected outbound attempt`);
    report.checks.push({name,tests,passed,failed,skipped,elapsedMs:result.elapsedMs,outboundAttempts:0});
  }
  report.outcome="passed";
}catch(error){
  report.outcome="failed";report.failure=error.message;
  process.exitCode=1;
}finally{
  if(started)try{await command("postgres-stop","pg_ctl",["-D",data,"-m","immediate","-w","stop"]);}
    catch{report.outcome="failed";report.cleanup="cluster-stop-failed";process.exitCode=1;}
  if(report.cleanup!=="cluster-stop-failed")await rm(temporary,{recursive:true,force:true});
  report.finishedAt=new Date().toISOString();
  await writeFile(join(output,"result.json"),JSON.stringify(report,null,2),{mode:0o600,flag:"wx"});
  console.log(JSON.stringify({...report,reportPath:join(output,"result.json")}));
}
