import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  signErasureSeal,
  signReplayState,
  verifyReplayState,
  erasureSealHash,
} from "../modules/privacy/valo-erasure-seal";
test("signed historical phase15 and literal done retain meaning after native appended dispute phase", () => {
  const signer = { version: "controlled", key: "controlled-test-signing-key-".repeat(3) };
  const seal = signErasureSeal(
    {
      version: 2,
      caseId: randomUUID(),
      workspaceId: randomUUID(),
      identityHash: "a".repeat(64),
      identityKeyVersion: "controlled",
      scope: "development-application-content-erasure-v2",
      synthetic: true,
      inventoryHash: "b".repeat(64),
      inventoryCount: 0,
      completedEventHash: "c".repeat(64),
    },
    signer,
  );
  for (const phase of [15, "done"] as const) {
    const signed = signReplayState(
      {
        version: 1,
        cycleId: randomUUID(),
        mode: "application",
        phase,
        cursor: "",
        sealHash: erasureSealHash(seal),
      },
      signer,
    );
    assert.equal(verifyReplayState(signed, seal, 16, signer.key).phase, phase);
    assert.equal(verifyReplayState(signed, seal, 17, signer.key).phase, phase);
    assert.throws(() => verifyReplayState({ ...signed, phase: 16 }, seal, 17, signer.key));
  }
});
