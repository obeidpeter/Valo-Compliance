import { Router,type Request } from "express";
import {createReadStream} from "node:fs";
import {pipeline} from "node:stream/promises";
import { getAuth,clerkClient } from "@clerk/express";
import { z } from "zod";
import { RequestAccessSupportResponse as AccessSupportAck,GetCustomerAccountResponse as CustomerAccount,
  GetCustomerPurchasesResponse as CustomerPurchases,
  GetStaffOperationsResponse as StaffOperations,
  GetStaffOperationsQueryParams } from "@workspace/api-zod";
import { sameOriginMutation } from "../middlewares/valo-identity";
import { saveAccessSupport,customerAccount,requestPrivacy,staffOperations } from "../lib/valo-customer-access";
import {withWorkspaceDataFile} from "../lib/valo-data-download";
import {financeRefunds,decideRefund,reconcileFinanceRefund,assertFinanceActor} from "../lib/valo-refunds";
import {ValoProblem} from "../lib/valo-problem";
import {GetFinanceRefundsResponse,DecideFinanceRefundResponse,ReconcileFinanceRefundResponse,ReconcileFinanceRefundBody} from "@workspace/api-zod";
import {ListPrivacyCasesResponse,GetPrivacyCaseResponse,VerifyPrivacyCaseResponse,CancelPrivacyCaseResponse,
  ListStaffPrivacyCasesResponse,ActOnStaffPrivacyCaseResponse} from "@workspace/api-zod";
import {listPrivacyCases,customerPrivacyDetail,confirmPrivacyCase,listStaffPrivacyCases,respondPrivacyCase,staffPrivacyDetail} from "../lib/valo-privacy";
import {processPrivacyAction,privacyPreparedResult} from "../lib/valo-privacy-processing";
import {db} from "@workspace/db";
import {requirePrivacyStaff,type PrivacyStaffActor} from "../lib/valo-privacy";
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
  await withWorkspaceDataFile(res.locals.valoActor,async path=>{
    if(res.destroyed)return;
    res.set({"Cache-Control":"private, no-store","Content-Disposition":'attachment; filename="valo-workspace-data.json"',
      "Content-Type":"application/json; charset=utf-8","X-Content-Type-Options":"nosniff"});
    await pipeline(createReadStream(path),res);
  });
});
customerAccessRouter.use("/workspace/privacy-cases",(_req,res,next)=>{res.set("Cache-Control","private, no-store");next();});
customerAccessRouter.get("/workspace/privacy-cases",async(_req,res)=>{
  res.json(ListPrivacyCasesResponse.parse(await listPrivacyCases(res.locals.valoActor)));
});
customerAccessRouter.get("/workspace/privacy-cases/:id",async(req,res)=>{
  res.json(GetPrivacyCaseResponse.parse(await customerPrivacyDetail(res.locals.valoActor,z.string().uuid().parse(req.params.id))));
});
customerAccessRouter.post("/workspace/privacy-cases/:id/verify",sameOriginMutation,async(req,res)=>{
  res.json(VerifyPrivacyCaseResponse.parse(await confirmPrivacyCase(res.locals.valoActor,z.string().uuid().parse(req.params.id),req.body)));
});
customerAccessRouter.post("/workspace/privacy-cases/:id/respond",sameOriginMutation,async(req,res)=>{
  res.json(GetPrivacyCaseResponse.parse(await respondPrivacyCase(res.locals.valoActor,z.string().uuid().parse(req.params.id),req.body)));
});
customerAccessRouter.post("/workspace/privacy-cases/:id/cancel",sameOriginMutation,async(req,res)=>{
  res.json(CancelPrivacyCaseResponse.parse(await confirmPrivacyCase(res.locals.valoActor,z.string().uuid().parse(req.params.id),req.body,true)));
});
customerAccessRouter.get("/workspace/privacy-cases/:id/result",async(req,res)=>{
  const id=z.string().uuid().parse(req.params.id);
  res.set({"Content-Disposition":`attachment; filename="valo-privacy-${id}.json"`,"X-Content-Type-Options":"nosniff"});
  res.json(await privacyPreparedResult(res.locals.valoActor,id));
});
export const staffOperationsRouter=Router();
type StaffSessionDependencies={
  auth:(req:Request)=>{userId:string|null;sessionId:string|null;has:(check:{reverification:"strict_mfa"})=>boolean};
  session:(id:string)=>Promise<{status:string;userId:string}>;
  user:(id:string)=>Promise<{id:string;banned:boolean;locked:boolean;primaryEmailAddressId:string|null;
    emailAddresses:{id:string;verification:{status:string}|null}[]}>;
};
export function makeVerifiedStaffSession(deps:StaffSessionDependencies={
  auth:getAuth,session:id=>clerkClient.sessions.getSession(id),user:id=>clerkClient.users.getUser(id),
}){
return async(req:Request):Promise<PrivacyStaffActor>=>{
  const auth=deps.auth(req);
  if(!auth.userId||!auth.sessionId)throw new ValoProblem(401,"Sign in to a staff account.");
  const[session,user]=await Promise.all([deps.session(auth.sessionId),deps.user(auth.userId)]);
  const primary=user.emailAddresses.find(e=>e.id===user.primaryEmailAddressId);
  if(session.status!=="active"||session.userId!==user.id||user.banned||user.locked||primary?.verification?.status!=="verified")
    throw new ValoProblem(403,"An active verified staff session is required.");
  const actor={identityId:user.id,recentMfa:auth.has({reverification:"strict_mfa"}),verifiedAt:Date.now()};
  return actor;
};
}
const verifiedStaffSession=makeVerifiedStaffSession();
async function financeIdentity(req:Request){
  const actor=await verifiedStaffSession(req);
  await assertFinanceActor(actor);return actor;
}
staffOperationsRouter.use("/admin/refunds",(_req,res,next)=>{res.set("Cache-Control","private, no-store");next();});
staffOperationsRouter.get("/admin/refunds",async(req,res)=>{
  res.json(GetFinanceRefundsResponse.parse(await financeRefunds(await financeIdentity(req))));
});
staffOperationsRouter.post("/admin/refunds/:id/decision",sameOriginMutation,async(req,res)=>{
  res.json(DecideFinanceRefundResponse.parse(await decideRefund(await financeIdentity(req),z.string().uuid().parse(req.params.id),req.body)));
});
staffOperationsRouter.post("/admin/refunds/:id/reconcile",sameOriginMutation,async(req,res)=>{
  ReconcileFinanceRefundBody.strict().parse(req.body);
  res.json(ReconcileFinanceRefundResponse.parse(await reconcileFinanceRefund(await financeIdentity(req),z.string().uuid().parse(req.params.id))));
});
/** The production identity resolver always reads Clerk's live session. A
 * controlled HTTP harness can inject a synthetic resolver while exercising
 * the exact route, same-origin middleware and real database role guard. */
export function createPrivacyOperationsRouter(authenticate:(req:Request)=>Promise<PrivacyStaffActor>=verifiedStaffSession){
const router=Router();
router.use((_req,res,next)=>{res.set("Cache-Control","private, no-store");next();});
const privacyActor=async(req:Request)=>{
  const actor=await authenticate(req);
  await db.transaction(tx=>requirePrivacyStaff(tx,actor));
  return actor;
};
router.get("/",async(req,res)=>{
  const page=z.coerce.number().int().min(1).max(100000).default(1).parse(req.query.page);
  res.json(ListStaffPrivacyCasesResponse.parse(await listStaffPrivacyCases(await privacyActor(req),page)));
});
router.get("/:id",async(req,res)=>{
  res.json(GetPrivacyCaseResponse.parse(await staffPrivacyDetail(await privacyActor(req),z.string().uuid().parse(req.params.id))));
});
router.post("/:id/action",sameOriginMutation,async(req,res)=>{
  res.json(ActOnStaffPrivacyCaseResponse.parse(await processPrivacyAction(await privacyActor(req),z.string().uuid().parse(req.params.id),req.body)));
});
return router;
}
staffOperationsRouter.use("/admin/privacy-cases",createPrivacyOperationsRouter());
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
