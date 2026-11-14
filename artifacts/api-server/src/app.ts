import express, { type Express, type ErrorRequestHandler } from "express";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import { ZodError } from "zod";
import {requestComplexityLimit,safeValidationFields} from "./lib/request-complexity";
import { CLERK_PROXY_PATH, clerkProxyMiddleware, getClerkProxyHost } from "./middlewares/clerkProxyMiddleware";
import valoRouter from "./routes/valo";
import valoExportsRouter from "./routes/valo-exports";
import { ValoProblem } from "./lib/valo-store";
import router from "./routes";
import { logger } from "./lib/logger";
import { requestReadQuota } from "./middlewares/valo-quota";

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
app.use((req,res,next) => {
  const sendJson = res.json.bind(res);
  res.json = ((body: unknown) => {
    if (res.statusCode >= 400 && typeof body === "object" && body !== null && "error" in body) {
      res.setHeader("Cache-Control","private, no-store");
      const code="code" in body&&typeof body.code==="string"&&/^[A-Z][A-Z0-9_]{1,79}$/.test(body.code)?
        body.code:"HTTP_"+res.statusCode;
      body = { ...body, code, requestId:String(req.id), message:body.error };
    }
    return sendJson(body);
  }) as typeof res.json;
  next();
});
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
app.use(express.json({ limit: "128kb",inflate:false }));
app.use(requestComplexityLimit);
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

app.use(requestReadQuota);
app.use("/api", router);
app.use("/api", valoRouter);
app.use("/api", valoExportsRouter);
const onError: ErrorRequestHandler = (error: unknown, req, res, _next) => {
  res.setHeader("Cache-Control", "private, no-store");
  if (typeof error === "object" && error !== null && "type" in error) {
    if (error.type === "entity.parse.failed") {
      res.status(400).json({ error: "Request body is not valid JSON." }); return;
    }
    if (error.type === "entity.too.large") {
      res.status(413).json({ error: "Request body exceeds the 128 KiB limit." }); return;
    }
    if(error.type==="encoding.unsupported"){
      res.status(415).json({code:"UNSUPPORTED_CONTENT_ENCODING",error:"Send uncompressed JSON. Compressed request bodies are not supported."});return;
    }
  }
  if (error instanceof ZodError) {
    res.status(422).json({ code:"VALIDATION_FAILED", requestId:String(req.id), error: "Invalid request",
      fields:safeValidationFields(error.issues),truncated:error.issues.length>32 });
    return;
  }
  if (error instanceof ValoProblem) {
    if(error.retryAfter)res.setHeader("Retry-After",String(error.retryAfter));
    res.setHeader("Cache-Control","private, no-store");
    res.status(error.status).json({error:error.message,currentRevision:error.currentRevision,retryAfter:error.retryAfter,
      code:error.status===429?"WRITE_LIMIT_REACHED":undefined});return;
  }
  // Never log request bodies, provider payloads, user text or raw prompts.
  req.log.error({ event: "request.failed", errorType: error instanceof Error ? error.name : "unknown" });
  res.status(503).json({ error: "A required service is unavailable. Check the saved status before retrying; your request may need recovery." });
};
app.use(onError);

export default app;
