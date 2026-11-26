import express, { type Express } from "express";
import { requestLogging } from "./platform/http-logging";
import { requestComplexityLimit } from "./platform/request-complexity";
import { notFound, onError } from "./platform/http-errors";
import { securityHeaders } from "./platform/security-headers";
import { setting } from "./platform/settings";
export { onError } from "./platform/http-errors";
import { CLERK_PROXY_PATH, clerkProxyMiddleware } from "./middlewares/clerkProxyMiddleware";
import { identityMiddleware } from "./middlewares/identity";
import valoRouter from "./routes/valo";
import valoExportsRouter from "./routes/valo-exports";
import router from "./routes";
import { logger } from "./platform/logger";
import { requestReadQuota } from "./middlewares/valo-quota";
import { paystackWebhookRouter } from "./routes/valo-paystack-webhook";
import { securitySignals } from "./middlewares/valo-security-signals";
import { requestCounting } from "./middlewares/valo-request-counts";
import { configureProxyBoundary } from "./lib/valo-proxy-boundary";

const app: Express = express();
configureProxyBoundary(app);

app.use(requestLogging(logger));
app.disable("x-powered-by");
// Before anything else can answer, so every answer carries them (SEC-003).
app.use(securityHeaders);
app.use((req, res, next) => {
  const sendJson = res.json.bind(res);
  res.json = ((body: unknown) => {
    if (res.statusCode >= 400 && typeof body === "object" && body !== null && "error" in body) {
      res.setHeader("Cache-Control", "private, no-store");
      const code =
        "code" in body && typeof body.code === "string" && /^[A-Z][A-Z0-9_]{1,79}$/.test(body.code)
          ? body.code
          : "HTTP_" + res.statusCode;
      body = { ...body, code, requestId: String(req.id), message: body.error };
    }
    return sendJson(body);
  }) as typeof res.json;
  next();
});
// Rehearsal is deliberately non-serving, before auth, webhooks and request bodies.
app.use((req, res, next) => {
  if (setting("NODE_ENV") !== "production") return next();
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  if (req.method === "GET" && req.path === "/api/healthz")
    return res.json({ status: "ok", mode: "production-rehearsal", customerTrafficEnabled: false });
  return res
    .status(503)
    .json({ error: "Valo is undergoing private launch validation.", code: "PRODUCTION_REHEARSAL_ONLY" });
});
// Each of the API's own requests is counted for the alerts on failures and time (NFR-003); production,
// which answers only the health check, counts nothing.
app.use(requestCounting());
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
// Before every route, so each refusal is counted for the security alerts (SEC-008).
app.use(securitySignals());
app.use(paystackWebhookRouter);
app.use(express.json({ limit: "128kb", inflate: false }));
app.use(requestComplexityLimit);
app.use(identityMiddleware());

app.use(requestReadQuota);
app.use("/api", router);
app.use("/api", valoRouter);
app.use("/api", valoExportsRouter);
// An address the API does not have is answered in JSON, like every other answer (SEC-003).
app.use("/api", notFound);
app.use(onError);

export default app;
