import {createReadStream,createWriteStream} from "node:fs";
import {createHash} from "node:crypto";
import {pipeline} from "node:stream/promises";
import {privateWorkspaceObject,deletePrivateFile} from "./valo-private-storage";
import {abortable} from "./valo-abort";
export async function workspaceFileDigest(path:string,signal?:AbortSignal){
  const read=createReadStream(path,{signal});let size=0;const hash=createHash("sha256");
  for await(const chunk of read){size+=chunk.length;hash.update(chunk);}
  return{size,checksum:hash.digest("hex")};
}
export const workspaceExportStorage={
  async put(key:string,path:string,signal:AbortSignal){
    const{client,name}=privateWorkspaceObject(key);
    const exists=await abortable(signal,()=>client.exists(name));
    if(!exists.ok||exists.value)throw Error("FRESH_PRIVATE_OBJECT_REQUIRED");
    const source=createReadStream(path,{signal});
    try{await client.uploadFromStream(name,source,{compress:false});}
    finally{source.destroy();}
  },
  async get(key:string,path:string,signal:AbortSignal){
    const{client,name}=privateWorkspaceObject(key),read=client.downloadAsStream(name);
    await pipeline(read,createWriteStream(path,{flags:"wx",mode:0o600}),{signal});
  },
  remove:deletePrivateFile,
};
export type WorkspaceExportStorage=typeof workspaceExportStorage;
