import express, { type Express, type ErrorRequestHandler } from "express";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import { ZodError } from "zod";
import { CLERK_PROXY_PATH, clerkProxyMiddleware, getClerkProxyHost } from "./middlewares/clerkProxyMiddleware";
import valoRouter from "./routes/valo";
import { ValoProblem } from "./lib/valo-store";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.disable("x-powered-by");
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
app.use(express.json({ limit: "128kb" }));
app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  next();
});

app.use("/api", router);
app.use("/api", valoRouter);
const onError: ErrorRequestHandler = (error: unknown, req, res, _next) => {
  if (error instanceof ZodError) {
    res.status(400).json({ error: "Invalid request", fields: error.issues.map(i => ({ path: i.path.join("."), message: i.message })) });
    return;
  }
  if (error instanceof ValoProblem) {
    res.status(error.status).json({ error: error.message, currentRevision: error.currentRevision }); return;
  }
  // Never log request bodies, provider payloads, user text or raw prompts.
  req.log.error({ event: "request.failed", errorType: error instanceof Error ? error.name : "unknown" });
  res.status(503).json({ error: "A required service is unavailable. No success has been recorded. Please retry." });
};
app.use(onError);

export default app;
