import test from "node:test";
import assert from "node:assert/strict";
import {spawn,type ChildProcess} from "node:child_process";
import {createServer} from "node:net";
import {mkdtemp,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {pool} from "@workspace/db";
import {superviseWorker,supervisorTiming} from "./valo-worker-supervisor";

const enabled=process.env.VALO_RUN_DB_TESTS==="synthetic-development-only";
test("real worker loses readiness on queue drift, recovers, drains and restarts",{skip:!enabled,timeout:90000},async()=>{
  assert.equal(process.env.NODE_ENV,"development");
  assert.equal(process.env.VALO_ERASURE_STORAGE_PROOF,"portable");
  assert.ok(["localhost","127.0.0.1","[::1]"].includes(new URL(process.env.DATABASE_URL!).hostname));
  assert.ok(!process.env.PRIVATE_OBJECT_DIR&&!process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID);
  assert.ok(!Object.entries(process.env).some(([k,v])=>v&&(k==="REPLIT_DEPLOYMENT"||k.startsWith("REPLIT_DEPLOYMENT_"))));
  const queue="valo-workspace-data-v1";
  const original=await pool.query("SELECT expire_seconds,retry_limit FROM valo_jobs.queue WHERE name=$1",[queue]);
  assert.deepEqual(original.rows,[{expire_seconds:360,retry_limit:0}]);
  const directory=await mkdtemp(join(tmpdir(),"valo-worker-readiness-"));
  const listener=createServer();
  await new Promise<void>((ok,no)=>{listener.once("error",no);listener.listen(0,"127.0.0.1",ok);});
  const port=(listener.address() as {port:number}).port;
  await new Promise<void>(ok=>listener.close(()=>ok()));
  let child:ChildProcess|undefined,ended:Promise<{code:number|null;signal:NodeJS.Signals|null}>|undefined;
  let diagnostic="";
  const heartbeat=()=>readFile(join(directory,"generated-artifacts/valo-operations/worker.json"),"utf8").then(JSON.parse);
  async function waitFor(check:()=>Promise<boolean>,label:string){
    const end=Date.now()+20000;
    while(Date.now()<end){
      if(child?.exitCode!==null||child?.signalCode)throw Error("Worker exited during "+label+": "+diagnostic);
      if(await check().catch(()=>false))return;
      await new Promise(ok=>setTimeout(ok,100));
    }
    throw Error("Timed out during "+label+": "+diagnostic);
  }
  async function status(path:string){
    const r=await fetch(`http://127.0.0.1:${port}${path}`,{signal:AbortSignal.timeout(1000)});
    assert.equal(r.headers.get("cache-control"),"no-store");
    assert.deepEqual(Object.keys(await r.json() as object),["status"]);return r.status;
  }
  function start(supervised=false){
    diagnostic="";
    child=spawn(process.execPath,["--experimental-test-module-mocks","--import",import.meta.resolve("tsx"),
      "--import",new URL("../test-support/portable-storage-guard.ts",import.meta.url).href,
      fileURLToPath(new URL("../workers/export-worker.ts",import.meta.url))],{
      cwd:directory,env:{...process.env,VALO_WORKER_HEALTH_PORT:String(port),...(supervised?{VALO_SUPERVISED_WORKER:"ipc-v1"}:{})},
      stdio:supervised?["ignore","pipe","pipe","ipc"]:["ignore","pipe","pipe"],windowsHide:true,
    });
    child.stdout!.on("data",b=>{diagnostic=(diagnostic+String(b)).slice(-3000);});
    child.stderr!.on("data",b=>{diagnostic=(diagnostic+String(b)).slice(-3000);});
    ended=new Promise((ok,no)=>{child!.once("error",no);child!.once("exit",(code,signal)=>ok({code,signal}));});
  }
  async function stop(){
    if(!child||child.exitCode!==null||child.signalCode)return;
    child.kill("SIGTERM");
    const deadline=setTimeout(()=>child?.kill("SIGKILL"),15000);
    try{
      const result=await ended;
      // Windows terminates Node directly; POSIX exercises the real signal handler in CI.
      if(process.platform!=="win32"){
        assert.deepEqual(result,{code:0,signal:null});assert.equal((await heartbeat()).phase,"draining");
      }
    }finally{clearTimeout(deadline);}
  }
  try{
    start();await waitFor(async()=>await status("/readyz")===200&&(await heartbeat()).phase==="running","initial successful dispatch");
    const first=await heartbeat();assert.equal(first.phase,"running");assert.ok(first.dispatches>=1);
    await pool.query("UPDATE valo_jobs.queue SET expire_seconds=361 WHERE name=$1",[queue]);
    await waitFor(async()=>await status("/readyz")===503&&(await heartbeat()).phase==="failed","queue drift rejection");
    assert.equal(await status("/healthz"),200,"liveness must not disguise readiness failure");
    assert.equal((await heartbeat()).lastSuccessAt,first.lastSuccessAt,"failed dispatch does not refresh success time");
    await pool.query("UPDATE valo_jobs.queue SET expire_seconds=360 WHERE name=$1",[queue]);
    await waitFor(async()=>await status("/readyz")===200,"recovery after queue repair");
    await stop();start();
    await waitFor(async()=>await status("/readyz")===200&&(await heartbeat()).instanceId!==first.instanceId,"restart");
    assert.notEqual((await heartbeat()).instanceId,first.instanceId);await stop();
    const controller=new AbortController();let ready=0,launches=0;
    const supervised=superviseWorker({signal:controller.signal,
      timing:{...supervisorTiming,pollMs:50,startupMs:15000,drainMs:10000,restartBaseMs:50},
      launch:()=>{assert.ok(!child||child.exitCode!==null||child.signalCode);start(true);launches++;return child!;},
      report:event=>{if(event.event==="worker_supervisor.ready"){
        ready++;if(ready===1)child!.kill("SIGKILL");else controller.abort();
      }},
    });
    const supervisionDeadline=setTimeout(()=>controller.abort(),30000);
    try{
      assert.equal(await supervised,process.platform==="win32"?1:0);assert.equal(ready,2);assert.equal(launches,2);
      if(process.platform!=="win32"){
        assert.equal(child!.exitCode,0);assert.equal(child!.signalCode,null);
        assert.equal((await heartbeat()).phase,"draining");
      }
    }
    finally{clearTimeout(supervisionDeadline);controller.abort();}
    // Losing the parent IPC channel must drain the actual worker, including on Windows.
    start(true);await waitFor(async()=>await status("/readyz")===200,"supervised parent-loss setup");
    child!.disconnect();
    const disconnectDeadline=setTimeout(()=>child!.kill("SIGKILL"),15000);
    try{assert.deepEqual(await ended,{code:0,signal:null});assert.equal((await heartbeat()).phase,"draining");}
    finally{clearTimeout(disconnectDeadline);}
    assert.doesNotMatch(diagnostic,/NATIVE_STORAGE_FORBIDDEN/);
  }finally{
    if(child&&child.exitCode===null&&!child.signalCode){child.kill("SIGKILL");await ended;}
    await pool.query("UPDATE valo_jobs.queue SET expire_seconds=$2,retry_limit=$3 WHERE name=$1",[queue,original.rows[0].expire_seconds,original.rows[0].retry_limit]);
    await pool.end();
    assert.equal(dirname(resolve(directory)),resolve(tmpdir()));assert.ok(directory.includes("valo-worker-readiness-"));
    await rm(directory,{recursive:true,force:true});
  }
});
