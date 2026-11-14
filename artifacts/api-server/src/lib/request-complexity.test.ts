import test from "node:test";
import assert from "node:assert/strict";
import {fork} from "node:child_process";
import {fileURLToPath} from "node:url";
import {createRequire} from "node:module";
import {brotliCompressSync,deflateSync,gzipSync} from "node:zlib";
import {assertInputBudget,InputComplexityError,safeValidationFields} from "./request-complexity";

test("Express resolves a patched compatible body-parser release",()=>{
  const require=createRequire(import.meta.url),fromExpress=createRequire(require.resolve("express"));
  const version=fromExpress("body-parser/package.json").version as string;
  const [major,minor]=version.split(".").map(Number);
  assert.equal(major,2);assert.ok(minor!>=4,`Unpatched parser ${version}`);
});
test("bounded JSON preserves unknown values and saved content without mutation",()=>{
  const body={unknown:"unknown",unanswered:"unanswered",notApplicable:"not_applicable",amount:"12345678901234567890",
    blocks:[{type:"paragraph",text:"₦ — saved business text"}],empty:""};
  const before=JSON.stringify(body);assertInputBudget(body);assert.equal(JSON.stringify(body),before);
});
test("oversized collections fail before validating their elements",()=>{
  let visited=0;
  const body=Array.from({length:257},()=>Object.defineProperty({},"field",{enumerable:true,get(){visited++;throw Error("should not run");}}));
  assert.throws(()=>assertInputBudget(body),InputComplexityError);assert.equal(visited,0);
  assert.doesNotThrow(()=>assertInputBudget(Array(256).fill(null)));
});
test("deep, broad and high-node-count JSON fails within fixed budgets",()=>{
  let deep:unknown=null;for(let i=0;i<22;i++)deep={next:deep};
  assert.throws(()=>assertInputBudget(deep),InputComplexityError);
  assert.throws(()=>assertInputBudget(Object.fromEntries(Array.from({length:129},(_,i)=>[String(i),null]))),InputComplexityError);
  assert.throws(()=>assertInputBudget(Array.from({length:100},()=>Array(100).fill(0))),InputComplexityError);
});
test("validation responses cap error count, path and message lengths",()=>{
  const fields=safeValidationFields(Array.from({length:1000},()=>({path:["x".repeat(1000)],message:"m".repeat(1000)})));
  assert.equal(fields.length,32);assert.equal(fields[0]!.path.length,256);assert.equal(fields[0]!.message.length,320);
});
test("isolated real API rejects compressed/oversized JSON and remains alive",{
  skip:process.env.VALO_RUN_REQUEST_BUDGET_TESTS!=="synthetic-development-only",
},async(t)=>{
  const child=fork(fileURLToPath(new URL("../scripts/request-budget-child.ts",import.meta.url)),[],{
    execArgv:["--import","tsx"],env:{...process.env,NODE_ENV:"development"},
    stdio:["ignore","ignore","ignore","ipc"],detached:true});
  try{
    const port=await new Promise<number>((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error("Isolated API startup timed out")),15000);
      child.once("exit",code=>{clearTimeout(timer);reject(Error(`Isolated API exited: ${code}`));});
      child.once("message",(m:unknown)=>{clearTimeout(timer);
        if(m&&typeof m==="object"&&"port"in m&&typeof m.port==="number")resolve(m.port);else reject(Error("Invalid child handshake"));});
    });
    const host=process.env.REPLIT_DEV_DOMAIN!;
    const request=(body:string|Buffer,encoding?:string)=>fetch(`http://127.0.0.1:${port}/api/workspace/documents`,{
      method:"POST",headers:{"Content-Type":"application/json",Host:host,Origin:`https://${host}`,
        ...(encoding?{"Content-Encoding":encoding}:{})},body:typeof body==="string"?body:new Uint8Array(body),
      signal:AbortSignal.timeout(5000)});
    const alive=async()=>{
      const healthy=await fetch(`http://127.0.0.1:${port}/api/public/status`,{
        headers:{Host:host},signal:AbortSignal.timeout(5000)});
      assert.equal(healthy.status,200);await healthy.body?.cancel();
      assert.equal(child.exitCode,null);assert.equal(child.signalCode,null);assert.equal(child.connected,true);
    };
    const compressed=[
      {name:"valid gzip is rejected without decompression",encoding:"gzip",body:gzipSync('{"title":"synthetic"}')},
      {name:"truncated gzip cannot terminate the API",encoding:"gzip",body:Buffer.from([31,139,8,0,255,255])},
      {name:"gzip with hostile trailing data cannot terminate the API",encoding:"gzip",
        body:Buffer.concat([gzipSync("{}"),Buffer.from("trailing untrusted bytes")])},
      {name:"deflate cannot enter a decoder lifecycle",encoding:"deflate",body:deflateSync("{}")},
      {name:"brotli cannot enter a decoder lifecycle",encoding:"br",body:brotliCompressSync(Buffer.from("{}"))},
    ];
    for(const {name,body,encoding} of compressed){
      await t.test(name,async()=>{
        const response=await request(body,encoding);assert.equal(response.status,415);
        const errorBody:unknown=await response.json();
        assert.ok(errorBody!==null&&typeof errorBody==="object"&&"code"in errorBody);
        assert.equal(errorBody.code,"UNSUPPORTED_CONTENT_ENCODING");
        await alive();
      });
    }
    await t.test("structural collection limit remains enforced",async()=>{
      const response=await request(JSON.stringify(Array(257).fill({a:1})));
      assert.equal(response.status,413);
      const errorBody:unknown=await response.json();
      assert.ok(errorBody!==null&&typeof errorBody==="object"&&"code"in errorBody);
      assert.equal(errorBody.code,"INPUT_COMPLEXITY_LIMIT");await alive();
    });
    await t.test("ordinary 128 KiB size limit remains enforced",async()=>{
      const response=await request("{\"x\":\""+"x".repeat(131073)+"\"}");
      assert.equal(response.status,413);await response.body?.cancel();await alive();
    });
    await t.test("malformed uncompressed JSON remains a safe 400",async()=>{
      const response=await request("{");assert.equal(response.status,400);await response.body?.cancel();await alive();
    });
    await t.test("normal JSON reaches authentication and cannot create an anonymous document",async()=>{
      const response=await request('{"title":"synthetic"}');assert.equal(response.status,401);
      await response.body?.cancel();await alive();
    });
  }finally{if(child.pid){try{process.kill(-child.pid,"SIGKILL");}catch{}}}
});
