import { isIP } from "node:net";
import type { Request, RequestHandler } from "express";
import { getAuth } from "@clerk/express";
import { consumeQuota, schedulePurgeExpiredQuotaBuckets, quotaSubjectHash } from "../lib/valo-quota";
import { clientAddress } from "../lib/valo-proxy-boundary";
import { setting } from "../platform/settings";

const loopback = (address: string) => address === "::1" || /^(?:::ffff:)?127(?:\.\d{1,3}){3}$/.test(address);

/**
 * The visitor a page render reads for. The web server renders a public page on this machine and
 * passes on the X-Forwarded-For its visitor's request arrived with (artifacts/valo/src/server). With
 * no proxy trusted (`VALO_TRUSTED_PROXY_CIDRS` unset, as in development), the API would count every
 * visitor's page reads as one visitor's, the web server's, and one busy visitor could use up the read
 * limit for all. So a read from this machine that names a forwarded address counts for the address
 * the last proxy added. Only a process on this machine can make such a read, and every page render
 * also counts towards one shared ceiling (`page-render-read`), so no forwarded address can raise what
 * the pages read in all. Where proxies are trusted, Express already gives the visitor's address.
 */
export function pageRenderVisitor(req: Pick<Request, "app" | "socket" | "get">): string | undefined {
  if (req.app.get("trust proxy")) return undefined;
  if (!loopback(req.socket.remoteAddress ?? "")) return undefined;
  const last = req
    .get("x-forwarded-for")
    ?.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .at(-1);
  return last && isIP(last) ? last : undefined;
}

type ReadQuotaParts = {
  consume: typeof consumeQuota;
  /** The signed-in account, from Clerk's supported server validation, never a client-supplied header. */
  accountOf: (req: Request) => string | null | undefined;
  secret: () => string | undefined;
  purge: () => void;
};

export function makeRequestReadQuota(
  parts: ReadQuotaParts = {
    consume: consumeQuota,
    accountOf: (req) => getAuth(req).userId,
    secret: () => setting("SESSION_SECRET"),
    purge: schedulePurgeExpiredQuotaBuckets,
  },
): RequestHandler {
  return async (req, res, next): Promise<void> => {
    if (
      !["GET", "HEAD"].includes(req.method) ||
      !req.path.startsWith("/api/") ||
      req.path === "/api/healthz"
    ) {
      next();
      return;
    }
    const userId = parts.accountOf(req);
    const visitor = userId ? undefined : pageRenderVisitor(req);
    const subject = userId ?? visitor ?? clientAddress(req);
    const secret = parts.secret();
    const key = quotaSubjectHash(secret, userId ? "user" : "ip", subject ?? "");
    parts.purge();
    const bucket = userId ? "authenticated-read" : "anonymous-read";
    const shared = visitor
      ? await parts.consume("page-render-read", quotaSubjectHash(secret, "ip", "page-renders"))
      : undefined;
    const refusedByShared = Boolean(shared && !shared.allowed);
    const decision = refusedByShared ? shared! : await parts.consume(bucket, key);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-RateLimit-Limit", String(decision.limit));
    res.setHeader("X-RateLimit-Remaining", String(Math.max(0, decision.limit - decision.used)));
    res.setHeader("X-RateLimit-Reset", decision.resetAt.toISOString());
    if (!decision.allowed) {
      req.log.warn({ event: "quota.denied", bucket: refusedByShared ? "page-render-read" : bucket });
      res.setHeader("Retry-After", String(decision.retryAfter));
      res.status(429).json({
        error: `Too many requests in a short time. Try again in ${decision.retryAfter} seconds. Your saved work has not changed.`,
      });
      return;
    }
    next();
  };
}

export const requestReadQuota: RequestHandler = makeRequestReadQuota();
