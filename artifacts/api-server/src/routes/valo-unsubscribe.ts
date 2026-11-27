import { Router, type Request } from "express";
import { UnsubscribeBody, UnsubscribeResponse } from "@workspace/api-zod";
import { sameOriginMutation } from "../middlewares/valo-identity";
import { consumeQuota, quotaSubjectHash } from "../lib/valo-quota";
import { trustedSiteOrigin } from "../lib/valo-site-origin";
import { readUnsubscribeToken, UNSUBSCRIBE_TOKEN_MAX, type UnsubscribeConsent } from "../modules/messages";
import { stopRemindersByLink } from "../modules/tasks";
import { setting } from "../platform/settings";
import { ValoProblem } from "../platform/valo-problem";

/**
 * The unsubscribe link in an optional message (docs/architecture/messages.md, part 4). Whoever holds the
 * message can stop that kind of message, without signing in, and can do nothing else with it.
 *
 * There are two ways in, and they do the same thing:
 * - the page the link opens asks through `POST /api/public/unsubscribe`, which is in the client contract
 *   and is sent as Valo's own pages send a change;
 * - a mail service asks through `POST /api/public/unsubscribe/one-click`, for the person who pressed its
 *   own unsubscribe button (RFC 8058). It faces mail services, as the webhooks face their providers: it
 *   is outside the client contract, sign-in and the check on where a request came from, since such a
 *   request comes from a mail service's own machines.
 *
 * Reading the link changes nothing: only a POST does. A link that is not one Valo made, one made under a
 * key Valo no longer holds, one made for someone who is no longer the workspace's owner, and one for a
 * workspace that takes no change of its owner's now are answered alike, and the answer does not say
 * which.
 *
 * A link's uses are limited (`unsubscribe-link`). Nobody is signed in, and a mail service asks for many
 * people from the same addresses, so the count is by the workspace the link names, and is taken only
 * once the link's signature has been checked: a request that holds no link of Valo's is refused before
 * any workspace's limit or data is touched. Every refusal is counted with the API's others, by the
 * caller's keyed address, for the alerts (middlewares/valo-security-signals.ts).
 */
const REFUSED =
  "This link does not work. It may be incomplete, or older than Valo still accepts. Nothing was changed.";
const limited = (seconds: number) =>
  `Too many tries with this link in a short time. Try again in ${seconds} seconds. This try changed nothing.`;

type Outcome =
  | { state: "off"; consent: UnsubscribeConsent }
  | { state: "refused" }
  | { state: "limited"; retryAfter: number };

/** A link was refused. The line says so and holds nothing of the request: not the link, and not why. */
function refused(req: Request): Outcome {
  req.log.info({ event: "unsubscribe.refused" });
  return { state: "refused" };
}

async function unsubscribe(req: Request, token: unknown): Promise<Outcome> {
  const link = readUnsubscribeToken(token);
  if (!link) return refused(req);
  const quota = await consumeQuota(
    "unsubscribe-link",
    quotaSubjectHash(setting("SESSION_SECRET"), "workspace", link.workspaceId),
  );
  if (!quota.allowed) {
    req.log.warn({ event: "quota.denied", bucket: "unsubscribe-link" });
    return { state: "limited", retryAfter: quota.retryAfter };
  }
  // Reminders are the only optional message there is, so a link that reads is a reminder's.
  if ((await stopRemindersByLink(link)) === "refused") return refused(req);
  return { state: "off", consent: link.consent };
}

export const unsubscribeRouter = Router();
unsubscribeRouter.post("/public/unsubscribe", sameOriginMutation, async (req, res) => {
  res.set("Cache-Control", "private, no-store");
  const outcome = await unsubscribe(req, UnsubscribeBody.strict().parse(req.body).token);
  if (outcome.state === "limited")
    throw new ValoProblem(429, limited(outcome.retryAfter), undefined, outcome.retryAfter);
  if (outcome.state === "refused") throw new ValoProblem(400, REFUSED);
  res.json(UnsubscribeResponse.parse({ consent: outcome.consent, state: "off" }));
});

/** The token of a one-click request: the one value of `t` in its address, and nothing in its body. */
const tokenOf = (req: Request) => (typeof req.query.t === "string" ? req.query.t : null);
/** A token's own characters, and no more of them than a token has. */
const TOKEN_SHAPED = new RegExp(`^[A-Za-z0-9._-]{1,${UNSUBSCRIBE_TOKEN_MAX}}$`);

export const oneClickUnsubscribeRouter = Router();
oneClickUnsubscribeRouter.post("/api/public/unsubscribe/one-click", async (req, res) => {
  res.set("Cache-Control", "no-store");
  // The body says only that this is a one-click request, in a form the mail service chooses. It is not read.
  const outcome = await unsubscribe(req, tokenOf(req));
  if (outcome.state === "limited") {
    res.set("Retry-After", String(outcome.retryAfter));
    res.status(429).json({ error: limited(outcome.retryAfter) });
  } else if (outcome.state === "refused") res.status(400).json({ error: REFUSED });
  else res.json({ consent: outcome.consent, state: "off" });
});
// Some mail programs open the address instead of posting to it. Opening it changes nothing: the person is
// sent to the page, which asks before anything is stopped.
oneClickUnsubscribeRouter.get("/api/public/unsubscribe/one-click", (req, res) => {
  res.set("Cache-Control", "no-store");
  const origin = trustedSiteOrigin();
  const token = tokenOf(req);
  if (!origin) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  // Only a token's own characters are passed on, so the address this answers with is Valo's own page.
  const passed = token && TOKEN_SHAPED.test(token) ? `?t=${token}` : "";
  res.redirect(303, `${origin}/unsubscribe${passed}`);
});
