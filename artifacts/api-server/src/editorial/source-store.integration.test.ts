import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db,pool,valoSourceSnapshots } from "@workspace/db";
import { eq,inArray,desc } from "drizzle-orm";
import { sourceEvidenceRegister } from "./source-register";
import { probePrivateSource } from "./source-storage";
test("development source history and public metadata never imply review or leak object keys",{
  skip:process.env.VALO_RUN_SOURCE_TESTS!=="official-development-only",
},async t=>{
  assert.equal(process.env.NODE_ENV,"development");
  const ids=[randomUUID(),randomUUID()];
  const hidden=`PRIVATE-FIXTURE-KEY-${randomUUID()}`;
  try{
    for(const [i,id] of ids.entries())await db.insert(valoSourceSnapshots).values({
      id,sourceId:"S24",url:"https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf",
      // Deliberately historical synthetic fixture; cannot supersede a current real retrieval.
      attemptedAt:new Date(`2000-01-0${i+1}T00:00:00.000Z`),status:"held_test_fixture",
      extractionVersion:"synthetic-fixture",rawObjectKey:hidden,
      metadata:{policyApproved:true,publishedAt:"FORGED",aiReviewedAt:"FORGED",synthetic:true},
    });
    await t.test("a second attempt preserves rather than mutates prior snapshot history",async()=>{
      const rows=await db.select().from(valoSourceSnapshots).where(inArray(valoSourceSnapshots.id,ids));
      assert.equal(rows.length,2);assert.ok(rows.every(r=>r.status==="held_test_fixture"));
      await assert.rejects(()=>db.insert(valoSourceSnapshots).values({
        id:ids[0]!,sourceId:"S24",url:"https://example.com",attemptedAt:new Date(),
        status:"held",extractionVersion:"synthetic-fixture",metadata:{},
      }));
      assert.equal((await db.select().from(valoSourceSnapshots).where(eq(valoSourceSnapshots.id,ids[0]!))).length,1);
    });
    await t.test("metadata cannot forge review, publication, policy approval or expose a private locator",async()=>{
      const register=await sourceEvidenceRegister();
      assert.equal(register.references.length,28);
      assert.ok(register.references.every(r=>r.publication==="held"&&r.aiReviewedAt===null&&r.sourceCheckedAt===null));
      assert.ok(register.retentionProposals.every(r=>!r.approved&&!r.enforced&&!r.statutoryPeriod));
      const serialized=JSON.stringify(register);
      assert.ok(!serialized.includes(hidden));assert.ok(!serialized.includes("FORGED"));
      assert.ok(!serialized.includes("rawObjectKey")&&!serialized.includes("textObjectKey"));
    });
    await t.test("an actual retained source matches its hash under authorised read but rejects anonymous retrieval",async()=>{
      const [source]=await db.select().from(valoSourceSnapshots).where(eq(valoSourceSnapshots.sourceId,"S01"))
        .orderBy(desc(valoSourceSnapshots.attemptedAt)).limit(1);
      assert.ok(source?.rawObjectKey&&source.rawChecksum,"Run actual original-link collection before this proof");
      const proof=await probePrivateSource(source.id,"raw",source.rawChecksum);
      assert.equal(proof.authorizedChecksumMatched,true);assert.ok(proof.size>0);
      assert.ok([403,404].includes(proof.anonymousStatus));
    });
  }finally{await db.delete(valoSourceSnapshots).where(inArray(valoSourceSnapshots.id,ids));await pool.end();}
});
