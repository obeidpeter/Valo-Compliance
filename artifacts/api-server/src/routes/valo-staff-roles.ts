import {Router,type Request} from "express";
import {GetStaffRoleAdministrationResponse,VerifyStaffRoleTargetResponse,ChangeStaffRoleResponse} from "@workspace/api-zod";
import {sameOriginMutation} from "../middlewares/valo-identity";
import {staffRoleService,type makeStaffRoleService} from "../lib/valo-staff-roles";
import type {StaffActor} from "../lib/valo-staff-authority";
export function createStaffRoleRouter(authenticate:(req:Request)=>Promise<StaffActor>,service:ReturnType<typeof makeStaffRoleService>=staffRoleService){
 const r=Router();r.use(["/admin/staff-roles","/admin/staff-role-target"],(_req,res,next)=>{res.set("Cache-Control","private, no-store");next();});
 r.get("/admin/staff-roles",async(req,res)=>res.json(GetStaffRoleAdministrationResponse.parse(await service.list(await authenticate(req),req.query))));
 r.post("/admin/staff-role-target",sameOriginMutation,async(req,res)=>res.json(VerifyStaffRoleTargetResponse.parse(await service.target(await authenticate(req),req.body))));
 r.post("/admin/staff-roles",sameOriginMutation,async(req,res)=>{
  const receipt=await service.change(await authenticate(req),req.body);
  req.log?.warn({event:"staff.role_changed",auditId:receipt.id,action:receipt.action,role:receipt.role});
  res.json(ChangeStaffRoleResponse.parse(receipt));
 });return r;
}
