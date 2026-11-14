import {mkdtemp,open,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {db} from "@workspace/db";
import {workspaceDataExport} from "./valo-customer-access";
import {authorizeWorkspaceWrite,type WorkspaceActor} from "./valo-store";

/** Build a complete snapshot before sending headers. Private scratch bytes are
 * removed on success, denied authorization, reader failure or client disconnect.
 * This is regenerable scratch, never a persistent file asset or privacy result. */
export async function withWorkspaceDataFile<T>(actor:WorkspaceActor,consume:(path:string)=>Promise<T>){
  const directory=await mkdtemp(join(tmpdir(),"valo-data-access-"));
  const path=join(directory,"workspace.json");
  try{
    const file=await open(path,"wx",0o600);
    try{
      await workspaceDataExport(actor,async chunk=>{await file.writeFile(chunk,"utf8");});
    }finally{await file.close();}
    // Do not release a completed snapshot to a membership revoked while it built.
    await db.transaction(async tx=>{await authorizeWorkspaceWrite(tx,actor);});
    return await consume(path);
  }finally{await rm(directory,{recursive:true,force:true});}
}
