/** Explicit, test-only native storage boundary; never used by application cleanup. */
import assert from "node:assert/strict";
import { Client } from "@replit/object-storage";
assert.equal(process.env.NODE_ENV, "development");
assert.equal(process.env.VALO_RUN_DB_TESTS, "synthetic-development-only");
assert.ok(!process.env.CI);
assert.ok(
  !Object.keys(process.env).some(
    (k) => (k === "REPLIT_DEPLOYMENT" || k.startsWith("REPLIT_DEPLOYMENT_")) && process.env[k],
  ),
);
const namespace = process.env.VALO_NATIVE_PROOF_NAMESPACE;
assert.match(namespace ?? "", /^valo-native-proof-[a-f0-9-]{36}$/);
const parts = (process.env.PRIVATE_OBJECT_DIR ?? "").replace(/^\/+|\/+$/g, "").split("/");
const bucket = parts.shift();
assert.ok(bucket && parts.length >= 2 && parts.at(-1) === namespace);
const prefix = parts.join("/") + "/";
const action = process.argv[2];
assert.ok(action === "verify-empty" || action === "cleanup");
const client = new Client({ bucketId: bucket });
let removed = 0;
for (let page = 0; page < 100; page++) {
  const listed = await client.list({ prefix, maxResults: 100 });
  if (!listed.ok) throw Error("NATIVE_PROOF_NAMESPACE_LIST_FAILED");
  const objects = listed.value;
  if (!objects.length) {
    console.log(JSON.stringify({ action, empty: true, removed }));
    process.exit(0);
  }
  if (action === "verify-empty") throw Error("NATIVE_PROOF_NAMESPACE_NOT_EMPTY");
  // Validate the entire page before deleting any item. Only this freshly minted
  // test subtree and the application's constrained private key grammar qualify.
  for (const object of objects) {
    assert.ok(object.name.startsWith(prefix));
    assert.match(
      object.name.slice(prefix.length),
      /^valo\/development\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.(docx|pdf|json)$/,
    );
  }
  for (const object of objects) {
    const result = await client.delete(object.name, { ignoreNotFound: true });
    if (!result.ok) throw Error("NATIVE_PROOF_NAMESPACE_CLEANUP_HELD");
    removed++;
  }
}
throw Error("NATIVE_PROOF_NAMESPACE_CLEANUP_BOUND_REACHED");
