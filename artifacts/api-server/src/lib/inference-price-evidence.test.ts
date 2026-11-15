import {test} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {createHash} from "node:crypto";
import {managedPriceEvidence,assertManagedRatePolicy} from "./inference-price-evidence";
import {inferenceProposal,tokenCost,additionalInferenceAllocation} from "./inference-budget";
test("official retained model and managed-route evidence support exact policy, not actual billing",async()=>{
  for(const ref of managedPriceEvidence.sources){
    const b=await readFile(resolve(import.meta.dirname,"../../../..",ref.path));
    assert.equal(createHash("sha256").update(b).digest("hex"),ref.sha256);
    for(const text of ref.locators)assert.ok(b.toString().includes(text));
  }
  assert.doesNotThrow(()=>assertManagedRatePolicy(inferenceProposal));
  assert.equal(tokenCost(400000,8192),370550400n);
  assert.equal(additionalInferenceAllocation.startBoundary,"durable-owner-approval-of-exact-finite-package");
  assert.equal(inferenceProposal.enabled,false);
});
test("different prices, model, context, completion ceiling or evidence version cannot claim the verified bound",()=>{
  for(const p of[{...inferenceProposal,inputNanoUsdPerToken:1},{...inferenceProposal,model:"gpt-5-mini"},
    {...inferenceProposal,outputNanoUsdPerToken:1},{...inferenceProposal,upliftBps:0},
    {...inferenceProposal,priceEvidenceVersion:"unverified"},{...inferenceProposal,fallback:{inputTokens:32000,outputTokens:8192}},
    {...inferenceProposal,fallback:{inputTokens:400000,outputTokens:16384}}])
    assert.throws(()=>assertManagedRatePolicy(p),/PRICE_POLICY_UNSUPPORTED/);
});
