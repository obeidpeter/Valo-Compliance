import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { safeValidationFields } from "./request-complexity";
import { ValoProblem } from "./valo-problem";

/** What a customer is told when the server rejects what was sent, without saying which part. */
export const DETAILS_NOT_ACCEPTED = "Some details were not accepted. Check them and try again.";
/**
 * What a customer is told when a request fails in a way the server did not expect. A request that
 * only reads is told to try again. Any other may have failed before or after something was saved,
 * so its sentence says to check before trying again. It says "if", because a request that is not a
 * read does not always save anything: a check run without an account does not.
 */
export const UNEXPECTED_FAILURE_READING = "Something went wrong at Valo. Try again in a moment.";
export const UNEXPECTED_FAILURE_CHANGING =
  "Something went wrong at Valo. If you were saving something, it may or may not have been saved. Check before you try again.";
/**
 * Whether a reply holds the server's answer to a failure it did not expect. Tests that must tell
 * such a failure from a deliberate refusal ask this.
 */
export function saysUnexpectedFailure(text: string) {
  return text.includes(UNEXPECTED_FAILURE_READING) || text.includes(UNEXPECTED_FAILURE_CHANGING);
}

/**
 * The guard behind a database refusal: the name of the PL/pgSQL function that raised it, when the error,
 * or any cause in its chain, is one a trigger function raised (ADM-009). Drizzle reports a failed query
 * with the database's own error as its cause; PostgreSQL names the raising function in its context.
 * A check constraint, a key or a timeout names no function, so it is not a guard's refusal.
 */
export function guardRefusal(error: unknown): string | null {
  for (let e: unknown = error, depth = 0; e && typeof e === "object" && depth < 5; depth++) {
    const item = e as { code?: unknown; where?: unknown; cause?: unknown };
    if ((item.code === "P0001" || item.code === "23514") && typeof item.where === "string") {
      const raised = /PL\/pgSQL function (?:public\.)?(valo_[a-z0-9_]+)\(\)/.exec(item.where);
      if (raised) return raised[1]!;
    }
    e = item.cause;
  }
  return null;
}

/** Shared production handler. Importing it must not initialise a database or provider. */
/** An address the API does not have. Answered in JSON, so that no API answer is a page of HTML. */
export const notFound: RequestHandler = (_req, res) => {
  res.status(404).json({ code: "NOT_FOUND", error: "There is nothing at this address." });
};
declare global {
  namespace Express {
    interface Locals {
      /** Set by the error handler when it answers an unexpected failure (docs/architecture/alerts.md, part 3). */
      valoUnexpectedFailure?: boolean;
    }
  }
}

export const onError: ErrorRequestHandler = (error: unknown, req, res, _next) => {
  res.setHeader("Cache-Control", "private, no-store");
  if (typeof error === "object" && error !== null && "type" in error) {
    if (error.type === "entity.parse.failed") {
      res.status(400).json({ error: "Request body is not valid JSON." });
      return;
    }
    if (error.type === "entity.too.large") {
      if (
        "limit" in error &&
        error.limit === 3 * 1024 * 1024 &&
        req.is("application/vnd.valo.manual-draft+json")
      ) {
        res.status(413).json({
          error: "Choose a Word or PDF file up to 2 MB and keep the text within 60,000 characters.",
        });
        return;
      }
      res
        .status(413)
        .json({ error: "That is too much to send at once (the limit is 128 KB). Shorten it and try again." });
      return;
    }
    if (error.type === "encoding.unsupported") {
      res.status(415).json({
        code: "UNSUPPORTED_CONTENT_ENCODING",
        error: "Send uncompressed JSON. Compressed request bodies are not supported.",
      });
      return;
    }
  }
  if (error instanceof ZodError) {
    res.status(422).json({
      code: "VALIDATION_FAILED",
      requestId: String(req.id),
      error: DETAILS_NOT_ACCEPTED,
      fields: safeValidationFields(error.issues),
      truncated: error.issues.length > 32,
    });
    return;
  }
  if (error instanceof ValoProblem) {
    if (error.retryAfter) res.setHeader("Retry-After", String(error.retryAfter));
    res.status(error.status).json({
      error: error.message,
      currentRevision: error.currentRevision,
      retryAfter: error.retryAfter,
      code: error.status === 429 ? "WRITE_LIMIT_REACHED" : undefined,
    });
    return;
  }
  // A database guard refused what the application sent. The application never sends such a change,
  // so it is a fault or an attempt to change a history: it is counted as a security signal, which
  // raises an alert (GUARD_REFUSALS). Only the guard's name is logged, never its message or the row.
  const guard = guardRefusal(error);
  if (guard) {
    res.locals.valoSecuritySignal = "guard_refusal";
    req.log.error({ event: "request.refused_by_guard", guard }, "request refused by a database guard");
  }
  // NFR-003: the request counts count this answer as a failure, as they do no refusal Valo means to give.
  res.locals.valoUnexpectedFailure = true;
  req.log.error(
    {
      event: "request.failed",
      errorType:
        error instanceof TypeError ? "TypeError" : error instanceof RangeError ? "RangeError" : "Error",
      err: error,
    },
    "request failed",
  );
  res.status(503).json({
    error:
      req.method === "GET" || req.method === "HEAD"
        ? UNEXPECTED_FAILURE_READING
        : UNEXPECTED_FAILURE_CHANGING,
  });
};
