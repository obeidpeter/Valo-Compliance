import { Router } from "express";
import { z } from "zod";
import { GetCustomerPurchasesResponse,CreateCommerceOrderResponse,StartCommerceCheckoutResponse,
  RefreshCommerceOrderResponse,GetCommerceReceiptResponse,RequestCommerceRefundResponse,
  StartCommerceCheckoutBody,RefreshCommerceOrderBody } from "@workspace/api-zod";
import * as commerce from "../lib/valo-commerce";
export const commerceRouter=Router();
const id=(value:unknown)=>z.string().uuid().parse(value);
commerceRouter.use("/workspace",(_req,res,next)=>{res.set("Cache-Control","private, no-store");next();});
commerceRouter.get("/workspace/purchases",async(_req,res)=>{
  res.json(GetCustomerPurchasesResponse.parse(await commerce.purchases(res.locals.valoActor)));
});
commerceRouter.post("/workspace/orders",async(req,res)=>{
  res.status(201).json(CreateCommerceOrderResponse.parse(await commerce.createOrder(res.locals.valoActor,req.body)));
});
commerceRouter.post("/workspace/orders/:id/checkout",async(req,res)=>{
  StartCommerceCheckoutBody.strict().parse(req.body);
  res.json(StartCommerceCheckoutResponse.parse(await commerce.startCheckout(res.locals.valoActor,id(req.params.id),res.locals.valoContactEmail)));
});
commerceRouter.post("/workspace/orders/:id/refresh",async(req,res)=>{
  RefreshCommerceOrderBody.strict().parse(req.body);
  res.json(RefreshCommerceOrderResponse.parse(await commerce.refreshOrder(res.locals.valoActor,id(req.params.id))));
});
commerceRouter.get("/workspace/orders/:id/receipt",async(req,res)=>{
  res.json(GetCommerceReceiptResponse.parse(await commerce.purchaseReceipt(res.locals.valoActor,id(req.params.id))));
});
commerceRouter.post("/workspace/orders/:id/refund",async(req,res)=>{
  res.status(201).json(RequestCommerceRefundResponse.parse(await commerce.requestRefund(res.locals.valoActor,id(req.params.id),req.body)));
});
