import type { RequestHandler } from "express";
import { getAuth } from "@clerk/express";
import { consumeQuota, purgeExpiredQuotaBuckets, quotaSubjectHash } from "../lib/valo-quota";

export const requestReadQuota: RequestHandler = async (req, res, next): Promise<void> => {
  if (!["GET", "HEAD"].includes(req.method) || !req.path.startsWith("/api/") || req.path === "/api/healthz") {
    next(); return;
  }
  // Clerk's supported server validation, never a client-supplied identity header.
  const { userId } = getAuth(req);
  // Do not trust caller-controlled X-Forwarded-For. Behind the Replit proxy this
  // is a conservative shared-socket limit until trusted end-user IP is proven.
  const subject = userId ?? req.socket.remoteAddress;
  const key = quotaSubjectHash(process.env.SESSION_SECRET, userId ? "user" : "ip", subject ?? "");
  await purgeExpiredQuotaBuckets();
  const bucket = userId ? "authenticated-read" : "anonymous-read";
  const decision = await consumeQuota(bucket, key);
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-RateLimit-Limit", String(decision.limit));
  res.setHeader("X-RateLimit-Remaining", String(Math.max(0, decision.limit - decision.used)));
  res.setHeader("X-RateLimit-Reset", decision.resetAt.toISOString());
  if (!decision.allowed) {
    req.log.warn({ event: "quota.denied", bucket });
    res.setHeader("Retry-After", String(decision.retryAfter));
    res.status(429).json({ error: `Request limit reached. Retry in ${decision.retryAfter} seconds. Your saved work has not changed.` });
    return;
  }
  next();
};
