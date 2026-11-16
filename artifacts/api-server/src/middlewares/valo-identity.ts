import { clerkClient, getAuth } from "@clerk/express";
import type { RequestHandler } from "express";
import { resolveWorkspace, type WorkspaceActor } from "../lib/valo-store";
import { trustedSiteOrigin, permittedMutationOrigin } from "../lib/valo-site-origin";
import { makeSessionVerifier, routeUsesCachedCheck } from "../platform/session-verification";

declare global {
  namespace Express {
    interface Locals {
      valoActor: WorkspaceActor;
      valoContactEmail: string;
    }
  }
}
const sessions = makeSessionVerifier({
  session: (id) => clerkClient.sessions.getSession(id),
  user: (id) => clerkClient.users.getUser(id),
});

/** Requires an active provider session, an unrestricted account and a verified primary
 * email, then resolves the workspace from the server-side membership on every request.
 * Payments, downloads, privacy, the account page and AI drafts check the provider live;
 * listed everyday routes reuse a passing check for at most a minute (decision 0003).
 * No browser-supplied tenant or role is used. Provider failure fails closed.
 */
export const verifiedWorkspace: RequestHandler = async (req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  res.setHeader("Vary", "Cookie");
  try {
    const auth = getAuth(req);
    if (!auth.userId || !auth.sessionId) {
      res.status(401).json({ error: "Sign in with a verified email to access your workspace" });
      return;
    }
    const check = await sessions.verify(
      { userId: auth.userId, sessionId: auth.sessionId },
      routeUsesCachedCheck(req.baseUrl + req.path) ? "cached" : "live",
    );
    if (!check.ok) {
      res.status(check.status).json({ error: check.error });
      return;
    }
    res.locals.valoActor = await resolveWorkspace(check.account.identityId);
    res.locals.valoContactEmail = check.account.contactEmail;
    next();
  } catch (error) {
    next(error);
  }
};

export const sameOriginMutation: RequestHandler = (req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    next();
    return;
  }
  const origin = req.get("origin");
  const trusted = trustedSiteOrigin();
  if (!trusted) {
    res.status(503).json({
      code: "ORIGIN_CONFIGURATION_UNAVAILABLE",
      error: "Trusted site configuration is unavailable. No changes were saved.",
    });
    return;
  }
  const sameOrigin = permittedMutationOrigin(origin, trusted);
  const site = req.get("sec-fetch-site");
  if (!sameOrigin || (site && !["same-origin", "none"].includes(site)) || !req.is("application/json")) {
    req.log?.warn({
      event: "origin.rejected",
      forwardedHostPresent: Boolean(req.get("x-forwarded-host")),
      forwardedProtocolPresent: Boolean(req.get("x-forwarded-proto")),
      multiHopForwardedHost: Boolean(req.get("x-forwarded-host")?.includes(",")),
    });
    res.status(403).json({ code: "UNTRUSTED_ORIGIN", error: "A same-origin JSON request is required" });
    return;
  }
  next();
};
