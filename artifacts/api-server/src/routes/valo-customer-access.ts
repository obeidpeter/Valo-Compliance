import { Router } from "express";
import { getAuth,clerkClient } from "@clerk/express";
import { z } from "zod";
import { RequestAccessSupportResponse as AccessSupportAck,GetCustomerAccountResponse as CustomerAccount,
  DownloadWorkspaceDataResponse as WorkspaceDataExport,GetCustomerPurchasesResponse as CustomerPurchases,
  GetStaffOperationsResponse as StaffOperations,
  GetStaffOperationsQueryParams } from "@workspace/api-zod";
import { sameOriginMutation } from "../middlewares/valo-identity";
import { saveAccessSupport,customerAccount,requestPrivacy,workspaceDataExport,staffOperations } from "../lib/valo-customer-access";
export const publicAccessRouter=Router();
publicAccessRouter.post("/public/access-support",sameOriginMutation,async(req,res)=>{
  res.set("Cache-Control","private, no-store");
  res.status(201).json(AccessSupportAck.parse(await saveAccessSupport(req.body,req.socket.remoteAddress??"unknown-socket")));
});
export const customerAccessRouter=Router();
customerAccessRouter.get("/workspace/account",async(_req,res)=>{
  res.json(CustomerAccount.parse(await customerAccount(res.locals.valoActor)));
});
customerAccessRouter.post("/workspace/privacy-requests",async(req,res)=>{
  res.status(201).json(AccessSupportAck.parse(await requestPrivacy(res.locals.valoActor,res.locals.valoContactEmail,req.body)));
});
customerAccessRouter.get("/workspace/data-export",async(_req,res)=>{
  res.set({"Cache-Control":"private, no-store","Content-Disposition":'attachment; filename="valo-workspace-data.json"',
    "X-Content-Type-Options":"nosniff"});
  res.json(WorkspaceDataExport.parse(await workspaceDataExport(res.locals.valoActor)));
});
customerAccessRouter.get("/workspace/purchases",(_req,res)=>{
  res.json(CustomerPurchases.parse({available:false,message:"Purchases are not enabled yet. Server-verified checkout, receipts and licence history must be implemented and tested before purchase records are offered. Your saved drafts and their exports remain available."}));
});
export const staffOperationsRouter=Router();
staffOperationsRouter.get("/admin/operations",async(req,res)=>{
  res.set("Cache-Control","private, no-store");
  const auth=getAuth(req);
  if(!auth.userId||!auth.sessionId){res.status(401).json({error:"Sign in to a staff account to continue."});return;}
  const [session,user]=await Promise.all([clerkClient.sessions.getSession(auth.sessionId),clerkClient.users.getUser(auth.userId)]);
  const primary=user.emailAddresses.find(e=>e.id===user.primaryEmailAddressId);
  if(session.status!=="active"||session.userId!==user.id||user.banned||user.locked||primary?.verification?.status!=="verified"){
    res.status(403).json({error:"An active verified staff session is required."});return;
  }
  const {area}=GetStaffOperationsQueryParams.parse(req.query);
  res.json(StaffOperations.parse(await staffOperations(user.id,auth.has({reverification:"strict_mfa"}),area)));
});
