/** Disposable Windows target only. Source is an independently prepared synthetic
 * Replit snapshot; provider credentials and application/customer traffic are absent. */
import { readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { assertDevelopmentRuntime } from "../platform/valo-development-runtime";
import {
  assertIsolatedRecoveryTarget,
  replayRecoveryControls,
  signRecoveryControls,
  type RecoveryControls,
} from "../modules/recovery";
const hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");
assertDevelopmentRuntime();
assert.equal(process.platform, "win32");
const root = process.env.VALO_RECOVERY_WINDOWS_ROOT ?? "";
assert.equal(root, resolve(root));
const bundle = join(root, "bundle"),
  mode = process.argv[2];
assert.ok(mode);
const keys = JSON.parse(await readFile(join(bundle, "synthetic-keys.json"), "utf8"));
assert.equal(keys.syntheticOnly, true);
// These keys were freshly generated for these disposable fixtures, never copied from the app.
process.env.SESSION_SECRET = keys.SESSION_SECRET;
const key = Buffer.from(keys.controlKey, "hex");
assert.equal(key.length, 32);
const saved = JSON.parse(await readFile(join(bundle, "controls.json"), "utf8")) as {
  controls: RecoveryControls;
  signature: string;
  snapshotHash: string;
};
assert.equal(hash(await readFile(join(bundle, "synthetic.dump"))), saved.snapshotHash);
const fixtures = JSON.parse(await readFile(join(bundle, "fixtures.json"), "utf8"));
assert.equal(fixtures.length, 3);
const { pool } = await import("@workspace/db");
const { replayErasedApplication, closePrivacyErasureLocks } = await import("../modules/privacy");
const client = await pool.connect();
try {
  await assertIsolatedRecoveryTarget(client);
  if (mode === "reject-tampered") {
    const before = (await client.query("SELECT count(*)::int AS n FROM valo_privacy_tombstones")).rows[0].n;
    assert.equal(before, 0);
    await assert.rejects(
      replayRecoveryControls(client, saved.controls, saved.signature, Buffer.alloc(32), saved.snapshotHash),
      /BINDING/,
    );
    const changed = structuredClone(saved.controls);
    const receipt = changed.erasureReceipts![0] as {
      records: { valo_privacy_tombstones: { erasure_seal: { mac: string } }[] };
    };
    receipt.records.valo_privacy_tombstones[0]!.erasure_seal.mac = "0".repeat(64);
    await assert.rejects(
      replayRecoveryControls(client, changed, signRecoveryControls(changed, key), key, saved.snapshotHash),
      /ERASURE_SEAL_INVALID/,
    );
    const swapped = structuredClone(saved.controls);
    swapped.entries[0]!.workspaceId = fixtures[2].workspaceId;
    await assert.rejects(
      replayRecoveryControls(client, swapped, signRecoveryControls(swapped, key), key, saved.snapshotHash),
    );
    assert.equal((await client.query("SELECT count(*)::int AS n FROM valo_privacy_tombstones")).rows[0].n, 0);
    assert.equal(
      (await client.query("SELECT count(*)::int AS n FROM valo_memberships WHERE active='yes'")).rows[0].n,
      3,
    );
    console.log(
      JSON.stringify({
        tamperedReceiptRejected: true,
        wrongKeyRejected: true,
        crossTenantRejected: true,
        failedImportsRolledBack: true,
      }),
    );
  } else if (mode === "quarantine") {
    await replayRecoveryControls(client, saved.controls, saved.signature, key, saved.snapshotHash);
    await replayRecoveryControls(client, saved.controls, saved.signature, key, saved.snapshotHash);
    const { resolveWorkspace } = await import("../lib/valo-store");
    await assert.rejects(resolveWorkspace(fixtures[0].identityId), { status: 403 });
    await assert.rejects(resolveWorkspace(fixtures[1].identityId), { status: 403 });
    const third = await resolveWorkspace(fixtures[2].identityId);
    assert.equal(third.workspaceId, fixtures[2].workspaceId);
    console.log(
      JSON.stringify({
        changedReceiptImported: true,
        idempotentImport: true,
        deletedIdentityDenied: true,
        revokedMemberDenied: true,
        unaffectedTenantAccessible: true,
      }),
    );
  } else if (["fail-object", "crash-after-object", "complete"].includes(mode)) {
    await replayRecoveryControls(client, saved.controls, saved.signature, key, saved.snapshotHash);
    const entry = saved.controls.entries.find((e) => e.kind === "deletion")!;
    const { assertErasureObjectScope } = await import("../modules/privacy");
    let remaining = true,
      failed = 0,
      deleted = 0;
    for (let n = 0; n < 100 && remaining && !failed; n++) {
      const result = await replayErasedApplication(entry.id, async (locator) => {
        assertErasureObjectScope(entry.workspaceId, locator);
        if (mode === "fail-object") throw Error("CONTROLLED_STORAGE_FAILURE");
        await rm(join(bundle, "objects", ...locator.split("/").slice(2)), { force: true });
        deleted++;
        if (mode === "crash-after-object") process.exit(73);
      });
      remaining = result.remaining;
      failed += result.failed;
    }
    if (mode === "fail-object") assert.ok(failed > 0 && remaining);
    if (mode === "complete") {
      assert.equal(remaining, false);
      assert.equal(failed, 0);
      const object = join(bundle, "objects", fixtures[0].workspaceId, fixtures[0].documentId + ".docx");
      await assert.rejects(readFile(object), { code: "ENOENT" });
      assert.equal(
        (
          await client.query("SELECT count(*)::int AS n FROM valo_documents WHERE workspace_id=$1", [
            entry.workspaceId,
          ])
        ).rows[0].n,
        0,
      );
      assert.equal(
        (
          await client.query("SELECT count(*)::int AS n FROM valo_file_assets WHERE workspace_id=$1", [
            entry.workspaceId,
          ])
        ).rows[0].n,
        0,
      );
      const bytes = await readFile(
        join(bundle, "objects", fixtures[2].workspaceId, fixtures[2].documentId + ".docx"),
      );
      assert.equal(hash(bytes), fixtures[2].checksum);
      const { resolveWorkspace } = await import("../lib/valo-store");
      await assert.rejects(resolveWorkspace(fixtures[0].identityId), { status: 403 });
      await assert.rejects(resolveWorkspace(fixtures[1].identityId), { status: 403 });
    }
    console.log(
      JSON.stringify({
        remaining,
        failed,
        deleted,
        physicalApplicationReplayComplete: !remaining,
        externalProvidersFulfilled: false,
      }),
    );
  } else throw Error("RECOVERY_MODE_INVALID");
} finally {
  client.release();
  await closePrivacyErasureLocks();
  await pool.end();
}
