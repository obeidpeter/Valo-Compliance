import {createHash} from "node:crypto";
import {createReadStream,createWriteStream} from "node:fs";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Transform,type Readable} from "node:stream";
import {pipeline} from "node:stream/promises";
import {privateStorageObject,deletePrivateFile} from "./valo-private-storage";

export const WORKSPACE_EXPORT_MAX_BYTES=128*1024*1024;
export const WORKSPACE_EXPORT_ATTEMPT_MS=5*60_000;
export type WorkspaceExportStorage={
  write:(key:string,path:string,signal:AbortSignal,onUploading?:()=>Promise<void>)=>Promise<{checksum:string;size:number}>;
  withFile:<T>(key:string,checksum:string,size:number,consume:(path:string)=>Promise<T>,signal?:AbortSignal)=>Promise<T>;
  remove:(key:string)=>Promise<void>;
};
export async function hashWorkspaceFile(path:string,signal?:AbortSignal){
  const hash=createHash("sha256");let size=0;
  for await(const chunk of createReadStream(path,{signal})){
    size+=chunk.length;if(size>WORKSPACE_EXPORT_MAX_BYTES)throw Error("WORKSPACE_EXPORT_SIZE_LIMIT");hash.update(chunk);
  }
  return{checksum:hash.digest("hex"),size};
}
async function untilAborted<T>(promise:Promise<T>,signal:AbortSignal){
  signal.throwIfAborted();let abort!:()=>void;
  const interrupted=new Promise<never>((_resolve,reject)=>{abort=()=>reject(signal.reason);signal.addEventListener("abort",abort,{once:true});});
  try{return await Promise.race([promise,interrupted]);}finally{signal.removeEventListener("abort",abort);}
}
/** Download into private bounded scratch and verify before application release.
 * The caller rechecks session/job/privacy authority after this network wait. */
export async function withPrivateWorkspaceFile<T>(key:string,checksum:string,size:number,consume:(path:string)=>Promise<T>,signal?:AbortSignal){
  if(!key.endsWith(".json")||!Number.isSafeInteger(size)||size<=0||size>WORKSPACE_EXPORT_MAX_BYTES||!/^[a-f0-9]{64}$/.test(checksum))
    throw Error("PRIVATE_FILE_BINDING_MISMATCH");
  signal?.throwIfAborted();const {client,name}=privateStorageObject(key);
  const directory=await mkdtemp(join(tmpdir(),"valo-workspace-release-")),path=join(directory,"workspace.json");
  const bounded=AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(WORKSPACE_EXPORT_ATTEMPT_MS)]);
  try{
    bounded.throwIfAborted();
    let bytes=0;const hash=createHash("sha256");
    const verify=new Transform({transform(chunk:Buffer,_encoding,callback){
      bytes+=chunk.length;if(bytes>size||bytes>WORKSPACE_EXPORT_MAX_BYTES){callback(Error("PRIVATE_FILE_CHECKSUM_MISMATCH"));return;}
      hash.update(chunk);callback(null,chunk);
    }});
    const stream=client.downloadAsStream(name);let upstream:Readable|undefined;
    // SDK 1.0 returns a PassThrough before asynchronously piping the GCS source.
    // Couple both early and late sources to cancellation; destroying only the
    // wrapper otherwise leaves accepted reads alive behind its backpressure.
    stream.on("pipe",(source:Readable)=>{upstream=source;if(bounded.aborted||stream.destroyed)source.destroy();});
    const stopSource=()=>{upstream?.destroy();};
    bounded.addEventListener("abort",stopSource,{once:true});stream.once("close",stopSource);
    try{await pipeline(stream,verify,createWriteStream(path,{flags:"wx",mode:0o600}),{signal:bounded});}
    finally{bounded.removeEventListener("abort",stopSource);if(stream.destroyed)stopSource();}
    if(bytes!==size||hash.digest("hex")!==checksum)throw Error("PRIVATE_FILE_CHECKSUM_MISMATCH");
    bounded.throwIfAborted();return await consume(path);
  }finally{await rm(directory,{recursive:true,force:true});}
}
export async function writePrivateWorkspaceFile(key:string,path:string,signal:AbortSignal,onUploading?:()=>Promise<void>){
  if(!key.endsWith(".json"))throw Error("PRIVATE_FILE_BINDING_MISMATCH");
  const expected=await hashWorkspaceFile(path,signal);
  if(!expected.size)throw Error("PRIVATE_FILE_BINDING_MISMATCH");
  const {client,name}=privateStorageObject(key);
  const exists=await untilAborted(client.exists(name),signal);
  if(!exists.ok)throw Error("PRIVATE_STORAGE_CHECK_FAILED");
  if(exists.value)throw Error("PRIVATE_FILE_KEY_ALREADY_WRITTEN");
  // Fresh key reservation precedes this call. The pinned SDK cannot promise
  // cancellation of an accepted upload; retained cleanup keys cover late writes.
  signal.throwIfAborted();
  const upload=client.uploadFromFilename(name,path,{compress:false});void upload.catch(()=>{});
  if(onUploading)await untilAborted(Promise.resolve().then(onUploading),signal);const result=await untilAborted(upload,signal);
  if(!result.ok)throw Error("PRIVATE_STORAGE_WRITE_FAILED");
  await withPrivateWorkspaceFile(key,expected.checksum,expected.size,async()=>undefined,signal);
  return expected;
}
export const nativeWorkspaceExportStorage:WorkspaceExportStorage={
  write:writePrivateWorkspaceFile,withFile:withPrivateWorkspaceFile,remove:deletePrivateFile,
};
