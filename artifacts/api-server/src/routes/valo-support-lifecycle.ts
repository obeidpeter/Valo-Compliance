import {Router,type Request} from "express";
import {z} from "zod";
import {sameOriginMutation} from "../middlewares/valo-identity";
import {makeVerifiedStaffSession} from "./valo-customer-access";
import {customerSupportCases,customerSupportCase,replyToSupportCase,staffSupportCases,staffSupportCase,
  supportAssignees,actOnSupportCase,contentSupportEscalations,actOnContentSupportEscalation,type SupportStaffActor} from "../lib/valo-support-lifecycle";
export const supportCustomerRouter=Router();
supportCustomerRouter.use("/workspace/support-cases",(_req,res,next)=>{res.set("Cache-Control","private, no-store");next();});
supportCustomerRouter.get("/workspace/support-cases",async(req,res)=>{
  res.json(await customerSupportCases(res.locals.valoActor,req.query.page));
});
supportCustomerRouter.get("/workspace/support-cases/:id",async(req,res)=>{
  res.json(await customerSupportCase(res.locals.valoActor,z.string().uuid().parse(req.params.id),req.query.messagesPage));
});
supportCustomerRouter.post("/workspace/support-cases/:id/reply",sameOriginMutation,async(req,res)=>{
  res.json(await replyToSupportCase(res.locals.valoActor,z.string().uuid().parse(req.params.id),req.body));
});
export function makeSupportOperationsRouter(authenticate:(req:Request)=>Promise<SupportStaffActor>=makeVerifiedStaffSession()){
  const router=Router();
  router.use(["/admin/support-cases","/admin/support-escalations"],(_req,res,next)=>{res.set("Cache-Control","private, no-store");next();});
  router.get("/admin/support-escalations",async(req,res)=>{
    res.json(await contentSupportEscalations(await authenticate(req),req.query.page));
  });
  router.post("/admin/support-escalations/:id/action",sameOriginMutation,async(req,res)=>{
    res.json(await actOnContentSupportEscalation(await authenticate(req),z.string().uuid().parse(req.params.id),req.body));
  });
  router.get("/admin/support-cases",async(req,res)=>{res.json(await staffSupportCases(await authenticate(req),req.query.status,req.query.page));});
  router.get("/admin/support-cases/assignees",async(req,res)=>{res.json(await supportAssignees(await authenticate(req)));});
  router.get("/admin/support-cases/:id",async(req,res)=>{
    res.json(await staffSupportCase(await authenticate(req),z.string().uuid().parse(req.params.id),req.query.messagesPage));
  });
  router.post("/admin/support-cases/:id/action",sameOriginMutation,async(req,res)=>{
    res.json(await actOnSupportCase(await authenticate(req),z.string().uuid().parse(req.params.id),req.body));
  });
  return router;
}
