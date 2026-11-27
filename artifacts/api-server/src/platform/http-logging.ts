import pinoHttp from "pino-http";
import type { Logger } from "pino";
import { safeError } from "./safe-error";
const methods = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
/** A fixed part of a route's address: lower-case letters, digits and hyphens, as `v1` or `privacy-cases`. */
const FIXED_PART = /^[a-z][a-z0-9-]{0,40}$/;
/** A part that would name a record: an identifier's start, or a run of digits. */
const RECORD_LIKE = /^[0-9a-f]{8}-|\d{3,}/i;
/** A named parameter of the route, as `:id`. */
const PARAMETER = /^:[A-Za-z][A-Za-z0-9]{0,40}$/;

/**
 * The matched route's pattern, such as `/api/workspace/documents/:id`, never the values in the address
 * (docs/architecture/alerts.md, part 3). Every router is mounted on a fixed path, so the part before the
 * route holds no value. A request that matched no route is `unmatched`; a pattern with any part that is
 * not a fixed word or a named parameter is `unrecognised`, so that no value is ever written.
 */
export function routePattern(req: object): string {
  const { baseUrl, route } = req as { baseUrl?: unknown; route?: unknown };
  if (route === undefined || route === null) return "unmatched";
  const path = (route as { path?: unknown }).path;
  if (typeof path !== "string") return "unrecognised";
  const base = typeof baseUrl === "string" ? baseUrl : "";
  const pattern = (base + path).replace(/(.)\/$/, "$1");
  if (pattern === "/") return pattern;
  const parts = pattern.split("/");
  return parts[0] === "" &&
    parts.slice(1).every((part) => PARAMETER.test(part) || (FIXED_PART.test(part) && !RECORD_LIKE.test(part)))
    ? pattern
    : "unrecognised";
}

/** Never serialize a URL: even a path segment can contain private input. Only the route's pattern is kept. */
export function requestLogging(logger: Logger) {
  return pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: methods.has(req.method) ? req.method : "OTHER" };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
      // pino-http would otherwise use its own serializer, which includes messages.
      err: safeError,
    },
    // The request is described as it begins, before it is routed; its route is named as it ends.
    customSuccessObject: (req, _res, fields) => ({ ...fields, route: routePattern(req) }),
    customErrorObject: (req, _res, _error, fields) => ({ ...fields, route: routePattern(req) }),
    customSuccessMessage: () => "request completed",
    customErrorMessage: () => "request failed",
  });
}
