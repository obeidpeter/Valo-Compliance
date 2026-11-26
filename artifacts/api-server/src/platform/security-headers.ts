import type { RequestHandler } from "express";

/**
 * The headers every API answer carries (SEC-003). The API answers JSON and files sent as attachments,
 * which no browser may read as another type, frame or send on to another site in full. They are set
 * before anything else can answer, so an answer that never reaches a route carries them too: a
 * malformed or oversized body's 400 or 413, the production rehearsal's 503, and the payment
 * provider's webhook (docs/architecture/hostile-input.md, part 3).
 */
export const securityHeaders: RequestHandler = (_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  // Browsers ignore HSTS on plain HTTP, so this is safe in local development.
  res.setHeader("Strict-Transport-Security", "max-age=31536000");
  next();
};
