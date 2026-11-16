import pinoHttp from "pino-http";
import type { Logger } from "pino";
const methods = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
/** Never serialize a URL: even a path segment can contain private input. */
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
    },
    customSuccessMessage: () => "request completed",
    customErrorMessage: () => "request failed",
  });
}
