import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import {
  inventoryHasher,
  signErasureSeal,
  startReplay,
  signReplayState,
  verifyReplayState,
} from "./valo-erasure-seal";
const signer = { version: "synthetic-cursor-fixture", key: randomBytes(32).toString("hex") };
function fixture(
  scope: "development-application-content-erasure-v2" | "development-application-content-erasure-v3",
) {
  const workspaceId = randomUUID(),
    cursor = `workspace-export-scratch/${workspaceId}/${randomUUID()}`;
  const inventory = inventoryHasher(workspaceId);
  inventory.add(cursor);
  const actual = inventory.finish();
  const seal = signErasureSeal(
    {
      version: 2,
      caseId: randomUUID(),
      workspaceId,
      identityHash: "a".repeat(64),
      identityKeyVersion: signer.version,
      scope,
      synthetic: true,
      inventoryHash: actual.hash,
      inventoryCount: actual.count,
      completedEventHash: "b".repeat(64),
    },
    signer,
  );
  return { seal, cursor };
}
test("v3 recovery resumes after a signed scratch-locator cursor rather than becoming permanently held", () => {
  const { seal, cursor } = fixture("development-application-content-erasure-v3");
  const state = signReplayState({ ...startReplay(seal, "application", signer), cursor }, signer);
  assert.equal(verifyReplayState(state, seal, 25, signer.key).cursor, cursor);
  const foreign = signReplayState(
    { ...state, cursor: `workspace-export-scratch/${randomUUID()}/${randomUUID()}` },
    signer,
  );
  assert.throws(() => verifyReplayState(foreign, seal, 25, signer.key), /ERASURE_OBJECT_SCOPE_INVALID/);
});
test("old v2 recovery does not acquire new scratch-locator authority", () => {
  const { seal, cursor } = fixture("development-application-content-erasure-v2");
  const state = signReplayState({ ...startReplay(seal, "application", signer), cursor }, signer);
  assert.throws(() => verifyReplayState(state, seal, 17, signer.key), /ERASURE_OBJECT_SCOPE_INVALID/);
});
