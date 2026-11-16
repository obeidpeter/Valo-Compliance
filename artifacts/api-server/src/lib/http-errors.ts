import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { safeValidationFields } from "./request-complexity";
import { ValoProblem } from "./valo-problem";

/** Shared production handler. Importing it must not initialise a database or provider. */
export const onError: ErrorRequestHandler = (error: unknown, req, res, _next) => {
  res.setHeader("Cache-Control", "private, no-store");
  if (typeof error === "object" && error !== null && "type" in error) {
    if (error.type === "entity.parse.failed") {
      res.status(400).json({ error: "Request body is not valid JSON." });
      return;
    }
    if (error.type === "entity.too.large") {
      res.status(413).json({ error: "Request body exceeds the 128 KiB limit." });
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
      error: "Invalid request",
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
  req.log.error({
    event: "request.failed",
    errorType:
      error instanceof TypeError ? "TypeError" : error instanceof RangeError ? "RangeError" : "Error",
  });
  res.status(503).json({
    error:
      "A required service is unavailable. Check the saved status before retrying; your request may need recovery.",
  });
};
