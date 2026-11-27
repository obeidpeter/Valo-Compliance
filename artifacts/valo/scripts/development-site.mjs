// What `dev:compiled` (serve-development.mjs) sets for the compiled development site. Kept apart from
// the runner so it can be tested without starting a server.

/** Whether these settings are a Replit deployment's, which is never the development site. */
export function isDeployment(env) {
  return Object.keys(env).some(
    (key) => (key === "REPLIT_DEPLOYMENT" || key.startsWith("REPLIT_DEPLOYMENT_")) && Boolean(env[key]),
  );
}

/** The settings of the compiled build and of the server that serves it, from the workspace's own. */
export function compiledEnvironment(base) {
  return {
    ...base,
    NODE_ENV: "production",
    // The workspace's preview may show the site, and nothing else of development reaches the build
    // (src/lib/content-security-policy.ts).
    VALO_DEVELOPMENT_SITE: "compiled",
    // Page renders read the API on this machine, not out through the public address and back in.
    VALO_API_INTERNAL_ORIGIN: base.VALO_API_INTERNAL_ORIGIN || "http://127.0.0.1:8080",
    // Page addresses (canonical links, the sitemap) as the development server gives them.
    ...(!base.VALO_TRUSTED_ORIGIN && base.REPLIT_DEV_DOMAIN
      ? { VALO_TRUSTED_ORIGIN: `https://${base.REPLIT_DEV_DOMAIN}` }
      : {}),
  };
}

/** The settings of the development server, if the build fails: its own choice of NODE_ENV. */
export function developmentEnvironment(base) {
  const { NODE_ENV: _nodeEnv, VALO_DEVELOPMENT_SITE: _site, ...rest } = base;
  return rest;
}

/** The page the port answers with while the build runs. It reloads itself every five seconds. */
export const startingPage = `<!doctype html><html lang="en-NG"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="refresh" content="5">
<title>Starting — Valo</title></head><body style="font-family:system-ui,sans-serif;padding:2rem;max-width:36rem">
<h1>The site is starting</h1><p>Valo's development site is being prepared. This page reloads by itself
and shows the site when it is ready, usually within two minutes.</p></body></html>`;

export const startingPageHeaders = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "retry-after": "5",
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self' https://replit.com https://*.replit.com",
};
