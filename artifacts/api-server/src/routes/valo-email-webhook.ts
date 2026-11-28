import { Router, raw } from "express";
import { emailWebhookKeys, recordEmailEvent, resendEvents } from "../modules/messages";
import { isDevelopmentRuntime } from "../platform/valo-development-runtime";
import { setting } from "../platform/settings";

/**
 * The email provider's delivery reports (docs/architecture/messages.md, part 3). Mounted before JSON,
 * identity and browser-CSRF middleware: the signature is over the body exactly as it was sent, and the
 * provider is no browser and no member.
 *
 * A report is kept before it is answered, and the worker's messages job records it on the message or
 * reminder it is about. Nothing is kept of a request whose signature does not verify, or of an event Valo
 * does not use. The address in an event is never kept: for a bounce or a complaint a keyed checksum of it
 * is, so that optional messages to it stop.
 */
export const emailWebhookRouter = Router();
emailWebhookRouter.post(
  "/api/webhooks/email",
  raw({ type: "application/json", limit: "64kb", inflate: false }),
  async (req, res) => {
    res.set("Cache-Control", "no-store");
    // Only the development mailer sends through the provider, so only development takes its reports.
    const keys = isDevelopmentRuntime() ? emailWebhookKeys(setting("VALO_EMAIL_WEBHOOK_SECRET")) : null;
    if (!keys) {
      res.status(503).json({ error: "Email delivery reports are not set up." });
      return;
    }
    const header = (name: string) => req.get(name);
    if (!Buffer.isBuffer(req.body) || !resendEvents.authentic(req.body, header, keys)) {
      req.log.warn({ event: "email.signature_rejected" });
      res.locals.valoSecuritySignal = "signature_failure";
      res.status(401).json({ error: "Invalid email event signature." });
      return;
    }
    let read: ReturnType<typeof resendEvents.read>;
    try {
      read = resendEvents.read(req.body, header);
    } catch {
      // Signed by the provider, and not in the form its documentation gives. Nothing is kept of it.
      req.log.warn({ event: "email.event_unreadable" });
      res.status(422).json({ error: "This email event could not be read." });
      return;
    }
    if (!read.report) {
      res.json({ received: true, kept: false });
      return;
    }
    const outcome = await recordEmailEvent(resendEvents.provider, read.eventKey, read.report, read.address);
    if (outcome === "not_ready") {
      // The provider sends the report again later, by which time the tables may be there.
      res.status(503).json({ error: "Email delivery reports are not set up." });
      return;
    }
    res.json({ received: true, kept: true, duplicate: outcome === "duplicate" });
  },
);
