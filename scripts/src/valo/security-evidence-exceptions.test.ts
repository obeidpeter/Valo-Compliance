import test from "node:test";
import assert from "node:assert/strict";
import { withoutVerifiedSourceHashFindings } from "./security-evidence-exceptions";
const known = {
  RuleID: "generic-api-key",
  File: "docs/valo/evidence/dispute-actions-development.json",
  StartLine: 60,
  EndLine: 60,
  Commit: "32834e72411fa3bfc8e39cf44aacd0c6685f7064",
};
test("only three immutable reviewed source-hash findings are excluded", () => {
  const workspace = {
    ...known,
    File: "docs/valo/evidence/workspace-export-development.json",
    StartLine: 95,
    EndLine: 95,
    Commit: "e29bacedc806e51831d5508225995d6c2fffa0be",
  };
  assert.equal(
    withoutVerifiedSourceHashFindings([
      known,
      { ...known, Commit: "6059bb30d085e0ea904599fc7902235ef0da084b" },
      workspace,
    ]).length,
    0,
  );
  for (const changed of [
    { Commit: known.Commit },
    { File: known.File },
    { StartLine: 96 },
    { EndLine: 96 },
    { RuleID: "paystack-api-key" },
    { Commit: undefined },
  ])
    assert.equal(withoutVerifiedSourceHashFindings([{ ...workspace, ...changed }]).length, 1);
  for (const changed of [
    { Commit: "f".repeat(40) },
    { File: "another-evidence.json" },
    { StartLine: 61 },
    { EndLine: 61 },
    { RuleID: "paystack-api-key" },
    { Commit: undefined },
  ])
    assert.equal(withoutVerifiedSourceHashFindings([{ ...known, ...changed }]).length, 1);
  assert.throws(() => withoutVerifiedSourceHashFindings(null));
});
test("generic credentials and new same-path findings still reach the detector summary", () => {
  const canary = {
    RuleID: "generic-api-key",
    File: known.File,
    StartLine: 60,
    EndLine: 60,
    Commit: "a".repeat(40),
  };
  assert.deepEqual(withoutVerifiedSourceHashFindings([known, canary]), [canary]);
});
