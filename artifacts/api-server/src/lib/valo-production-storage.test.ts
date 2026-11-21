import test from "node:test";
import assert from "node:assert/strict";
import { privateStorageScope, privateObjectName, storageProbeName } from "../platform/valo-storage-scope";
import { productionPreflight } from "../platform/valo-production-readiness";
import { runStorageProbe, type ProbeClient } from "../platform/valo-storage-probe";
const id = "11111111-1111-4111-8111-111111111111",
  asset = "22222222-2222-4222-8222-222222222222";
const env = {
  NODE_ENV: "production",
  PRIVATE_OBJECT_DIR: "/synthetic-bucket/development",
  VALO_PRODUCTION_PRIVATE_OBJECT_DIR: "/synthetic-bucket/production",
  VALO_WORKER_TOPOLOGY: "replit-reserved-vm-same-app",
  VALO_WORKER_REPLICAS: "1",
  VALO_RELEASE_SHA: "a".repeat(40),
  VALO_WORKER_HEALTH_PORT: "8082",
  PORT: "8080",
};
test("production storage is explicit, canonical and separate from every ancestor of development", () => {
  const scope = privateStorageScope("production", env);
  assert.equal(
    privateObjectName(scope, `valo/production/${id}/${asset}.pdf`),
    `production/valo/production/${id}/${asset}.pdf`,
  );
  for (const root of [
    undefined,
    "",
    env.PRIVATE_OBJECT_DIR,
    "/synthetic-bucket/development/child",
    "/synthetic-bucket/development/../production",
    "/synthetic-bucket/production//private",
    "/synthetic-bucket/%2e%2e",
    "/synthetic-bucket/..",
    "https://synthetic-bucket/production",
    "/synthetic-bucket/back\\slash",
    "/synthetic-bucket\n/production",
    "/synthetic-bucket/production\n/child",
  ])
    assert.throws(() =>
      privateStorageScope("production", { ...env, VALO_PRODUCTION_PRIVATE_OBJECT_DIR: root }),
    );
  assert.throws(
    () =>
      privateStorageScope("production", { ...env, PRIVATE_OBJECT_DIR: "/synthetic-bucket/production/child" }),
    /OVERLAP/,
  );
  assert.throws(() => privateStorageScope("development", env), /development is required/);
  for (const key of [
    `valo/development/${id}/${asset}.pdf`,
    `valo/production/${id}/../${asset}.pdf`,
    `valo/production/${"-".repeat(36)}/${asset}.pdf`,
    `valo/production/${id}/${asset}.pdf?public=true`,
    `valo/production/${id}/${asset}.PDF`,
    `valo/production/${id}/${asset}.pdf\n`,
  ])
    assert.throws(() => privateObjectName(scope, key), /INVALID_PRIVATE_KEY/);
  assert.throws(() => storageProbeName(scope, id + "\n"), /INVALID_STORAGE_PROBE_SCOPE/);
  const report = productionPreflight(env);
  assert.equal(report.configurationValid, true);
  assert.equal(report.launchReady, false);
  assert.equal(report.workerActivationEnabled, false);
  assert.ok(!JSON.stringify(report).includes("synthetic-bucket"));
  assert.ok(!JSON.stringify(report).includes(env.PRIVATE_OBJECT_DIR));
  for (const topology of [undefined, "autoscale", "scheduled", "separate-replit-app"])
    assert.equal(productionPreflight({ ...env, VALO_WORKER_TOPOLOGY: topology }).configurationValid, false);
  for (const port of ["0", "65536", "8080", "-1", " 8082 ", "8082\n"])
    assert.equal(productionPreflight({ ...env, VALO_WORKER_HEALTH_PORT: port }).configurationValid, false);
  assert.equal(
    productionPreflight({ ...env, VALO_RELEASE_SHA: env.VALO_RELEASE_SHA + "\n" }).configurationValid,
    false,
  );
});
test("candidate adapter rejects development keys before native SDK effects and preserves immutable writes", async (t) => {
  const calls: string[] = [],
    files = new Map<string, Buffer>();
  t.mock.module("@replit/object-storage", {
    namedExports: {
      Client: class {
        constructor(options: { bucketId: string }) {
          calls.push("client:" + options.bucketId);
        }
        async exists(name: string) {
          calls.push("exists:" + name);
          return { ok: true, value: files.has(name) };
        }
        async uploadFromBytes(name: string, bytes: Buffer) {
          calls.push("put:" + name);
          files.set(name, bytes);
          return { ok: true };
        }
        async downloadAsBytes(name: string) {
          calls.push("get:" + name);
          return files.has(name) ? { ok: true, value: [files.get(name)!] } : { ok: false };
        }
        async delete(name: string) {
          calls.push("delete:" + name);
          files.delete(name);
          return { ok: true };
        }
      },
    },
  });
  const { productionPrivateStorage, fileChecksum } = await import("../platform/valo-private-storage");
  const store = productionPrivateStorage(env),
    key = `valo/production/${id}/${asset}.pdf`,
    bytes = Buffer.from("synthetic private production canary");
  await assert.rejects(
    store.read(`valo/development/${id}/${asset}.pdf`, fileChecksum(bytes)),
    /INVALID_PRIVATE_KEY/,
  );
  await assert.rejects(store.write(`valo/development/${id}/${asset}.pdf`, bytes), /INVALID_PRIVATE_KEY/);
  await assert.rejects(store.remove(`valo/development/${id}/${asset}.pdf`), /INVALID_PRIVATE_KEY/);
  assert.equal(calls.length, 0);
  await store.write(key, bytes);
  assert.deepEqual(await store.read(key, fileChecksum(bytes)), bytes);
  await assert.rejects(store.write(key, Buffer.from("overwrite")), /ALREADY_WRITTEN/);
  assert.equal(calls.filter((c) => c.startsWith("put:")).length, 1);
  await assert.rejects(store.read(key, "0".repeat(64)), /CHECKSUM_MISMATCH/);
  await store.remove(key);
  assert.equal(files.size, 0);
  assert.ok(
    calls.filter((c) => !c.startsWith("client:")).every((c) => c.includes("production/valo/production/")),
  );
});
test("production canary verifies exact bytes, anonymous denial and confirmed deletion, never customer keys", async (t) => {
  const scope = privateStorageScope("production", env),
    name = storageProbeName(scope, id),
    files = new Map<string, Buffer>();
  let deletes = 0,
    deny = 403,
    absenceFails = false,
    throwUpload = false;
  const client: ProbeClient = {
    exists: async (n) => (absenceFails ? { ok: false } : { ok: true, value: files.has(n) }),
    uploadFromBytes: async (n, b) => {
      files.set(n, b);
      if (throwUpload) throw Error("PROBE_PROVIDER_CREDENTIAL_MUST_NOT_LEAK");
      return { ok: true };
    },
    downloadAsBytes: async (n) => ({ ok: true, value: [files.get(n)!] }),
    delete: async (n) => {
      assert.equal(n, name);
      deletes++;
      files.delete(n);
      return { ok: true };
    },
  };
  await t.test("round trip and repeat cleanup succeed without granting launch", async () => {
    const result = await runStorageProbe(scope, id, "start", client, async () => deny);
    assert.equal(result.passed, true);
    assert.equal(result.launchReady, false);
    assert.equal(files.size, 0);
    assert.equal(
      (
        await runStorageProbe(scope, id, "cleanup", client, async () => {
          throw Error("UNEXPECTED_FETCH");
        })
      ).passed,
      true,
    );
  });
  await t.test("public response fails and still cleans its canary", async () => {
    deny = 200;
    const result = await runStorageProbe(scope, id, "start", client, async () => deny);
    assert.equal(result.passed, false);
    assert.equal(result.errorCode, "PROBE_ANONYMOUS_READ_NOT_DENIED");
    assert.equal(result.cleanupConfirmed, true);
    deny = 403;
  });
  await t.test("existing keys are not overwritten or deleted by a fresh probe", async () => {
    files.set(name, Buffer.from("earlier probe"));
    const before = deletes;
    assert.equal(
      (await runStorageProbe(scope, id, "start", client, async () => deny)).errorCode,
      "PROBE_KEY_ALREADY_EXISTS",
    );
    assert.equal(deletes, before);
    files.clear();
  });
  await t.test("accepted write with lost acknowledgement is cleaned and errors are redacted", async () => {
    throwUpload = true;
    const r = await runStorageProbe(scope, id, "start", client, async () => deny);
    assert.equal(r.passed, false);
    assert.equal(r.cleanupConfirmed, true);
    assert.equal(files.size, 0);
    assert.equal(r.errorCode, "PROBE_PROVIDER_UNAVAILABLE");
    assert.ok(!JSON.stringify(r).includes("CREDENTIAL_MUST_NOT_LEAK"));
    throwUpload = false;
  });
  await t.test("delete success without an absence check is not a cleanup receipt", async () => {
    absenceFails = true;
    const r = await runStorageProbe(scope, id, "cleanup", client, async () => deny);
    assert.equal(r.passed, false);
    assert.equal(r.cleanupConfirmed, false);
    absenceFails = false;
    const before = deletes;
    await assert.rejects(
      runStorageProbe(scope, `../${id}`, "cleanup", client, async () => deny),
      /INVALID_STORAGE_PROBE_SCOPE/,
    );
    assert.equal(deletes, before);
  });
});
