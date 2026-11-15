import{test}from"node:test";
import assert from"node:assert/strict";
import{resolve}from"node:path";
import{readFile}from"node:fs/promises";
import{exactDigestField,verifyHistoricalDigestDispositions}from"./merge-security-dispositions";
test("four exact historical findings recompute to their immutable source file hashes",async()=>{
  assert.deepEqual(await verifyHistoricalDigestDispositions(resolve(import.meta.dirname,"../../../")),{
    exactHistoricalSourceDigestsVerified:4,generalRuleExemption:false,futureCommitExemption:false});
});
test("database HTTP and queue-payload proofs run after their real CI prerequisites",async()=>{
  const workflow=await readFile(resolve(import.meta.dirname,"../../../.github/workflows/valo-foundation.yml"),"utf8");
  const dbJob=workflow.indexOf("name: Synthetic PostgreSQL isolation and concurrency");
  const migrations=workflow.indexOf("name: Apply tracked migrations to empty synthetic database");
  const queue=workflow.indexOf("name: Install reviewed durable queue before payload and erasure tests");
  const erasure=workflow.indexOf("name: Prove synthetic erasure holds, late-upload races and bounded recovery");
  const http=workflow.indexOf("name: Prove dispute HTTP and transport controls without merchant calls");
  assert.ok(dbJob>=0&&migrations>dbJob&&queue>migrations&&erasure>queue&&http>queue);
  assert.equal(workflow.split("run: pnpm --filter @workspace/api-server test:valo-disputes\n").length-1,1);
});
test("a name, value, length or extra-content mismatch cannot receive the digest disposition",()=>{
  const source="artifacts/api-server/src/lib/valo-customer-access.ts",hash="a".repeat(64);
  assert.ok(exactDigestField(`"${source}": "${hash}",`,source,hash));
  for(const value of[`"api_key": "${hash}"`,`"${source}": "${"b".repeat(64)}"`,
    `"${source}": "${"a".repeat(63)}"`,`"${source}": "${hash}", "extra":true`])
    assert.equal(exactDigestField(value,source,hash),false);
});
