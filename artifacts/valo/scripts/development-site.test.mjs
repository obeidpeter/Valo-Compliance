import assert from "node:assert/strict";
import test from "node:test";
import { contentSecurityPolicy } from "../src/lib/content-security-policy.ts";
import { metadataOrigin } from "../src/lib/public-metadata.ts";
import { apiOrigin } from "../src/server/public-api.ts";
import {
  compiledEnvironment,
  developmentEnvironment,
  isDeployment,
  startingPage,
  startingPageHeaders,
} from "./development-site.mjs";

const workspace = { PATH: "/usr/bin", PORT: "20147", REPLIT_DEV_DOMAIN: "example-workspace.replit.dev" };
const nonce = "abcdefghijklmnopqrstuvwx";

test("the compiled development site is built and served as production, reading the API on this machine", () => {
  const env = compiledEnvironment(workspace);
  assert.equal(env.NODE_ENV, "production");
  assert.equal(env.VALO_DEVELOPMENT_SITE, "compiled");
  assert.equal(env.PORT, "20147");
  // The web server's own check accepts the address: plain http to this machine only.
  assert.equal(apiOrigin(env), "http://127.0.0.1:8080");
  // Page addresses are the workspace's public address, as under the development server.
  assert.equal(metadataOrigin(env), "https://example-workspace.replit.dev");
  // Settings the workspace already has are kept.
  const configured = compiledEnvironment({
    ...workspace,
    VALO_API_INTERNAL_ORIGIN: "http://127.0.0.1:9090",
    VALO_TRUSTED_ORIGIN: "https://valo.example",
  });
  assert.equal(apiOrigin(configured), "http://127.0.0.1:9090");
  assert.equal(metadataOrigin(configured), "https://valo.example");
  // Without a workspace address, none is made up.
  assert.equal(metadataOrigin(compiledEnvironment({ PATH: "/usr/bin" })), null);
});

test("the compiled development site may be shown in the workspace preview, and nothing else of development reaches it", () => {
  const policy = contentSecurityPolicy(nonce, compiledEnvironment(workspace));
  assert.match(policy, /frame-ancestors 'self' https:\/\/replit\.com https:\/\/\*\.replit\.com;/);
  assert.doesNotMatch(policy, /unsafe-eval|ws:/);
  // A deployment's settings are never the development site, and the command refuses them.
  for (const marker of ["REPLIT_DEPLOYMENT", "REPLIT_DEPLOYMENT_ID"]) {
    assert.ok(isDeployment({ ...workspace, [marker]: "1" }));
    assert.doesNotMatch(
      contentSecurityPolicy(nonce, compiledEnvironment({ ...workspace, [marker]: "1" })),
      /replit\.com/,
    );
  }
  assert.ok(!isDeployment(workspace));
  assert.ok(!isDeployment({ ...workspace, REPLIT_DEPLOYMENT: "" }));
});

test("if the build fails, the development server gets the workspace's own settings", () => {
  const env = developmentEnvironment(compiledEnvironment({ ...workspace, NODE_ENV: "development" }));
  assert.equal(env.NODE_ENV, undefined);
  assert.equal(env.VALO_DEVELOPMENT_SITE, undefined);
  assert.equal(env.PORT, "20147");
});

test("while the site is built, the port answers with a page that reloads itself and runs no script", () => {
  assert.match(startingPage, /<meta http-equiv="refresh" content="5">/);
  assert.match(startingPage, /<h1>The site is starting<\/h1>/);
  assert.doesNotMatch(startingPage, /<script|<a |<form/i);
  assert.match(startingPageHeaders["content-security-policy"], /^default-src 'none';/);
  assert.equal(startingPageHeaders["cache-control"], "no-store");
});
