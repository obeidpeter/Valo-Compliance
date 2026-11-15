import {Router,type Request} from "express";
import {getAuth,clerkClient} from "@clerk/express";
import {z} from "zod";
import {createReadStream} from "node:fs";
import {stat} from "node:fs/promises";
import {pipeline} from "node:stream/promises";
import {ListWorkspaceDataExportsResponse,GetWorkspaceDataExportResponse,RequestWorkspaceDataExportResponse,
  CancelWorkspaceDataExportResponse,RetryWorkspaceDataExportResponse} from "@workspace/api-zod";
import {sameOriginMutation} from "../middlewares/valo-identity";
import {assertWorkspaceDownloadSession} from "../lib/valo-download-session";
import {requestWorkspaceExport,listWorkspaceExports,getWorkspaceExport,actOnWorkspaceExport,withPreparedWorkspaceExport} from "../lib/valo-workspace-exports";
import type {WorkspaceActor} from "../lib/valo-store";
const liveSession=async(req:Request,actor:WorkspaceActor)=>assertWorkspaceDownloadSession(actor,getAuth(req),{
  session:id=>clerkClient.sessions.getSession(id),user:id=>clerkClient.users.getUser(id),
});
/** Production uses the live managed-session check. Injection is server-owned,
 * for the controlled HTTP test; clients cannot select a session reader. */
export function createWorkspaceExportRouter(revalidate:typeof liveSession=liveSession){
  const router=Router();const id=z.string().uuid();
  router.use((_req,res,next)=>{res.set({"Cache-Control":"private, no-store, max-age=0","Vary":"Cookie","X-Content-Type-Options":"nosniff"});next();});
  router.get("/",async(req,res)=>res.json(ListWorkspaceDataExportsResponse.parse(await listWorkspaceExports(res.locals.valoActor,z.string().uuid().optional().parse(req.query.cursor)))));
  router.post("/",sameOriginMutation,async(req,res)=>res.status(202).json(RequestWorkspaceDataExportResponse.parse(await requestWorkspaceExport(res.locals.valoActor,req.body))));
  router.get("/:id",async(req,res)=>res.json(GetWorkspaceDataExportResponse.parse(await getWorkspaceExport(res.locals.valoActor,id.parse(req.params.id)))));
  router.post("/:id/cancel",sameOriginMutation,async(req,res)=>res.json(CancelWorkspaceDataExportResponse.parse(await actOnWorkspaceExport(res.locals.valoActor,id.parse(req.params.id),req.body,"cancel"))));
  router.post("/:id/retry",sameOriginMutation,async(req,res)=>res.status(202).json(RetryWorkspaceDataExportResponse.parse(await actOnWorkspaceExport(res.locals.valoActor,id.parse(req.params.id),req.body,"retry"))));
  router.get("/:id/file",async(req,res)=>{
    const actor={...res.locals.valoActor},jobId=id.parse(req.params.id),controller=new AbortController();
    const disconnected=()=>controller.abort();req.once("aborted",disconnected);res.once("close",disconnected);
    if(req.aborted||res.destroyed)controller.abort();
    try{await withPreparedWorkspaceExport(actor,jobId,async path=>{
      const file=await stat(path);controller.signal.throwIfAborted();
      res.set({"Content-Disposition":'attachment; filename="valo-workspace-data.json"',"Content-Type":"application/json; charset=utf-8","Content-Length":String(file.size)});
      await pipeline(createReadStream(path),res,{signal:controller.signal});
    },{signal:controller.signal,beforeRelease:()=>revalidate(req,actor)});
    }catch(error){if(!controller.signal.aborted)throw error;}
    finally{req.off("aborted",disconnected);res.off("close",disconnected);}
  });
  return router;
}
