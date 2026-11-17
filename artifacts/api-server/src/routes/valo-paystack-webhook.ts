import { Router, raw } from "express";
import { authenticPaystackBody, type WebhookConfiguration } from "../lib/valo-paystack-contract";
import { recordPaymentEvent } from "../lib/valo-commerce";
import { setting } from "../platform/settings";
/** Mounted before JSON, identity and browser-CSRF middleware. */
export const paystackWebhookRouter = Router();
paystackWebhookRouter.post(
  "/api/webhooks/paystack",
  raw({ type: "application/json", limit: "128kb", inflate: false }),
  async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (
      setting("NODE_ENV") !== "development" ||
      setting("REPLIT_DEPLOYMENT") ||
      setting("VALO_SANDBOX_CHECKOUT_ENABLED") !== "true"
    ) {
      res.status(503).json({ error: "Paystack test webhook is not enabled." });
      return;
    }
    let config: WebhookConfiguration;
    const mode = setting("PAYSTACK_WEBHOOK_MODE"),
      webhookSecret = setting("PAYSTACK_WEBHOOK_SECRET"),
      apiSecret = setting("PAYSTACK_SECRET_KEY");
    if (mode === "timestamped" && webhookSecret)
      config = { mode: "timestamped", secrets: webhookSecret.split(",") };
    else if (mode === "legacy" && apiSecret?.startsWith("sk_test_")) config = { mode: "legacy", apiSecret };
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
