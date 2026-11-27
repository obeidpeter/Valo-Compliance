/**
 * Clerk Frontend API Proxy Middleware
 *
 * Proxies Clerk Frontend API requests through your domain, enabling Clerk
 * authentication on custom domains and .replit.app deployments without
 * requiring CNAME DNS configuration.
 *
 * AUTH CONFIGURATION: To manage users, enable/disable login providers
 * (Google, GitHub, etc.), change app branding, or configure OAuth credentials,
 * use the Auth pane in the workspace toolbar. Its advanced configuration can
 * open the scoped Clerk dashboard; select the intended environment explicitly.
 *
 * IMPORTANT:
 * - Only active in production (Clerk proxying doesn't work for dev instances)
 * - Must be mounted BEFORE express.json() middleware
 *
 * Usage in app.ts:
 *   import { CLERK_PROXY_PATH, clerkProxyMiddleware } from "./middlewares/clerkProxyMiddleware";
 *   app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
 */

import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "http";
import type { Request, RequestHandler } from "express";
import { createProxyServer } from "httpxy";
import { trustedSiteOrigin } from "../lib/valo-site-origin";
import { clientAddress } from "../lib/valo-proxy-boundary";
import { logger } from "../platform/logger";
import { setting } from "../platform/settings";

const CLERK_FAPI = "https://frontend-api.clerk.dev";
export const CLERK_PROXY_PATH = "/api/__clerk";

/**
 * Returns only the server-configured public hostname. Host, Forwarded and
 * X-Forwarded-* are request data, not authority to select an identity origin.
 * Configuration must explicitly change when a production domain changes.
 */
export function getClerkProxyHost(req: { headers: IncomingHttpHeaders }): string | undefined {
  void req;
  const configured = trustedSiteOrigin();
  return configured ? new URL(configured).host : undefined;
}

export function clerkProxyMiddleware(): RequestHandler {
  // Only run proxy in production — Clerk proxying doesn't work for dev instances
  if (setting("NODE_ENV") !== "production") {
    return (_req, _res, next) => next();
  }

  const secretKey = setting("CLERK_SECRET_KEY");
  if (!secretKey) {
    return (_req, _res, next) => next();
  }
  const siteOrigin = trustedSiteOrigin();
  if (!siteOrigin)
    return (_req, res) => {
      res.status(503).json({ error: "Trusted site configuration is unavailable" });
    };

  return clerkProxy({ target: CLERK_FAPI, secretKey, siteOrigin });
}

/**
 * The proxy itself, sending requests below CLERK_PROXY_PATH to `target`, the Frontend API.
 * Only clerkProxyMiddleware chooses the target in the application; tests aim it at a local
 * server.
 */
export function clerkProxy(options: {
  target: string;
  secretKey: string;
  siteOrigin: string;
}): RequestHandler {
  const { target, secretKey, siteOrigin } = options;
  const configured = new URL(siteOrigin);
  const proxy = createProxyServer({
    target,
    changeOrigin: true,
    // Take over the response so it can be re-sent with a Content-Length (see
    // proxyRes); the deployment edge rejects chunked proxied responses.
    selfHandleResponse: true,
  });

  proxy.on("proxyReq", (proxyReq, req) => {
    proxyReq.setHeader("Clerk-Proxy-Url", `${siteOrigin}${CLERK_PROXY_PATH}`);
    proxyReq.setHeader("Clerk-Secret-Key", secretKey);

    for (const header of [
      "forwarded",
      "x-real-ip",
      "x-forwarded-for",
      "x-forwarded-host",
      "x-forwarded-proto",
      "x-forwarded-port",
    ])
      proxyReq.removeHeader(header);
    const clientIp = clientAddress(req as Request);
    if (clientIp !== "unknown-socket") proxyReq.setHeader("X-Forwarded-For", clientIp);
    proxyReq.setHeader("X-Forwarded-Host", configured.host);
    proxyReq.setHeader("X-Forwarded-Proto", configured.protocol.slice(0, -1));
  });

  // Clerk's dynamic Frontend API responses (/v1/environment, /v1/client,
  // JWKS, ...) arrive without a Content-Length, so relaying them would use
  // Transfer-Encoding: chunked — which the deployment edge (Cloud Run)
  // rejects, turning the app's 200 into a 500. Buffer only those so they can
  // be re-sent with a Content-Length; the body is forwarded untouched so
  // Content-Encoding is preserved. Length-known responses (e.g. /npm/*
  // assets) and body-less responses stream through without buffering.
  proxy.on("proxyRes", (proxyRes, req, res) => {
    // The provider's answers keep the provider's own content policy: Valo's, which loads and runs
    // nothing, is for Valo's own answers (platform/security-headers.ts).
    res.removeHeader("Content-Security-Policy");
    const headers = { ...proxyRes.headers };
    // Transfer-Encoding/Connection are hop-by-hop (RFC 7230 §6.1).
    delete headers["transfer-encoding"];
    delete headers["connection"];
    delete headers["keep-alive"];

    const status = proxyRes.statusCode ?? 502;
    // Content-Length is forbidden on 1xx/204; HEAD/304 may keep theirs.
    if (status < 200 || status === 204) {
      delete headers["content-length"];
    }

    const bodyless = req.method === "HEAD" || status < 200 || status === 204 || status === 304;
    if (headers["content-length"] !== undefined || bodyless) {
      res.writeHead(status, headers);
      // Headers are already sent, so abort the response if the upstream
      // stream errors mid-pipe (e.g. ECONNRESET) rather than leaving an
      // unhandled 'error' or a hung client.
      proxyRes.on("error", () => res.destroy());
      proxyRes.pipe(res);
      return;
    }

    const chunks: Buffer[] = [];
    proxyRes.on("data", (chunk: Buffer) => chunks.push(chunk));
    proxyRes.on("end", () => {
      const body = Buffer.concat(chunks);
      headers["content-length"] = String(body.length);
      res.writeHead(status, headers);
      res.end(body);
    });
    proxyRes.on("error", () => {
      if (!res.headersSent) {
        // Set a length so the empty 502 isn't sent chunked (which the
        // deployment edge would reject just like the original response).
        res.writeHead(502, { "content-length": "0" });
      }
      res.end();
    });
  });

  // The Frontend API could not be reached or failed mid-request. The client gets an empty 502
  // (with a length, for the deployment edge) and nothing from the error; a response already
  // under way is cut off.
  const failed = (error: unknown, res: ServerResponse | undefined) => {
    logger.error({ event: "clerk_proxy.upstream_failed", err: error });
    if (!res || res.writableEnded) return;
    if (res.headersSent) res.destroy();
    else res.writeHead(502, { "content-length": "0" }).end();
  };
  proxy.on("error", (error, _req, res) => failed(error, res as ServerResponse | undefined));

  return (req, res) => {
    // Express strips the mount path from req.url; strip it here too if the proxy is mounted
    // without one, so only the Frontend API path reaches Clerk.
    if (req.url.startsWith(CLERK_PROXY_PATH)) req.url = req.url.slice(CLERK_PROXY_PATH.length) || "/";
    proxy.web(req as IncomingMessage, res as ServerResponse).catch((error: unknown) => failed(error, res));
  };
}
