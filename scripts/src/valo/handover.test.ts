import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { handoverCheckpoint } from "@workspace/valo-core";
test("documentation checkpoint is a real ancestor, not a copied revision label", () => {
  assert.doesNotThrow(() =>
    execFileSync("git", ["merge-base", "--is-ancestor", handoverCheckpoint.baselineCommit, "HEAD"]),
  );
  assert.equal(handoverCheckpoint.localHistoryIncorporated, true);
});
test("original specification bytes and requirement facts remain pinned; evidence annotations may only append", () => {
  for (const f of handoverCheckpoint.files) {
    const bytes = readFileSync(new URL("../../../" + f.path, import.meta.url));
    const original = execFileSync("git", ["show", `${handoverCheckpoint.baselineCommit}:${f.path}`]);
    assert.equal(createHash("sha256").update(original).digest("hex"), f.sha256, f.path);
    assert.equal(original.length, f.bytes, f.path);
    if (f.path === "docs/registers/requirements.json") {
      const baseline = JSON.parse(original.toString()),
        current = JSON.parse(bytes.toString());
      const rows = current.requirements;
      assert.equal(rows.length, baseline.requirements.length);
      current.requirements = rows.map((row: Record<string, unknown>, i: number) => {
        const source = baseline.requirements[i];
        assert.ok(Array.isArray(row.evidence));
        assert.deepEqual(row.evidence.slice(0, source.evidence.length), source.evidence);
        assert.ok(row.evidence.every((entry: unknown) => typeof entry === "string" && entry.length > 0));
        return { ...row, evidence: source.evidence };
      });
      // Added engineering references cannot change requirement text, scope,
      // implementation status or acceptance claims from the original record.
      assert.deepEqual(current, baseline);
    } else assert.deepEqual(bytes, original, f.path);
  }
  assert.equal(handoverCheckpoint.files.length, 10);
  assert.deepEqual(handoverCheckpoint.counts, {
    exactRequirements: 127,
    baselineTemplates: 40,
    supplementaryMappings: 27,
    regulatoryRows: 79,
  });
});
test("a documentation merge proves neither application upload nor title mutation nor gate approval", () => {
  assert.equal(handoverCheckpoint.remoteApplicationSourceSyncVerified, false);
  assert.equal(handoverCheckpoint.remoteCiVerified, false);
  assert.equal(handoverCheckpoint.protectionEnforcementVerified, false);
  assert.equal(handoverCheckpoint.title.projectMetadataChanged, false);
  assert.ok(Object.values(handoverCheckpoint.approvals).every((v) => v === false));
});
