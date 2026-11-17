import assert from "node:assert/strict";
import test from "node:test";
import { trustedSiteOrigin, permittedMutationOrigin } from "./valo-site-origin";
test("trusted site comes only from server configuration; production never falls back to a development hostname", () => {
  assert.equal(
    trustedSiteOrigin({ NODE_ENV: "development", REPLIT_DEV_DOMAIN: "synthetic.example" }),
    "https://synthetic.example",
  );
  assert.equal(
    trustedSiteOrigin({ NODE_ENV: "production", REPLIT_DEV_DOMAIN: "synthetic.example" }),
    undefined,
  );
  for (const key of ["REPLIT_DEPLOYMENT_ID", "REPLIT_DEPLOYMENT_TYPE", "REPLIT_DEPLOYMENT_FUTURE"])
    assert.equal(
      trustedSiteOrigin({ NODE_ENV: "development", REPLIT_DEV_DOMAIN: "synthetic.example", [key]: "false" }),
      undefined,
    );
  assert.equal(
    trustedSiteOrigin({ NODE_ENV: "production", VALO_TRUSTED_ORIGIN: "https://synthetic.example:8443" }),
    "https://synthetic.example:8443",
  );
  for (const raw of [
    "https://user:password@synthetic.example",
    "https://synthetic.example/path",
    "https://one.example,https://two.example",
    "http://synthetic.example",
  ])
    assert.equal(trustedSiteOrigin({ NODE_ENV: "production", VALO_TRUSTED_ORIGIN: raw }), undefined);
});
test("origin comparison includes scheme, port and exact serialized origin", () => {
  const trusted = "https://synthetic.example";
  assert.ok(permittedMutationOrigin(trusted, trusted));
  for (const origin of [
    undefined,
    "null",
    "http://synthetic.example",
    "https://synthetic.example:8443",
    "https://evil.example",
    "https://synthetic.example@evil.example",
    "https://synthetic.example/path",
    "https://synthetic.example, https://evil.example",
    "https://synthetic.example/",
  ])
    assert.equal(permittedMutationOrigin(origin, trusted), false, origin);
});
