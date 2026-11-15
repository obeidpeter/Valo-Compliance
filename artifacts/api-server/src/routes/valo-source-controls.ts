import {Router,type Request} from "express";
import {z} from "zod";
import {GetSourceControlsResponse,ActOnSourceControlsResponse,GetCorrectionNoticesResponse} from "@workspace/api-zod";
import {sameOriginMutation} from "../middlewares/valo-identity";
import {verifiedStaffSession} from "./valo-customer-access";
import {sourceControls,actOnSourceControls,correctionNotices,type SourceStaffActor} from "../lib/valo-source-controls";
const page=(value:unknown)=>z.coerce.number().int().min(1).max(10000).default(1).parse(value);
export function createSourceControlsRouter(authenticate:(req:Request)=>Promise<SourceStaffActor>=verifiedStaffSession){
 const router=Router();
 router.use((_req,res,next)=>{res.set("Cache-Control","private, no-store");next();});
 router.get("/admin/source-controls",async(req,res)=>{
  const actor=await authenticate(req),area=z.enum(["content","system"]).parse(req.query.area);
  res.json(GetSourceControlsResponse.parse(await sourceControls(actor,area,page(req.query.page))));
 });
 router.post("/admin/source-controls/action",sameOriginMutation,async(req,res)=>{
  res.json(ActOnSourceControlsResponse.parse(await actOnSourceControls(await authenticate(req),req.body)));
 });
 return router;
}
export const sourceControlsRouter=createSourceControlsRouter();
export const correctionNoticesRouter=Router();
correctionNoticesRouter.get("/workspace/correction-notices",async(req,res)=>{
 res.set("Cache-Control","private, no-store");
 res.json(GetCorrectionNoticesResponse.parse(await correctionNotices(res.locals.valoActor,page(req.query.page))));
});
