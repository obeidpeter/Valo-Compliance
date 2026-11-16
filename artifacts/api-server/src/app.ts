import express, { type Express } from "express";
import { requestLogging } from "./lib/http-logging";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import { requestComplexityLimit } from "./lib/request-complexity";
import { onError } from "./lib/http-errors";
import { setting } from "./platform/settings";
export { onError } from "./lib/http-errors";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import valoRouter from "./routes/valo";
import valoExportsRouter from "./routes/valo-exports";
import router from "./routes";
import { logger } from "./lib/logger";
import { requestReadQuota } from "./middlewares/valo-quota";
import { paystackWebhookRouter } from "./routes/valo-paystack-webhook";
import { configureProxyBoundary } from "./lib/valo-proxy-boundary";

const app: Express = express();
configureProxyBoundary(app);

app.use(requestLogging(logger));
app.disable("x-powered-by");
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
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
app.use(paystackWebhookRouter);
app.use(express.json({ limit: "128kb", inflate: false }));
app.use(requestComplexityLimit);
app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(getClerkProxyHost(req) ?? "", setting("CLERK_PUBLISHABLE_KEY")),
  })),
);
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  next();
});

app.use(requestReadQuota);
app.use("/api", router);
app.use("/api", valoRouter);
app.use("/api", valoExportsRouter);
app.use(onError);

export default app;
