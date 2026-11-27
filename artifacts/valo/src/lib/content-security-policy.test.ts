import assert from "node:assert/strict";
import test from "node:test";
import { contentSecurityPolicy } from "./content-security-policy";
const nonce = "abcdefghijklmnopqrstuvwx";
test("production denies injected scripts, frames, objects and unconfigured origins while allowing required Clerk resources", () => {
  const policy = contentSecurityPolicy(nonce, {
    NODE_ENV: "production",
    CLERK_PUBLISHABLE_KEY: "pk_test_" + btoa("controlled.clerk.accounts.dev$"),
  });
  const directives = Object.fromEntries(
    policy
      .split(";")
      .filter(Boolean)
      .map((x) => {
        const [key, ...values] = x.trim().split(" ");
        return [key, values];
      }),
  );
  assert.ok(directives["script-src"].includes("'nonce-" + nonce + "'"));
  assert.ok(directives["script-src"].includes("'strict-dynamic'"));
  assert.ok(!directives["script-src"].includes("'unsafe-inline'"));
  assert.ok(!policy.includes("unsafe-eval"));
  assert.deepEqual(directives["object-src"], ["'none'"]);
  assert.deepEqual(directives["frame-ancestors"], ["'none'"]);
  assert.ok(directives["connect-src"].includes("https://controlled.clerk.accounts.dev"));
  assert.ok(directives["connect-src"].includes("https://*.protect.clerk.com:*"));
  assert.ok(!policy.includes("https: "));
  assert.ok(!policy.includes("http:"));
  assert.ok(!policy.includes("replit.com"));
  // Fonts are self-hosted: neither fonts nor styles may load from another origin.
  assert.deepEqual(directives["font-src"], ["'self'"]);
  assert.deepEqual(directives["style-src"], ["'self'", "'unsafe-inline'"]);
});
test("development allowances cannot leak through deployment markers or malformed configuration", () => {
  assert.match(contentSecurityPolicy(nonce, { NODE_ENV: "development" }), /unsafe-eval/);
  for (const marker of [
    "REPLIT_DEPLOYMENT",
    "REPLIT_DEPLOYMENT_ID",
    "REPLIT_DEPLOYMENT_TYPE",
    "REPLIT_DEPLOYMENT_FUTURE",
  ])
    assert.doesNotMatch(
      contentSecurityPolicy(nonce, { NODE_ENV: "development", [marker]: "false" }),
      /unsafe-eval|replit.com/,
    );
  // The compiled development site is never a deployment either.
  for (const marker of ["REPLIT_DEPLOYMENT", "REPLIT_DEPLOYMENT_ID"])
    assert.doesNotMatch(
      contentSecurityPolicy(nonce, {
        NODE_ENV: "production",
        VALO_DEVELOPMENT_SITE: "compiled",
        [marker]: "1",
      }),
      /unsafe-eval|replit.com/,
    );
  for (const host of [
    "evil.invalid/path$",
    "evil.invalid; script-src *$",
    "user@evil.invalid$",
    "evil.invalid:443$",
  ])
    assert.throws(() => contentSecurityPolicy(nonce, { CLERK_PUBLISHABLE_KEY: "pk_test_" + btoa(host) }));
  assert.throws(() => contentSecurityPolicy("attacker' unsafe-inline"));
});
test("the compiled development site may be shown in the workspace preview, and keeps production's scripts and connections", () => {
  const production = contentSecurityPolicy(nonce, { NODE_ENV: "production" });
  const compiled = contentSecurityPolicy(nonce, {
    NODE_ENV: "production",
    VALO_DEVELOPMENT_SITE: "compiled",
  });
  const directive = (policy: string, name: string) =>
    policy
      .split(";")
      .map((part) => part.trim().split(" "))
      .find(([key]) => key === name)
      ?.slice(1);
  assert.deepEqual(directive(compiled, "frame-ancestors"), [
    "'self'",
    "https://replit.com",
    "https://*.replit.com",
  ]);
  // Only the framing differs: no evaluated code and no reload socket, which only the development
  // server's own tooling needs.
  for (const name of ["script-src", "connect-src", "style-src", "img-src", "frame-src", "object-src"])
    assert.deepEqual(directive(compiled, name), directive(production, name), name);
  assert.doesNotMatch(compiled, /unsafe-eval|ws:/);
  // Any other value is not the development site.
  for (const value of ["1", "true", "Compiled", ""])
    assert.deepEqual(
      directive(
        contentSecurityPolicy(nonce, { NODE_ENV: "production", VALO_DEVELOPMENT_SITE: value }),
        "frame-ancestors",
      ),
      ["'none'"],
    );
});
