import type { RequestHandler } from "express";
import { getAuth } from "@clerk/express";
import { consumeQuota, schedulePurgeExpiredQuotaBuckets, quotaSubjectHash } from "../lib/valo-quota";
import { clientAddress } from "../lib/valo-proxy-boundary";
import { setting } from "../platform/settings";

export const requestReadQuota: RequestHandler = async (req, res, next): Promise<void> => {
  if (!["GET", "HEAD"].includes(req.method) || !req.path.startsWith("/api/") || req.path === "/api/healthz") {
    next();
    return;
  }
  // Clerk's supported server validation, never a client-supplied identity header.
  const { userId } = getAuth(req);
  const subject = userId ?? clientAddress(req);
  const key = quotaSubjectHash(setting("SESSION_SECRET"), userId ? "user" : "ip", subject ?? "");
  schedulePurgeExpiredQuotaBuckets();
  const bucket = userId ? "authenticated-read" : "anonymous-read";
  const decision = await consumeQuota(bucket, key);
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-RateLimit-Limit", String(decision.limit));
  res.setHeader("X-RateLimit-Remaining", String(Math.max(0, decision.limit - decision.used)));
  res.setHeader("X-RateLimit-Reset", decision.resetAt.toISOString());
  if (!decision.allowed) {
    req.log.warn({ event: "quota.denied", bucket });
    res.setHeader("Retry-After", String(decision.retryAfter));
    res.status(429).json({
      error: `Too many requests in a short time. Try again in ${decision.retryAfter} seconds. Your saved work has not changed.`,
    });
    return;
  }
  next();
};
