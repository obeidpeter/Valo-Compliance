import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  ErasureInventoryAttestations,
  inventoryGuardBodyHash,
  inventoryGuardDefinition,
  inventoryGuardStamp,
} from "./valo-erasure-inventory-cache";
test("cached inventory authority matches the reviewed SQL, not mutable caller policy", async () => {
  const ddl = await readFile(
    new URL("../../../../lib/db/drizzle/0022_privacy_erasure_hardening.sql", import.meta.url),
    "utf8",
  );
  const body = ddl.match(
    /CREATE FUNCTION valo_guard_erasure_inventory\(\)[\s\S]*?AS \$\$([\s\S]*?)\$\$/,
  )![1]!;
  assert.equal(createHash("sha256").update(body).digest("hex"), inventoryGuardBodyHash);
  const guard = {
    epoch: "cluster-one",
    table_oid: "1",
    trigger_oid: "2",
    trigger_revision: "3",
    function_oid: "4",
    function_revision: "5",
    enabled: "O",
    definition: inventoryGuardDefinition,
    body,
    security_definer: false,
    settings: null,
    language: "plpgsql",
    function_schema: "public",
  };
  assert.ok(inventoryGuardStamp(guard));
  for (const change of [
    { enabled: "D" },
    { body: body + "-- changed" },
    { security_definer: true },
    { settings: ["search_path=untrusted"] },
    { language: "sql" },
    { function_schema: "untrusted" },
    { definition: "different" },
  ])
    assert.equal(inventoryGuardStamp({ ...guard, ...change }), null);
  for (const change of [
    { epoch: "restored-cluster" },
    { table_oid: "99" },
    { trigger_revision: "99" },
    { function_revision: "99" },
  ])
    assert.notEqual(inventoryGuardStamp({ ...guard, ...change }), inventoryGuardStamp(guard));
});
test("same guard reuses full proof; restart, altered guard/seal, missing guard and explicit imports recheck", async () => {
  let scans = 0;
  const full = async () => {
      scans++;
    },
    cache = new ErasureInventoryAttestations();
  await cache.verify("case", "seal", "guard", full);
  for (let i = 0; i < 120; i++) await cache.verify("case", "seal", "guard", full);
  assert.equal(scans, 1);
  await cache.verify("case", "seal", "changed-trigger-xmin", full);
  await cache.verify("case", "changed-seal", "changed-trigger-xmin", full);
  await cache.verify("case", "changed-seal", null, full);
  await cache.verify("case", "changed-seal", null, full);
  await cache.verify("case", "changed-seal", "guard", full, true);
  await new ErasureInventoryAttestations().verify("case", "changed-seal", "guard", full);
  assert.equal(scans, 7);
});
test("failed checks never seed cache and bounded eviction requires a new check", async () => {
  const cache = new ErasureInventoryAttestations();
  let scans = 0;
  await assert.rejects(() =>
    cache.verify("bad", "seal", "guard", async () => {
      throw Error("tampered");
    }),
  );
  await cache.verify("bad", "seal", "guard", async () => {
    scans++;
  });
  for (let i = 0; i < 65; i++)
    await cache.verify(`case${i}`, "seal", "guard", async () => {
      scans++;
    });
  await cache.verify("bad", "seal", "guard", async () => {
    scans++;
  });
  assert.equal(scans, 67);
});
