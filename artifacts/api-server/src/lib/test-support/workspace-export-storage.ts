/** Controlled disposable-fixture storage. This module is never imported by an application entry point. */
import {copyFile,mkdir,readFile,rm} from "node:fs/promises";
import {basename,join} from "node:path";
import {hashWorkspaceFile,type WorkspaceExportStorage} from "../valo-private-data-storage";
import {assertErasureObjectScope} from "../valo-erasure-seal";
export function fixtureWorkspaceStorage(directory:string):WorkspaceExportStorage{
  const target=(key:string)=>{
    const workspace=key.split("/")[2]!;assertErasureObjectScope(workspace,key);return join(directory,basename(key));
  };
  return{
    async write(key,path,signal,onUploading){signal.throwIfAborted();await mkdir(directory,{recursive:true});
      await copyFile(path,target(key));await onUploading?.();signal.throwIfAborted();return hashWorkspaceFile(target(key),signal);},
    async withFile(key,checksum,size,consume,signal){const path=target(key),actual=await hashWorkspaceFile(path,signal);
      if(actual.checksum!==checksum||actual.size!==size)throw Error("PRIVATE_FILE_CHECKSUM_MISMATCH");return consume(path);},
    async remove(key){await rm(target(key),{force:true});},
  };
}
