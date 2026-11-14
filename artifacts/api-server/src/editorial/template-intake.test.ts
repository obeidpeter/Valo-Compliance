import test from "node:test";
import assert from "node:assert/strict";
import {readTemplateIntake,extractTemplateBody,readOperationalIntake} from "./operational-intake";
import {sha256} from "@workspace/valo-core";
test("all exact 40 R1 bodies compile without releasing content or clearing rights",async()=>{
  for(let n=1;n<=40;n++){
    const id=`TPL-${String(n).padStart(2,"0")}`,intake=await readTemplateIntake(id);
    assert.equal(intake.section.id,id);
    assert.equal(intake.rightsState,"not_evaluated_for_new_bytes");
    assert.equal(intake.publicationStatus,"unpublished_candidate");
    assert.ok(intake.document.content.blocks.length>0,id);
    const body=JSON.stringify(intake.document.content);
    assert.doesNotMatch(body,/Customer body (?:start|end)|Source evidence and release holds|EDP-\d|upstreamProvider|DRAFT [—/] HELD/i,id);
  }
});
test("explicit body boundaries exclude field/validation metadata but retain conditions and exceptions",()=>{
  const source="## TPL-29 — Privacy notice\nRequired facts: INTERNAL\n### CUSTOMER BODY START\n"+
    "This actual customer paragraph retains every conditional branch and applicable exception. Do not fill an unsupported basis or purpose automatically. [Purpose] [Contact]\n"+
    "### CUSTOMER BODY END\nValidation: INTERNAL\n";
  const extracted=extractTemplateBody("TPL-29","Privacy notice",source,sha256(source));
  assert.match(extracted.body,/conditional branch and applicable exception/);
  assert.doesNotMatch(extracted.body,/INTERNAL|CUSTOMER BODY/);
  assert.throws(()=>extractTemplateBody("TPL-29","Privacy notice",source,"f".repeat(64)),/HASH_MISMATCH/);
});
test("general intake does not expand the narrower operational release path",async()=>{
  await assert.rejects(()=>readOperationalIntake("TPL-16"),/NOT_SUPPORTED/);
  await assert.rejects(()=>readTemplateIntake("TPL-41"),/NOT_ALLOWLISTED|NOT_SUPPORTED/);
  await assert.rejects(()=>readTemplateIntake("TPL-01",0),/VERSION_INVALID/);
});
