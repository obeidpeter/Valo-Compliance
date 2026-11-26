import type { RequestHandler } from "express";
import { requestCounts, type RequestCounts } from "../modules/operations";
import { CLERK_PROXY_PATH } from "./clerkProxyMiddleware";

/** One of the API's own requests: not the health check, and not the identity provider's proxy. */
const counted = (url: string) =>
  url.startsWith("/api/") && !url.startsWith(CLERK_PROXY_PATH) && !/^\/api\/healthz(?:[/?]|$)/.test(url);

/**
 * NFR-003 (docs/architecture/alerts.md, part 3): counts each of the API's requests once its answer is
 * sent: the minute it began in, how long it took, and whether it failed unexpectedly. The error handler
 * marks an unexpected failure; a refusal Valo means to give, such as a 503 while a database update waits,
 * is not one. Counting is in this process's memory alone, and never changes an answer.
 */
export function requestCounting(counts: RequestCounts = requestCounts): RequestHandler {
  return (req, res, next) => {
    if (!counted(req.originalUrl)) return next();
    const began = Date.now(),
      start = performance.now();
    res.once("finish", () =>
      counts.count(
        began,
        performance.now() - start,
        res.locals.valoUnexpectedFailure === true || (res.statusCode >= 500 && res.statusCode !== 503),
      ),
    );
    next();
  };
}
