import type {Request,Response} from "express";
import {createReadStream} from "node:fs";
import {stat} from "node:fs/promises";
import {pipeline} from "node:stream/promises";
import {getAuth,clerkClient} from "@clerk/express";
import {withWorkspaceDataFile} from "./valo-data-download";
import {assertWorkspaceDownloadSession} from "./valo-download-session";
import type {WorkspaceActor} from "./valo-store";

const liveSession=async(req:Request,actor:WorkspaceActor)=>assertWorkspaceDownloadSession(actor,getAuth(req),{
  session:id=>clerkClient.sessions.getSession(id),user:id=>clerkClient.users.getUser(id),
});

/** The override is a server-owned identity dependency for controlled HTTP tests;
 * the production route always uses the live managed-session reader above. */
export function makeWorkspaceDataDownloadHandler(revalidate:typeof liveSession=liveSession){
  return async(req:Request,res:Response)=>{
    const actor={...res.locals.valoActor};
    const controller=new AbortController();
    const disconnected=()=>controller.abort();
    req.once("aborted",disconnected);res.once("close",disconnected);
    res.set({"Cache-Control":"private, no-store, max-age=0","Vary":"Cookie","X-Content-Type-Options":"nosniff"});
    if(req.aborted||res.destroyed)controller.abort();
    try{
      await withWorkspaceDataFile(actor,async path=>{
        const file=await stat(path);controller.signal.throwIfAborted();
        res.set({"Content-Disposition":'attachment; filename="valo-workspace-data.json"',
          "Content-Type":"application/json; charset=utf-8","Content-Length":String(file.size)});
        await pipeline(createReadStream(path),res,{signal:controller.signal});
      },{signal:controller.signal,beforeRelease:()=>revalidate(req,actor)});
    }catch(error){
      // A disconnected browser cannot receive an error response; cleanup still ran.
      if(!controller.signal.aborted)throw error;
    }finally{
      req.off("aborted",disconnected);res.off("close",disconnected);
    }
  };
}
