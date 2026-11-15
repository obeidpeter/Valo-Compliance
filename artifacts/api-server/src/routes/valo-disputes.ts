import {Router,type Request} from "express";
import {z} from "zod";
import {GetWorkspaceDisputesResponse,CreatePaymentConcernResponse,RespondPaymentConcernResponse,GetFinanceDisputesResponse,
 GetFinanceDisputeResponse,LinkFinanceDisputeResponse,ActOnFinanceDisputeResponse,ActOnPaymentConcernResponse} from "@workspace/api-zod";
import {sameOriginMutation} from "../middlewares/valo-identity";
import {makeVerifiedStaffSession} from "./valo-customer-access";
import {assertFinanceActor,type FinanceActor} from "../lib/valo-refunds";
import * as flow from "../lib/valo-dispute-workflow";
const id=(v:unknown)=>z.string().uuid().parse(v);
export const customerDisputesRouter=Router();
customerDisputesRouter.use((_req,res,next)=>{res.set("Cache-Control","private, no-store");next();});
customerDisputesRouter.get("/workspace/disputes",async(_req,res)=>{res.json(GetWorkspaceDisputesResponse.parse(await flow.getWorkspaceDisputes(res.locals.valoActor)));});
customerDisputesRouter.post("/workspace/orders/:orderId/concerns",sameOriginMutation,async(req,res)=>{
 res.json(CreatePaymentConcernResponse.parse(await flow.createPaymentConcern(res.locals.valoActor,id(req.params.orderId),req.body)));});
customerDisputesRouter.post("/workspace/concerns/:id/respond",sameOriginMutation,async(req,res)=>{
 res.json(RespondPaymentConcernResponse.parse(await flow.respondPaymentConcern(res.locals.valoActor,id(req.params.id),req.body)));});
/** Only the controlled HTTP test injects its identity resolver; production uses
 * the managed identity service and then the real active finance/MFA boundary. */
export function createFinanceDisputesRouter(authenticate:(req:Request)=>Promise<FinanceActor>=makeVerifiedStaffSession()){
 const router=Router();router.use((_req,res,next)=>{res.set("Cache-Control","private, no-store");next();});
 const actor=async(req:Request)=>{const actor=await authenticate(req);await assertFinanceActor(actor);return actor;};
 router.get("/admin/disputes",async(req,res)=>{res.json(GetFinanceDisputesResponse.parse(await flow.getFinanceDisputes(await actor(req))));});
 router.post("/admin/disputes/link",sameOriginMutation,async(req,res)=>{res.json(LinkFinanceDisputeResponse.parse(await flow.linkFinanceDispute(await actor(req),req.body)));});
 router.get("/admin/disputes/:id",async(req,res)=>{res.json(GetFinanceDisputeResponse.parse(await flow.getFinanceDispute(await actor(req),id(req.params.id))));});
 router.post("/admin/disputes/:id/action",sameOriginMutation,async(req,res)=>{res.json(ActOnFinanceDisputeResponse.parse(await flow.actOnFinanceDispute(await actor(req),id(req.params.id),req.body)));});
 router.post("/admin/payment-concerns/:id/action",sameOriginMutation,async(req,res)=>{res.json(ActOnPaymentConcernResponse.parse(await flow.actOnPaymentConcern(await actor(req),id(req.params.id),req.body)));});
 router.get("/admin/disputes/:id/receipt/:intentId",async(req,res)=>{
 const bytes=await flow.financeDisputeReceipt(await actor(req),id(req.params.id),id(req.params.intentId));
 res.set({"Content-Type":"application/pdf","X-Content-Type-Options":"nosniff","Content-Disposition":"attachment; filename=valo-test-purchase-receipt.pdf"});res.send(bytes);});
 return router;
}
export const financeDisputesRouter=createFinanceDisputesRouter();
