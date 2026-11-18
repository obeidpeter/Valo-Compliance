import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertErasureObjectScope,
  inventoryHasher,
  signErasureSeal,
  verifyErasureSeal,
  assertSealedInventory,
  startReplay,
  signReplayState,
  verifyReplayState,
} from "./valo-erasure-seal";
const workspaceId = "11111111-1111-4111-8111-111111111111",
  caseId = "22222222-2222-4222-8222-222222222222";
const oldKey = "synthetic-old-key-only-01234567890123456789",
  newKey = "synthetic-new-key-only-01234567890123456789";
const oldSigner = { version: "synthetic-v1", key: oldKey },
  nextSigner = { version: "synthetic-v2", key: newKey };
const first = `valo/development/${workspaceId}/33333333-3333-4333-8333-333333333333.pdf`;
const second = `valo/development/${workspaceId}/44444444-4444-4444-8444-444444444444.pdf`;
const third = `valo/development/${workspaceId}/55555555-5555-4555-8555-555555555555.docx`;
function inventory(keys: string[]) {
  const h = inventoryHasher(workspaceId);
  for (const key of keys) h.add(key);
  return h.finish();
}
function fixture() {
  const exact = inventory([first, second]),
    binding = { caseId, workspaceId, identityHash: "c".repeat(64), identityKeyVersion: oldSigner.version };
  const seal = signErasureSeal(
    {
      version: 2,
      ...binding,
      scope: "development-application-content-erasure-v2",
      synthetic: true,
      inventoryHash: exact.hash,
      inventoryCount: exact.count,
      completedEventHash: "a".repeat(64),
    },
    oldSigner,
  );
  return { seal, binding };
}
test("exact erasure inventory and recovery signing", async (t) => {
  await t.test(
    "ordered inventory rejects same-workspace replacement, omission, addition and duplicates",
    () => {
      const { seal } = fixture();
      assertSealedInventory(seal, inventory([first, second]));
      for (const keys of [[first], [first, third], [first, second, third]])
        assert.throws(() => assertSealedInventory(seal, inventory(keys)), /INVENTORY_CHANGED/);
      assert.throws(() => inventory([first, first]), /ORDER_INVALID/);
      assert.throws(() => inventory([second, first]), /ORDER_INVALID/);
      assert.throws(
        () => assertErasureObjectScope(workspaceId, first.replace(workspaceId, caseId)),
        /SCOPE_INVALID/,
      );
    },
  );
  await t.test(
    "scope, identity and completion binding changes and unsigned legacy records hold closed",
    () => {
      const { seal, binding } = fixture();
      assert.deepEqual(verifyErasureSeal(seal, binding, oldKey), seal);
      for (const patch of [
        { workspaceId: caseId },
        { caseId: workspaceId },
        { inventoryCount: 1 },
        { inventoryHash: "b".repeat(64) },
        { identityHash: "b".repeat(64) },
        { completedEventHash: null },
        { synthetic: false },
        { scope: "production" },
      ])
        assert.throws(() => verifyErasureSeal({ ...seal, ...patch }, binding, oldKey), /SEAL_INVALID/);
      assert.throws(() => verifyErasureSeal(null, binding, oldKey), /SEAL_INVALID/);
    },
  );
  await t.test(
    "old proofs verify with retained material while new progress uses the new pinned signer",
    () => {
      const { seal, binding } = fixture(),
        state = startReplay(seal, "application", oldSigner);
      assert.equal(verifyErasureSeal(seal, binding, oldKey).mac, seal.mac);
      assert.equal(verifyReplayState(state, seal, 12, oldKey).mac, state.mac);
      const advanced = signReplayState({ ...state, phase: 0, cursor: second }, nextSigner);
      assert.equal(advanced.keyVersion, "synthetic-v2");
      assert.equal(verifyReplayState(advanced, seal, 12, newKey).phase, 0);
      assert.throws(() => verifyErasureSeal(seal, binding, newKey), /SEAL_INVALID/);
      assert.throws(() => verifyErasureSeal(seal, binding, ""), /KEY_REQUIRED/);
      // Database pinning and historical-key lookup are tested separately by
      // valo-privacy-keys.integration.test.ts; these are cryptographic controls.
    },
  );
  await t.test("persisted progress cannot skip a phase, change cursor or cross an inventory version", () => {
    const { seal } = fixture(),
      state = startReplay(seal, "application", oldSigner);
    for (const patch of [
      { cursor: second },
      { phase: 11 },
      { phase: "done" },
      { mode: "objects" },
      { cycleId: caseId },
    ])
      assert.throws(() => verifyReplayState({ ...state, ...patch }, seal, 12, oldKey), /STATE_INVALID/);
    const revised = signErasureSeal({ ...seal, completedEventHash: "c".repeat(64) }, oldSigner);
    assert.throws(() => verifyReplayState(state, revised, 12, oldKey), /STATE_INVALID/);
    const valid = signReplayState({ ...state, phase: 3, cursor: second }, oldSigner);
    assert.equal(verifyReplayState(valid, seal, 12, oldKey).phase, 3);
  });
});
