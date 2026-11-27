import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { erasureProofMode, erasureProofStorage } from "./erasure-proof-storage";
test("native proof is explicit, fails closed before fixtures without configuration, and cannot use CI storage", () => {
  assert.equal(erasureProofMode({ PRIVATE_OBJECT_DIR: "configured-but-not-selected" }), "portable");
  assert.throws(() => erasureProofMode({ VALO_ERASURE_STORAGE_PROOF: "native-replit" }), /UNCONFIGURED/);
  for (const CI of ["1", "true", "false", "arbitrary", " "])
    assert.throws(
      () =>
        erasureProofMode({
          CI,
          VALO_ERASURE_STORAGE_PROOF: "native-replit",
          PRIVATE_OBJECT_DIR: "synthetic-placeholder",
        }),
      /FORBIDDEN_IN_CI/,
    );
  assert.throws(() => erasureProofMode({ VALO_ERASURE_STORAGE_PROOF: "pretend-native" }), /UNKNOWN/);
});
test("portable object bytes, immutable keys, checksum, scoped cleanup and failure behavior are real local I/O, not provider proof", async () => {
  const id = randomUUID(),
    s = await erasureProofStorage(id, "portable"),
    key = `valo/development/${id}/${randomUUID()}.pdf`;
  try {
    const bytes = Buffer.from("NEW-SYNTHETIC-ERASURE-ONLY"),
      written = await s.write(key, bytes);
    assert.deepEqual(await s.read(key, written.checksum), bytes);
    await assert.rejects(() => s.write(key, bytes), /EEXIST/);
    await assert.rejects(() => s.read(key, "0".repeat(64)), /CHECKSUM_MISMATCH/);
    await assert.rejects(() => s.remove(`valo/development/${randomUUID()}/${randomUUID()}.pdf`), /OUTSIDE/);
    await assert.rejects(() => s.remove("../outside"), /OUTSIDE/);
    await s.remove(key);
    await s.remove(key);
    await assert.rejects(() => s.read(key, written.checksum), /PRIVATE_STORAGE_READ_FAILED/);
    assert.equal(s.backend, "controlled-private-filesystem");
  } finally {
    await s.close();
  }
});
