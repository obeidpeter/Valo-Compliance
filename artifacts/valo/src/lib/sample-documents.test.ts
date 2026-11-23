import assert from "node:assert/strict";
import { test } from "node:test";
import { GUIDED_SPECS_V1 } from "@workspace/valo-core/guided-specs";
import {
  guidedContentConsistent,
  guidedDataFromBlocks,
  guidedDataIssues,
} from "@workspace/valo-core/guided-runtime";
import { buildPublicSampleDocuments } from "./sample-documents";

test("buildPublicSampleDocuments produces complete, consistent synthetic guided previews", () => {
  const samples = buildPublicSampleDocuments();
  assert.equal(samples.length, 3);
  for (const sample of samples) {
    assert.equal(guidedContentConsistent(sample.content), true, `${sample.id} consistent`);
    const parsed = guidedDataFromBlocks(sample.content.blocks);
    assert.ok(parsed, `${sample.id} round-trips`);
    const issues = guidedDataIssues(GUIDED_SPECS_V1[sample.id], parsed!);
    assert.deepEqual(issues, {}, `${sample.id} has zero missing required answers`);
  }
});
