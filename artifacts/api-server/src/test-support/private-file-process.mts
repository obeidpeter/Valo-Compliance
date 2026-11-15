/** Portable process proof only; never a native-storage implementation. */
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile,writeFile,unlink,realpath} from "node:fs/promises";
import {join} from "node:path";
import {mock} from "node:test";
assert.equal(process.env.NODE_ENV,"development");
assert.equal(process.env.VALO_RUN_DB_TESTS,"synthetic-development-only");
assert.ok(!process.env.PRIVATE_OBJECT_DIR,"Native configuration forbidden in portable worker proof");
assert.ok(!Object.entries(process.env).some(([k,v])=>v&&(k==="REPLIT_DEPLOYMENT"||k.startsWith("REPLIT_DEPLOYMENT_"))));
assert.ok(["localhost","127.0.0.1","[::1]"].includes(new URL(process.env.DATABASE_URL!).hostname));
const root=await realpath(process.env.VALO_TEST_PRIVATE_FILE_DIR!);
assert.match(root,/\/valo-portable-private-[^/]+$/);
const checksum=(bytes:Buffer)=>createHash("sha256").update(bytes).digest("hex");
const target=(key:string)=>{
  assert.match(key,/^valo\/development\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.(docx|pdf|json)$/);
  return join(root,createHash("sha256").update(key).digest("hex"));
};
const denied=async()=>{throw Error("NATIVE_OPERATION_NOT_PART_OF_PORTABLE_WORKER_PROOF");};
const url=new URL("../lib/valo-private-storage.ts",import.meta.url).href;
await mock.module(url,{namedExports:{
  fileChecksum:checksum,
  writePrivateFile:async(key:string,bytes:Buffer,onUploading?:()=>Promise<void>)=>{
    const writing=writeFile(target(key),bytes,{flag:"wx",mode:0o600});
    await onUploading?.();await writing;return{checksum:checksum(bytes),size:bytes.length};
  },
  readPrivateFile:async(key:string,expected:string)=>{
    const path=target(key);
    let bytes:Buffer;
    try{bytes=await readFile(path);}catch{throw Error("PRIVATE_STORAGE_READ_FAILED");}
    if(bytes.length>10*1024*1024||checksum(bytes)!==expected)throw Error("PRIVATE_FILE_CHECKSUM_MISMATCH");
    return bytes;
  },
  deletePrivateFile:async(key:string)=>{
    try{await unlink(target(key));}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
  },
  anonymousPrivateFileStatus:denied,
  privateWorkspaceObject:()=>{throw Error("NATIVE_WORKSPACE_STORAGE_NOT_PART_OF_PORTABLE_WORKER_PROOF");},
}});
// Child worker CLI explicitly opts in; Node forbids this experimental flag
// inside NODE_OPTIONS. Never change a production worker's environment.
process.env.VALO_PORTABLE_WORKER_PRELOADED="true";
