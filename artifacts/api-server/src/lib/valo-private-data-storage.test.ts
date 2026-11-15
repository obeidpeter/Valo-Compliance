import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtemp,readFile,readdir,rm,stat,truncate,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname,join} from "node:path";
import {PassThrough,Readable} from "node:stream";
import test from "node:test";
import type {Client,RequestError,Result as NativeResult} from "@replit/object-storage";

type Result<T>=NativeResult<T,RequestError>;
const digest=(bytes:Buffer)=>createHash("sha256").update(bytes).digest("hex");
const deferred=<T>()=>{let resolve!:(value:T)=>void;let reject!:(reason:unknown)=>void;
  const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};

/** Actual adapter, fs, streams, SHA-256 and scratch cleanup; only the native
 * storage boundary is replaced. Its pinned @replit/object-storage 1.0.0 shape
 * is preserved: exists/upload resolve Result, downloadAsStream returns a
 * Readable synchronously and reports download failures through that stream.
 * This is not provider connectivity, durable-job or managed-identity proof.
 * Run: node --experimental-test-module-mocks --import tsx --test
 *   src/lib/valo-private-data-storage.test.ts
 */
test("private workspace storage verifies bounded files before release",{timeout:30000},async t=>{
  assert.ok(process.execArgv.includes("--experimental-test-module-mocks"));
  const directory=await mkdtemp(join(tmpdir(),"valo-private-data-test-"));
  const previousTmp=process.env.TMPDIR;process.env.TMPDIR=directory;
  t.after(async()=>{if(previousTmp===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=previousTmp;
    await rm(directory,{recursive:true,force:true});});
  const key="valo/development/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.json";
  const name=`controlled-private/${key}`,bytes=Buffer.from('{"synthetic":"workspace-export"}\n');
  const source=join(directory,"source.json");await writeFile(source,bytes);
  let calls:string[]=[];
  let exists:()=>Promise<Result<boolean>>;
  let upload:(path:string,options:{compress?:boolean})=>Promise<Result<null>>;
  let download:()=>Readable;
  let onObject:()=>void;
  function reset(){calls=[];exists=async()=>({ok:true,value:false});upload=async()=>({ok:true,value:null});
    download=()=>Readable.from([bytes.subarray(0,7),bytes.subarray(7)]);onObject=()=>{};}
  reset();t.beforeEach(reset);
  t.mock.module(new URL("./valo-private-storage.ts",import.meta.url).href,{namedExports:{
    privateStorageObject:(requested:string)=>{calls.push("object");assert.equal(requested,key);onObject();return{name,client:{
      exists:(requestedName:string)=>{assert.equal(requestedName,name);calls.push("exists");return exists();},
      uploadFromFilename:(requestedName:string,path:string,options:{compress?:boolean})=>{
        assert.equal(requestedName,name);calls.push("upload");return upload(path,options);},
      downloadAsStream:(requestedName:string)=>{assert.equal(requestedName,name);calls.push("download");return download();},
    } satisfies Pick<Client,"exists"|"uploadFromFilename"|"downloadAsStream">};},
    deletePrivateFile:async()=>{throw Error("UNEXPECTED_NATIVE_DELETE");},
  }});
  const {hashWorkspaceFile,withPrivateWorkspaceFile,writePrivateWorkspaceFile,WORKSPACE_EXPORT_MAX_BYTES}=await import("./valo-private-data-storage");
  const assertNoScratch=async()=>assert.deepEqual((await readdir(directory)).filter(entry=>entry.startsWith("valo-workspace-release-")),[]);
  const noConsumer=async()=>assert.fail("Unverified bytes must not reach the consumer");

  await t.test("hashes a real maximum-size sparse file and rejects the next byte",async()=>{
    const path=join(directory,"bounded.json");await writeFile(path,"");await truncate(path,WORKSPACE_EXPORT_MAX_BYTES);
    const chunk=Buffer.alloc(64*1024),expected=createHash("sha256");
    for(let offset=0;offset<WORKSPACE_EXPORT_MAX_BYTES;offset+=chunk.length)expected.update(chunk);
    assert.deepEqual(await hashWorkspaceFile(path),{size:WORKSPACE_EXPORT_MAX_BYTES,checksum:expected.digest("hex")});
    await truncate(path,WORKSPACE_EXPORT_MAX_BYTES+1);
    await assert.rejects(()=>hashWorkspaceFile(path),/WORKSPACE_EXPORT_SIZE_LIMIT/);
    assert.deepEqual(calls,[]);await rm(path);
  });
  await t.test("pre-aborted hash, download and upload never enter native storage",async()=>{
    const controller=new AbortController();controller.abort(Error("CONTROLLED_ABORT"));
    await assert.rejects(()=>hashWorkspaceFile(source,controller.signal),{name:"AbortError"});
    await assert.rejects(()=>withPrivateWorkspaceFile(key,digest(bytes),bytes.length,noConsumer,controller.signal),/CONTROLLED_ABORT/);
    await assert.rejects(()=>writePrivateWorkspaceFile(key,source,controller.signal),{name:"AbortError"});
    assert.deepEqual(calls,[]);await assertNoScratch();
  });
  await t.test("malformed bindings reject before native lookup or scratch creation",async()=>{
    for(const [requested,checksum,size] of [
      [key.replace(/json$/,"pdf"),digest(bytes),bytes.length],
      [key,"A".repeat(64),bytes.length],[key,digest(bytes),0],
      [key,digest(bytes),1.5],[key,digest(bytes),WORKSPACE_EXPORT_MAX_BYTES+1],
    ] as const)await assert.rejects(()=>withPrivateWorkspaceFile(requested,checksum,size,noConsumer),/PRIVATE_FILE_BINDING_MISMATCH/);
    await assert.rejects(()=>writePrivateWorkspaceFile(key.replace(/json$/,"pdf"),source,new AbortController().signal),/PRIVATE_FILE_BINDING_MISMATCH/);
    const empty=join(directory,"empty.json");await writeFile(empty,"");
    await assert.rejects(()=>writePrivateWorkspaceFile(key,empty,new AbortController().signal),/PRIVATE_FILE_BINDING_MISMATCH/);
    assert.deepEqual(calls,[]);await assertNoScratch();
  });
  await t.test("abort during asynchronous scratch creation prevents a native download",async()=>{
    const controller=new AbortController();
    onObject=()=>queueMicrotask(()=>controller.abort(Error("CONTROLLED_SCRATCH_ABORT")));
    await assert.rejects(()=>withPrivateWorkspaceFile(key,digest(bytes),bytes.length,noConsumer,controller.signal));
    assert.deepEqual(calls,["object"],"Check cancellation again after scratch creation, before opening the native stream");
    await assertNoScratch();
  });
  await t.test("verified bytes are released from private scratch then removed",async()=>{
    let released="";
    const result=await withPrivateWorkspaceFile(key,digest(bytes),bytes.length,async path=>{
      released=path;assert.notEqual(path,source);assert.equal(dirname(dirname(path)),directory);
      assert.deepEqual(await readFile(path),bytes);assert.equal((await stat(path)).mode&0o777,0o600);
      assert.equal((await stat(dirname(path))).mode&0o777,0o700);return"consumed";
    });
    assert.equal(result,"consumed");assert.deepEqual(calls,["object","download"]);
    await assert.rejects(()=>stat(released),{code:"ENOENT"});await assertNoScratch();
  });
  await t.test("scratch is removed if the verified consumer rejects",async()=>{
    let released="";await assert.rejects(()=>withPrivateWorkspaceFile(key,digest(bytes),bytes.length,async path=>{
      released=path;throw Error("CONTROLLED_CONSUMER_FAILURE");}),/CONTROLLED_CONSUMER_FAILURE/);
    await assert.rejects(()=>stat(released),{code:"ENOENT"});await assertNoScratch();
  });
  await t.test("short, extra and same-length corrupted downloads never release bytes",async()=>{
    for(const payload of [bytes.subarray(0,bytes.length-1),Buffer.concat([bytes,Buffer.from("x")]),Buffer.alloc(bytes.length,120)]){
      download=()=>Readable.from([payload]);
      await assert.rejects(()=>withPrivateWorkspaceFile(key,digest(bytes),bytes.length,noConsumer),/PRIVATE_FILE_CHECKSUM_MISMATCH/);
      await assertNoScratch();
    }
  });
  await t.test("oversize download destroys the producer without draining its remainder",async()=>{
    let produced=0;
    const stream=new Readable({highWaterMark:1024,read(){produced++;this.push(Buffer.alloc(1024));if(produced===10000)this.push(null);}});
    download=()=>stream;
    await assert.rejects(()=>withPrivateWorkspaceFile(key,digest(bytes),bytes.length,noConsumer),/PRIVATE_FILE_CHECKSUM_MISMATCH/);
    assert.equal(stream.destroyed,true);assert.ok(produced<10000,"The bounded pipeline must stop, not read the complete oversized stream");
    await assertNoScratch();
  });
  await t.test("native download stream errors reject and remove partial scratch",async()=>{
    download=()=>Readable.from((async function*(){yield bytes.subarray(0,5);throw Error("CONTROLLED_STREAM_FAILURE");})());
    await assert.rejects(()=>withPrivateWorkspaceFile(key,digest(bytes),bytes.length,noConsumer),/CONTROLLED_STREAM_FAILURE/);
    await assertNoScratch();
  });
  await t.test("mid-download abort destroys the stream and removes scratch",async()=>{
    const controller=new AbortController();let started=false;
    const stream=new Readable({read(){if(!started){started=true;this.push(bytes.subarray(0,5));
      setImmediate(()=>controller.abort(Error("CONTROLLED_DOWNLOAD_ABORT")));}}});
    download=()=>stream;
    await assert.rejects(()=>withPrivateWorkspaceFile(key,digest(bytes),bytes.length,noConsumer,controller.signal),{name:"AbortError"});
    assert.equal(stream.destroyed,true);await assertNoScratch();
  });
  await t.test("SDK PassThrough download abort also destroys its piped source",async()=>{
    const controller=new AbortController(),wrapper=new PassThrough(),started=deferred<void>();let read=false;
    const upstream=new Readable({read(){if(!read){read=true;this.push(bytes.subarray(0,5));started.resolve();}}});
    // SDK 1.0.0 gets the bucket asynchronously, then pipes its GCS source into
    // a returned PassThrough. Node pipeline does not own that upstream source.
    download=()=>{queueMicrotask(()=>upstream.pipe(wrapper));return wrapper;};
    try{
      const reading=withPrivateWorkspaceFile(key,digest(bytes),bytes.length,noConsumer,controller.signal);
      await started.promise;controller.abort(Error("CONTROLLED_WRAPPER_ABORT"));
      await assert.rejects(reading,{name:"AbortError"});assert.equal(wrapper.destroyed,true);
      assert.equal(upstream.destroyed,true,"Cancellation must close the native source behind the SDK wrapper");
      await assertNoScratch();
    }finally{upstream.destroy();wrapper.destroy();}
  });
  await t.test("SDK PassThrough oversize rejection also destroys its piped source",async()=>{
    const wrapper=new PassThrough();let produced=0;
    const upstream=new Readable({highWaterMark:1024,read(){produced++;this.push(Buffer.alloc(1024));}});
    download=()=>{queueMicrotask(()=>upstream.pipe(wrapper));return wrapper;};
    try{
      await assert.rejects(()=>withPrivateWorkspaceFile(key,digest(bytes),bytes.length,noConsumer),/PRIVATE_FILE_CHECKSUM_MISMATCH/);
      assert.equal(wrapper.destroyed,true);assert.equal(upstream.destroyed,true,"Size rejection must close the native source behind the SDK wrapper");
      assert.ok(produced<10000);await assertNoScratch();
    }finally{upstream.destroy();wrapper.destroy();}
  });
  await t.test("SDK source piped after cancellation is immediately closed",async()=>{
    const controller=new AbortController(),wrapper=new PassThrough(),returned=deferred<void>();let reads=0;
    const upstream=new Readable({read(){reads++;this.push(bytes);}});
    download=()=>{returned.resolve();return wrapper;};
    try{
      const reading=withPrivateWorkspaceFile(key,digest(bytes),bytes.length,noConsumer,controller.signal);
      await returned.promise;controller.abort(Error("CONTROLLED_DELAYED_PIPE_ABORT"));
      await assert.rejects(reading,{name:"AbortError"});assert.equal(wrapper.destroyed,true);
      // getBucket finishes only now; the real SDK still creates and pipes a source.
      upstream.pipe(wrapper);await new Promise<void>(resolve=>setImmediate(resolve));
      assert.equal(upstream.destroyed,true,"A late SDK pipe must not leave a live upstream after cancellation");
      assert.equal(reads,0);await assertNoScratch();
    }finally{upstream.destroy();wrapper.destroy();}
  });
  await t.test("failed existence checks and existing keys cannot upload",async()=>{
    exists=async()=>({ok:false,error:{message:"controlled unavailable",statusCode:503}});
    await assert.rejects(()=>writePrivateWorkspaceFile(key,source,new AbortController().signal),/PRIVATE_STORAGE_CHECK_FAILED/);
    exists=async()=>({ok:true,value:true});
    await assert.rejects(()=>writePrivateWorkspaceFile(key,source,new AbortController().signal),/PRIVATE_FILE_KEY_ALREADY_WRITTEN/);
    assert.equal(calls.includes("upload"),false);assert.equal(calls.includes("download"),false);await assertNoScratch();
  });
  await t.test("aborting a pending existence check rejects before upload",async()=>{
    const controller=new AbortController(),entered=deferred<void>(),pending=deferred<Result<boolean>>();
    exists=()=>{entered.resolve();return pending.promise;};
    const writing=writePrivateWorkspaceFile(key,source,controller.signal);await entered.promise;
    controller.abort(Error("CONTROLLED_EXISTS_ABORT"));
    await assert.rejects(writing,/CONTROLLED_EXISTS_ABORT/);pending.resolve({ok:true,value:false});
    assert.equal(calls.includes("upload"),false);await assertNoScratch();
  });
  await t.test("abort at the resolved existence boundary cannot start an upload",async()=>{
    const controller=new AbortController(),entered=deferred<void>(),pending=deferred<Result<boolean>>();
    exists=()=>{entered.resolve();return pending.promise;};
    const writing=writePrivateWorkspaceFile(key,source,controller.signal);await entered.promise;
    pending.resolve({ok:true,value:false});controller.abort(Error("CONTROLLED_RESOLVED_CHECK_ABORT"));
    await assert.rejects(writing,/CONTROLLED_RESOLVED_CHECK_ABORT/);
    assert.equal(calls.includes("upload"),false,"Cancellation after an existence reply must be rechecked before starting a new native write");
    await assertNoScratch();
  });
  await t.test("upload acknowledgement precedes successful bounded readback",async()=>{
    const pending=deferred<Result<null>>(),uploading=deferred<void>();let acknowledged=false;
    upload=(path,options)=>{assert.equal(path,source);assert.deepEqual(options,{compress:false});return pending.promise;};
    download=()=>{assert.equal(acknowledged,true);return Readable.from([bytes]);};
    const writing=writePrivateWorkspaceFile(key,source,new AbortController().signal,async()=>{calls.push("uploading");uploading.resolve();});
    await uploading.promise;assert.equal(calls.includes("download"),false);
    acknowledged=true;pending.resolve({ok:true,value:null});
    assert.deepEqual(await writing,{checksum:digest(bytes),size:bytes.length});
    assert.deepEqual(calls,["object","exists","upload","uploading","object","download"]);await assertNoScratch();
  });
  await t.test("negative or rejected upload acknowledgement never starts readback",async()=>{
    upload=async()=>({ok:false,error:{message:"controlled unavailable",statusCode:503}});
    await assert.rejects(()=>writePrivateWorkspaceFile(key,source,new AbortController().signal),/PRIVATE_STORAGE_WRITE_FAILED/);
    upload=async()=>{throw Error("CONTROLLED_UPLOAD_REJECTION");};
    await assert.rejects(()=>writePrivateWorkspaceFile(key,source,new AbortController().signal),/CONTROLLED_UPLOAD_REJECTION/);
    assert.equal(calls.includes("download"),false);await assertNoScratch();
  });
  await t.test("an accepted upload still fails if readback size or hash changed",async()=>{
    for(const payload of [bytes.subarray(0,5),Buffer.alloc(bytes.length,120)]){
      download=()=>Readable.from([payload]);
      await assert.rejects(()=>writePrivateWorkspaceFile(key,source,new AbortController().signal),/PRIVATE_FILE_CHECKSUM_MISMATCH/);
      await assertNoScratch();
    }
  });
  await t.test("abort after an accepted upload does not claim native cancellation or release bytes",async()=>{
    const controller=new AbortController(),pending=deferred<Result<null>>(),uploading=deferred<void>();
    upload=()=>pending.promise;
    const writing=writePrivateWorkspaceFile(key,source,controller.signal,async()=>{uploading.resolve();});
    await uploading.promise;controller.abort(Error("CONTROLLED_UPLOAD_ABORT"));
    await assert.rejects(writing,/CONTROLLED_UPLOAD_ABORT/);
    // The SDK offers no cancellation promise. A late successful write is allowed;
    // durable cleanup-key handling is a service responsibility, not simulated here.
    pending.resolve({ok:true,value:null});
    assert.equal(calls.filter(call=>call==="upload").length,1);assert.equal(calls.includes("download"),false);await assertNoScratch();
  });
  await t.test("a stalled upload-state callback cannot block abort acknowledgement",async()=>{
    const controller=new AbortController(),callback=deferred<void>(),entered=deferred<void>(),pending=deferred<Result<null>>();
    upload=()=>pending.promise;
    let outcome:unknown;let settled=false;
    const writing=writePrivateWorkspaceFile(key,source,controller.signal,async()=>{entered.resolve();await callback.promise;});
    const observed=writing.then(()=>{settled=true;outcome="unexpected success";},error=>{settled=true;outcome=error;});
    await entered.promise;controller.abort(Error("CONTROLLED_CALLBACK_ABORT"));
    await new Promise<void>(resolve=>setImmediate(resolve));const settledBeforeCallback=settled;
    // Always release controlled promises so this regression leaves no dangling work.
    callback.resolve();pending.resolve({ok:true,value:null});await observed;
    assert.equal(settledBeforeCallback,true,"Abort must reject even while the upload-state callback is stalled");
    assert.match(String(outcome),/CONTROLLED_CALLBACK_ABORT/);assert.equal(calls.includes("download"),false);await assertNoScratch();
  });
});
