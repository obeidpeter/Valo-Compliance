import { Router } from "express";
import { z } from "zod";
import {
  GetCustomerPurchasesResponse,
  ListOwnedTemplateEditionsResponse,
  CreateCommerceOrderResponse,
  StartCommerceCheckoutResponse,
  RefreshCommerceOrderResponse,
  GetCommerceReceiptResponse,
  RequestCommerceRefundResponse,
  StartCommerceCheckoutBody,
  RefreshCommerceOrderBody,
} from "@workspace/api-zod";
import * as commerce from "../modules/commerce";
import { consumeQuota, quotaSubjectHash } from "../lib/valo-quota";
import { setting } from "../platform/settings";
export const commerceRouter = Router();
const id = (value: unknown) => z.string().uuid().parse(value);
commerceRouter.use("/workspace", (_req, res, next) => {
  res.set("Cache-Control", "private, no-store");
  next();
});
commerceRouter.get("/workspace/purchases", async (_req, res) => {
  res.json(GetCustomerPurchasesResponse.parse(await commerce.purchases(res.locals.valoActor)));
});
commerceRouter.get("/workspace/owned-template-editions", async (_req, res) => {
  res.json(
    ListOwnedTemplateEditionsResponse.parse(await commerce.ownedTemplateEditions(res.locals.valoActor)),
  );
});
commerceRouter.post("/workspace/orders", async (req, res) => {
  res
    .status(201)
    .json(CreateCommerceOrderResponse.parse(await commerce.createOrder(res.locals.valoActor, req.body)));
});
commerceRouter.post("/workspace/orders/:id/checkout", async (req, res) => {
  StartCommerceCheckoutBody.strict().parse(req.body);
  res.json(
    StartCommerceCheckoutResponse.parse(
      await commerce.startCheckout(res.locals.valoActor, id(req.params.id), res.locals.valoContactEmail),
    ),
  );
});
commerceRouter.post("/workspace/orders/:id/refresh", async (req, res) => {
  RefreshCommerceOrderBody.strict().parse(req.body);
  res.json(
    RefreshCommerceOrderResponse.parse(await commerce.refreshOrder(res.locals.valoActor, id(req.params.id))),
  );
});
commerceRouter.get("/workspace/orders/:id/receipt", async (req, res) => {
  res.json(
    GetCommerceReceiptResponse.parse(await commerce.purchaseReceipt(res.locals.valoActor, id(req.params.id))),
  );
});
// The receipt as a PDF (docs/architecture/messages.md, part 5). Each one is made as it is asked for, which
// costs far more than a read, so they are counted with the other files a member asks Valo to make.
commerceRouter.get("/workspace/orders/:id/receipt/file", async (req, res) => {
  const quota = await consumeQuota(
    "export-create",
    quotaSubjectHash(setting("SESSION_SECRET"), "user", res.locals.valoActor.identityId),
  );
  if (!quota.allowed) {
    res.setHeader("Retry-After", String(quota.retryAfter));
    res.status(429).json({
      error: "Too many files asked for in a short time. Wait a moment and try again. Your receipt is safe.",
    });
    return;
  }
  const file = await commerce.purchaseReceiptFile(res.locals.valoActor, id(req.params.id));
  res.set({
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${file.filename}"`,
    "Cache-Control": "private, no-store",
    Vary: "Cookie, Authorization",
    "X-Content-Type-Options": "nosniff",
    "Content-Length": String(file.bytes.length),
  });
  res.send(file.bytes);
});
commerceRouter.post("/workspace/orders/:id/refund", async (req, res) => {
  res
    .status(201)
    .json(
      RequestCommerceRefundResponse.parse(
        await commerce.requestRefund(res.locals.valoActor, id(req.params.id), req.body),
      ),
    );
});
