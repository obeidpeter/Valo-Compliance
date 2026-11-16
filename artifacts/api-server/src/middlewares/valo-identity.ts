import { clerkClient, getAuth } from "@clerk/express";
import type { RequestHandler } from "express";
import { resolveWorkspace, type WorkspaceActor } from "../lib/valo-store";
import { trustedSiteOrigin, permittedMutationOrigin } from "../lib/valo-site-origin";

declare global {
  namespace Express {
    interface Locals {
      valoActor: WorkspaceActor;
      valoContactEmail: string;
    }
  }
}
/** Recheck provider session and verified primary email on EVERY private request.
 * No browser-supplied tenant or role is used. Fail closed on provider failure.
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
    const [session, user] = await Promise.all([
      clerkClient.sessions.getSession(auth.sessionId),
      clerkClient.users.getUser(auth.userId),
    ]);
    if (session.status !== "active" || session.userId !== auth.userId) {
      res.status(401).json({ error: "Session is no longer active. Sign in again." });
      return;
    }
    const primary = user.emailAddresses.find((email) => email.id === user.primaryEmailAddressId);
    if (user.banned || user.locked) {
      res.status(403).json({ error: "Account is suspended or locked" });
      return;
    }
    if (primary?.verification?.status !== "verified") {
      res.status(403).json({ error: "Verify your primary email address before saving business data" });
      return;
    }
    res.locals.valoActor = await resolveWorkspace(user.id);
    res.locals.valoContactEmail = primary.emailAddress;
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
