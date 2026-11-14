import test from "node:test";
import assert from "node:assert/strict";
import {candidateDigest,disclosure,sha256,type PublicationBundle} from "@workspace/valo-core";
import {readOperationalIntake} from "./operational-intake";
import {templateCandidate,inventoryCandidate} from "./operational-content";
import {operationalPolicy} from "./operational-policy";
import {operationalMechanicalChecks} from "./operational-mechanical";
import {candidateArithmetic} from "./candidate-arithmetic";
import {chatGPTSourcePath,loadChatGPTPermission} from "./rights-applicability";
import {operationalInferenceTemplateIds,supportsOperationalInferenceTemplate} from "../lib/inference-operational-coverage";

// Predicate fixtures, never retained as actual terms evidence or publication proof.
export function controlledTermsSnapshot(now=new Date()){
  return{kind:"official_provider_terms_snapshot",retrievedAt:now.toISOString(),pages:[
    {url:"https://openai.com/policies/terms-of-use/",text:"We hereby assign to you all our right, title, and interest, if any, in and to Output.",truncated:false},
    {url:"https://openai.com/policies/eu-terms-of-use/",text:"We hereby assign to you all our right, title, and interest, if any, in and to Output.",truncated:false},
    {url:"https://help.openai.com/en/articles/6783457-what-is-chatgpt",text:"regardless of whether output was generated through a free or paid plan",truncated:false},
    {url:"https://openai.com/policies/service-terms/",text:"ChatGPT Enterprise, Edu, Healthcare and Business",truncated:false},
    {url:"https://openai.com/policies/sharing-publication-policy/",text:"Content co-authored with the OpenAI API",truncated:false},
  ]};
}
async function candidateFor(id:string,now=new Date()){
  const intake=await readOperationalIntake(id,42);
  const source=await templateCandidate(id,42,now,{original:intake.section.body,provenance:intake.provenance});
  const raw:Omit<PublicationBundle["candidate"],"hash">={id,version:42,body:JSON.stringify(source.document),
    contentClass:"general_template",jurisdiction:"NG",risk:"general",scope:source.scope,limitations:source.limitations,
    assumptions:["Controlled blank candidate"],unresolvedMaterialIssues:[],missingEvidence:[],
    sourceCheckDate:now.toISOString(),reviewBy:source.reviewBy,disclosure,claims:[],
    evidenceMode:"original_operational",legalScopeStatus:"not_applicable"};
  return{intake,source,candidate:{...raw,hash:candidateDigest(raw)}};
}
test("eleven source-bound forms retain every existing mechanical gate; unsupported content stays held",async()=>{
  assert.equal(operationalInferenceTemplateIds.length,11);
  const now=new Date(),snapshot=controlledTermsSnapshot(now),{policy}=await operationalPolicy();
  for(const id of operationalInferenceTemplateIds){
    const {intake,source,candidate}=await candidateFor(id,now),applicability=await loadChatGPTPermission(snapshot,intake.provenance);
    const provenanceArtifactHash=sha256("controlled fixture"),rights={applicabilityHash:applicability.hash,
      provenanceHash:provenanceArtifactHash,validUntil:source.reviewBy,permissions:applicability.record.evidence};
    assert.deepEqual(operationalMechanicalChecks({candidate,policy,provenance:intake.provenance,provenanceArtifactHash,
      rights,applicability,snapshot,now}).filter(c=>c.result!=="pass"),[],id);
    const wrong={...intake.provenance,noteHash:"f".repeat(64)};
    await assert.rejects(()=>templateCandidate(id,42,now,{original:intake.section.body,provenance:wrong}),/MISMATCH/);
  }
  for(const id of["TPL-12","TPL-13","TPL-40","GUD-01","GUIDE-C01","IND-C01"])
    assert.equal(supportsOperationalInferenceTemplate(id),false,id);
  assert.equal(candidateArithmetic((await candidateFor("TPL-12",now)).candidate).pass,false);
});
test("TPL-07 reconstruction remains identical and TPL-09 selects exact intake lineage despite legacy shared path",async()=>{
  const now=new Date(),intake=await readOperationalIntake("TPL-07",42),recorded={original:intake.section.body,provenance:intake.provenance};
  assert.deepEqual(await templateCandidate("TPL-07",42,now,recorded),await inventoryCandidate(42,now,recorded));
  const nine=await readOperationalIntake("TPL-09",42);assert.equal(nine.sourcePath,chatGPTSourcePath);
  const result=await loadChatGPTPermission(controlledTermsSnapshot(now),nine.provenance);
  assert.equal(result.record.sourceBinding?.noteHash,nine.manifestHash);
  assert.equal(result.record.sourceBinding?.notePath,"docs/content-candidates/r1-content-intake-manifest.json");
  assert.equal(result.verified,true);
  await assert.rejects(()=>loadChatGPTPermission(controlledTermsSnapshot(now),{...nine.provenance,note:"changed lineage"}),/LINEAGE_MISMATCH/);
  const legacy=await inventoryCandidate(42,now),legacyPermission=await loadChatGPTPermission(controlledTermsSnapshot(now),legacy.provenance);
  assert.equal(legacyPermission.record.sourceBinding?.noteHash,legacy.provenance.noteHash);
  assert.match(legacyPermission.record.sourceBinding!.notePath,/chatgpt-content-provenance-rights/);
  assert.equal((await loadChatGPTPermission(controlledTermsSnapshot(new Date(+now-91*86400000)),nine.provenance)).verified,false);
});
