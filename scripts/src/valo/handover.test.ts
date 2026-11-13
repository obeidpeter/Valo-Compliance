import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { handoverCheckpoint } from "@workspace/valo-core";
test("documentation checkpoint is a real ancestor, not a copied revision label",()=>{
  assert.doesNotThrow(()=>execFileSync("git",["merge-base","--is-ancestor",handoverCheckpoint.baselineCommit,"HEAD"]));
  assert.equal(handoverCheckpoint.localHistoryIncorporated,true);
});
test("all retained specification/register files still match their source checkpoint hashes",()=>{
  for(const f of handoverCheckpoint.files){
    const bytes=readFileSync(new URL("../../../"+f.path,import.meta.url));
    assert.equal(createHash("sha256").update(bytes).digest("hex"),f.sha256);
    assert.equal(bytes.length,f.bytes);
  }
  assert.equal(handoverCheckpoint.files.length,10);
  assert.deepEqual(handoverCheckpoint.counts,{exactRequirements:127,baselineTemplates:40,supplementaryMappings:27,regulatoryRows:79});
});
test("a documentation merge proves neither application upload nor title mutation nor gate approval",()=>{
  assert.equal(handoverCheckpoint.remoteApplicationSourceSyncVerified,false);
  assert.equal(handoverCheckpoint.remoteCiVerified,false);
  assert.equal(handoverCheckpoint.protectionEnforcementVerified,false);
  assert.equal(handoverCheckpoint.title.projectMetadataChanged,false);
  assert.ok(Object.values(handoverCheckpoint.approvals).every(v=>v===false));
});
