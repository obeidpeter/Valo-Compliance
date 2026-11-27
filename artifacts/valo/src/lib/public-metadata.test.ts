import test from "node:test";
import assert from "node:assert/strict";
import { metadataOrigin, parsePublicMetadata } from "./public-metadata";
test("metadata only accepts fixed configured origin and known safe public detail paths", () => {
  assert.equal(metadataOrigin({ NODE_ENV: "production", REPLIT_DEV_DOMAIN: "untrusted.example" }), null);
  for (const raw of [
    "http://example.test",
    "https://u:p@example.test",
    "https://example.test/private",
    "https://example.test/?q=x",
  ])
    assert.equal(metadataOrigin({ NODE_ENV: "production", VALO_TRUSTED_ORIGIN: raw }), null);
  assert.equal(
    metadataOrigin({ NODE_ENV: "production", VALO_TRUSTED_ORIGIN: "https://example.test" }),
    "https://example.test",
  );
  const entries = [
    "/library/invoice",
    "/workspace/secret",
    "/staff/users",
    "//evil.test/x",
    "/library/%2Fprivate",
    "/resources/../../workspace",
  ];
  assert.deepEqual(
    parsePublicMetadata({
      items: entries.map((path) => ({
        path,
        title: "Fixture",
        description: "Public metadata",
        modifiedAt: null,
      })),
    }).map((i) => i.path),
    ["/library/invoice"],
  );
});
