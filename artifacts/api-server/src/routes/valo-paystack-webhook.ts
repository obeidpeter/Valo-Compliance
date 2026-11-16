import { Router, raw } from "express";
import { authenticPaystackBody, type WebhookConfiguration } from "../lib/valo-paystack-contract";
import { recordPaymentEvent } from "../lib/valo-commerce";
/** Mounted before JSON, identity and browser-CSRF middleware. */
export const paystackWebhookRouter = Router();
paystackWebhookRouter.post(
  "/api/webhooks/paystack",
  raw({ type: "application/json", limit: "128kb", inflate: false }),
  async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (
      process.env.NODE_ENV !== "development" ||
      process.env.REPLIT_DEPLOYMENT ||
      process.env.VALO_SANDBOX_CHECKOUT_ENABLED !== "true"
    ) {
      res.status(503).json({ error: "Paystack test webhook is not enabled." });
      return;
    }
    let config: WebhookConfiguration;
    if (process.env.PAYSTACK_WEBHOOK_MODE === "timestamped" && process.env.PAYSTACK_WEBHOOK_SECRET)
      config = { mode: "timestamped", secrets: process.env.PAYSTACK_WEBHOOK_SECRET.split(",") };
    else if (
      process.env.PAYSTACK_WEBHOOK_MODE === "legacy" &&
      process.env.PAYSTACK_SECRET_KEY?.startsWith("sk_test_")
    )
      config = { mode: "legacy", apiSecret: process.env.PAYSTACK_SECRET_KEY };
    else {
      res.status(503).json({ error: "The merchant webhook signature mode is not configured." });
      return;
    }
    const header = req.get(config.mode === "timestamped" ? "paystack-signature" : "x-paystack-signature");
    if (!authenticPaystackBody(req.body, header, config)) {
      req.log.warn({ event: "payment.signature_rejected" });
      res.status(401).json({ error: "Invalid payment event signature." });
      return;
    }
    // Persist before ACK; durable worker verifies with Paystack before any grant.
    res.json(await recordPaymentEvent(req.body));
  },
);
