import {Router,type Request} from "express";
import {z} from "zod";
import {GetWorkspaceDisputesResponse,CreatePaymentConcernResponse,RespondPaymentConcernResponse,GetFinancePaymentConcernsResponse,ActOnPaymentConcernResponse,GetFinanceDisputeResponse} from "@workspace/api-zod";
import {sameOriginMutation} from "../middlewares/valo-identity";
import {makeVerifiedStaffSession} from "./valo-customer-access";
import {assertFinanceActor,type FinanceActor} from "../lib/valo-refunds";
import {holdFinanceDispute,linkFinanceDispute} from "../lib/valo-dispute-actions";
import * as concern from "../lib/valo-payment-concerns";
const id=(v:unknown)=>z.string().uuid().parse(v);
export const customerPaymentConcernsRouter=Router();
customerPaymentConcernsRouter.use((_req,res,next)=>{res.set("Cache-Control","private, no-store");next();});
customerPaymentConcernsRouter.get("/workspace/disputes",async(_req,res)=>{res.json(GetWorkspaceDisputesResponse.parse(await concern.getWorkspaceDisputes(res.locals.valoActor)));});
customerPaymentConcernsRouter.post("/workspace/orders/:orderId/concerns",sameOriginMutation,async(req,res)=>{res.json(CreatePaymentConcernResponse.parse(await concern.createPaymentConcern(res.locals.valoActor,id(req.params.orderId),req.body)));});
customerPaymentConcernsRouter.post("/workspace/concerns/:id/respond",sameOriginMutation,async(req,res)=>{res.json(RespondPaymentConcernResponse.parse(await concern.respondPaymentConcern(res.locals.valoActor,id(req.params.id),req.body)));});
export function createFinancePaymentConcernsRouter(authenticate:(req:Request)=>Promise<FinanceActor>=makeVerifiedStaffSession()){
 const router=Router();router.use((_req,res,next)=>{res.set("Cache-Control","private, no-store");next();});
 const actor=async(req:Request)=>{const a=await authenticate(req);await assertFinanceActor(a);return a;};
 router.get("/admin/payment-concerns",async(req,res)=>{res.json(GetFinancePaymentConcernsResponse.parse(await concern.getFinancePaymentConcerns(await actor(req))));});
 router.post("/admin/payment-concerns/:id/action",sameOriginMutation,async(req,res)=>{res.json(ActOnPaymentConcernResponse.parse(await concern.actOnPaymentConcern(await actor(req),id(req.params.id),req.body)));});
 router.post("/admin/disputes/link",sameOriginMutation,async(req,res)=>{res.json(GetFinanceDisputeResponse.parse(await linkFinanceDispute(await actor(req),req.body)));});
 router.post("/admin/disputes/:id/hold",sameOriginMutation,async(req,res)=>{res.json(GetFinanceDisputeResponse.parse(await holdFinanceDispute(await actor(req),id(req.params.id),req.body)));});
 return router;
}
export const financePaymentConcernsRouter=createFinancePaymentConcernsRouter();
