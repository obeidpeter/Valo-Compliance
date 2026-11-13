import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const root=new URL("../../../",import.meta.url);
test("final transfer preserves exact roadmap, all 24 references and seven unapproved non-statutory retention proposals",async()=>{
  const register=JSON.parse(await readFile(new URL("docs/registers/final-source-context.json",root),"utf8"));
  for(const [path,hash] of Object.entries(register.sourceHashes)){
    const source=await readFile(new URL(path,root),"utf8");
    assert.equal(createHash("sha256").update(source).digest("hex"),hash);
  }
  assert.equal(register.roadmapSections.length,4);
  const roadmap=await readFile(new URL("docs/specification/VALO-ROADMAP-001-v1.1.txt",root),"utf8");
  for(const row of register.roadmapSections){assert.ok(roadmap.includes(row.exactContract));assert.equal(row.status,"planning_assumption_not_accepted");}
  assert.deepEqual(register.references.map((r:{id:string})=>r.id),Array.from({length:24},(_,i)=>`S${String(i+1).padStart(2,"0")}`));
  const trd=await readFile(new URL("docs/specification/VALO-TRD-001-v1.1.txt",root),"utf8");
  for(const row of register.references)assert.ok(trd.includes(row.exactBaseline));
  assert.equal(register.retentionProposals.length,7);
  for(const r of register.retentionProposals){assert.equal(r.approved,false);assert.equal(r.enforced,false);assert.equal(r.statutoryPeriod,false);assert.ok(trd.includes(r.dataClass+" | "+r.exactProposal));}
  assert.ok(Object.values(register.approvals).every(v=>v===false));
});
