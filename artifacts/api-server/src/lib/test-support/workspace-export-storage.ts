/** Controlled filesystem transport for disposable PostgreSQL tests only. */
import {copyFile,mkdir,rm} from 'node:fs/promises';
import {basename,join} from 'node:path';
import {constants} from 'node:fs';
import type {WorkspaceExportStorage} from '../valo-workspace-export-storage';
import {assertErasureObjectScope} from '../valo-erasure-seal';
export function fixtureWorkspaceStorage(directory:string):WorkspaceExportStorage{
  const target=(key:string)=>{assertErasureObjectScope(key.split('/')[2]!,key);return join(directory,basename(key));};
  return{
    async put(key,path,signal){signal.throwIfAborted();await mkdir(directory,{recursive:true,mode:0o700});await copyFile(path,target(key),constants.COPYFILE_EXCL);signal.throwIfAborted();},
    async get(key,path,signal){signal.throwIfAborted();await copyFile(target(key),path,constants.COPYFILE_EXCL);signal.throwIfAborted();},
    async remove(key){await rm(target(key),{force:true});},
  };
}
