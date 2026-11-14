import test from "node:test";
import assert from "node:assert/strict";
import {Writable} from "node:stream";
import {mkdir,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import express from "express";
import {createApplicationLogger} from "./logger";
import {requestLogging} from "./http-logging";
import {onError} from "./http-errors";
test("real HTTP request, parser and application error logs omit private markers but retain correlation/status",async()=>{
  const marker="SYNTHETIC_PRIVATE_HTTP_A_B_912836";
  let captured="";
  const sink=new Writable({write(chunk,_encoding,next){captured+=String(chunk);next();}});
  const log=createApplicationLogger(sink);
  const host=express();host.use(requestLogging(log));host.use(express.json());
  host.post("/failure/:privateName",(_req,_res,next)=>{
    const error=new Error(marker,{cause:new Error(marker)});error.name=marker;next(error);
  });
  host.post("/ok/:privateName",(_req,res)=>res.json({ok:true}));
  host.use(onError);
  const server=host.listen(0,"127.0.0.1");
  await new Promise<void>(r=>server.once("listening",r));
  const address=server.address();assert.ok(address&&typeof address==="object");
  const origin=`http://127.0.0.1:${address.port}`;
  try{
    for(const [route,body,status]of [["ok",JSON.stringify({private:marker}),200],
      ["failure",JSON.stringify({private:marker}),503],["ok",`{"${marker}":`,400]]as const){
      const response=await fetch(`${origin}/${route}/${marker}?private=${marker}`,{method:"POST",
        headers:{"Content-Type":"application/json",Authorization:`Bearer ${marker}`,Cookie:`session=${marker}`},body});
      assert.equal(response.status,status);await response.text();
    }
    await new Promise(r=>setImmediate(r));
    assert.ok(captured.length>0);assert.equal(captured.includes(marker),false);
    const records=captured.trim().split("\n").map(s=>JSON.parse(s));
    assert.ok(records.some(r=>r.event==="request.failed"&&r.errorType==="Error"));
    for(const status of [200,400,503])assert.ok(records.some(r=>r.res?.statusCode===status&&r.req?.id));
    assert.equal(records.filter(r=>r.res).length,3);
    // Positive leak-detector canary: the assertion would detect an actual marker.
    assert.equal((captured+marker).includes(marker),true);
    const output=resolve("generated-artifacts/valo-security");
    await mkdir(output,{recursive:true});
    await writeFile(resolve(output,"http-log-capture.json"),JSON.stringify({
      executedAt:new Date().toISOString(),scope:"Real isolated HTTP host using the application's request logger and error handler",
      managedIdentityAcceptance:false,privateMarkerAbsent:!captured.includes(marker),
      positiveLeakCanaryDetected:(captured+marker).includes(marker),observedStatuses:[200,503,400],records,
    },null,2)+"\n");
  }finally{await new Promise<void>((r,j)=>server.close(e=>e?j(e):r()));}
});
