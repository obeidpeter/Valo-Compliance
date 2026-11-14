import assert from "node:assert/strict";
import test from "node:test";
import {digest} from "@workspace/valo-core";
import {evaluateSourceCandidateOffline,remainingSourceCandidateIds} from "@workspace/valo-core/checker-source-candidates";
import {evaluateBusinessNameCandidate} from "@workspace/valo-core/checker-business-name";
import {bindBusinessNameCandidate} from "./business-name-candidate-binding";
import {bindRemainingSourceCandidates} from "./source-candidate-bindings";

const now=new Date("2026-11-14T23:00:00Z");
const {corpus,binding:cama}=bindBusinessNameCandidate(now),bindings=bindRemainingSourceCandidates(now);
function evaluate(caseId:string,patch:Record<string,unknown>={}){
  const c=corpus.cases.find(c=>c.caseID===caseId)!;
  return evaluateSourceCandidateOffline(c.sourceCandidateID as typeof remainingSourceCandidateIds[number],
    {...c.facts,...patch},c.assessmentDate,bindings[c.sourceCandidateID]!.binding);
}
test("NDPA018's precomputed jurisdiction conclusion cannot negate missing domicile/residence facts",()=>{
  const r=evaluate("CHK-CAND-NDPA-018");
  assert.equal(r.label,"More information needed");
  assert.ok(r.missingFacts.some(m=>m.field==="controllerDomiciledInNigeria"));
  const negatives={controllerDomiciledInNigeria:false,controllerResidentInNigeria:false,processorConnectionInNigeria:false};
  assert.equal(evaluate("CHK-CAND-NDPA-018",negatives).label,"Not indicated by these answers");
  assert.equal(evaluate("CHK-CAND-NDPA-018",{...negatives,controllerResidentInNigeria:true}).label,"Likely relevant");
});
test("unknown, unanswered and not-applicable domicile are not explicit negative facts",()=>{
  for(const status of ["unknown","unanswered","not_applicable"] as const){
    const r=evaluate("CHK-CAND-NDPA-018",{controllerDomiciledInNigeria:{status,value:null}});
    assert.equal(r.label,"More information needed");
    assert.equal(r.missingFacts.find(m=>m.field==="controllerDomiciledInNigeria")?.state,status);
  }
});
test("NTAA009 records an unresolved extended Company definition, not a return obligation",()=>{
  const r=evaluate("CHK-CAND-NTAA-009",{classificationUnderNtaaSection147:"not_a_company_confirmed"});
  assert.equal(r.label,"More information needed");
  assert.equal(r.details.companyReturnOwedDetermined,false);
  assert.equal(r.createRegistrationTask,false);
});
test("NDPA009 commercial reuse is not a new collection clock",()=>{
  const r=evaluate("CHK-CAND-NDPA-009");
  assert.equal(r.label,"Likely relevant");assert.equal(r.details.solelyHouseholdExceptionSupported,false);
  assert.equal(r.details.section27_1CollectionTiming,"not established");
  assert.equal(r.details.newCollectionEventEstablished,false);
  assert.match(r.reason,/27\(3\).*27\(1\)/);
  assert.equal(r.automaticStatutoryDeadline,null);
});
test("a declared new direct collection is a different bound input, not a silently invented fact",()=>{
  const a=evaluate("CHK-CAND-NDPA-009"),b=evaluate("CHK-CAND-NDPA-009",{newCollectionEvent:true});
  assert.notEqual(a.inputHash,b.inputHash);assert.notEqual(a.resultHash,b.resultHash);
  assert.equal(b.label,"Likely relevant");
});
test("NTAA012 retains declared foreign formation without deciding tax residence",()=>{
  const r=evaluate("CHK-CAND-NTAA-012");
  assert.equal(r.label,"May apply");assert.equal(r.details.incorporatedOutsideNigeriaDeclared,true);
  assert.equal(r.details.taxResidenceClassification,"unresolved");
  assert.equal(evaluate("CHK-CAND-NTAA-012",{incorporatedInNigeria:true}).label,"More information needed");
});
test("NTAA013's narrow domestic exclusion does not verify final withholding",()=>{
  const a=evaluate("CHK-CAND-NTAA-013"),b=evaluate("CHK-CAND-NTAA-013",{finalTaxTreatment:"unsupported_claim"});
  assert.equal(a.label,"Not indicated by these answers");assert.equal(a.details.domesticCandidateExclusionOnly,true);
  assert.equal(a.details.finalWithholdingClassificationVerified,false);assert.equal(a.details.nonresidentReturnDetermined,false);
  assert.equal(a.label,b.label);
});
test("NAFDAC009/013/016 assess national relevance, not local manufacturing eligibility",()=>{
  for(const id of ["009","013","016"]){
    const r=evaluate(`CHK-CAND-NAFDAC-${id}`);
    assert.match(String(r.details.assessedProposition),/National product-registration relevance.*not local-manufacturer/);
    assert.equal(r.details.feesOrMicroScaleEligibilityDetermined,false);
    assert.equal(r.eligibleForCustomerUse,false);
  }
});
test("NAFDAC017 accepts stipulated matching permit/conditions without asking them again",()=>{
  const r=evaluate("CHK-CAND-NAFDAC-017");
  assert.equal(r.label,"Not indicated by these answers");assert.deepEqual(r.missingFacts,[]);
  assert.equal(r.details.continuingPermitConditions,true);assert.match(String(r.details.scope),/conditional sample activity only/);
});
test("all twenty CAMA naming cases stay narrow, input-bound and never registration exemptions",()=>{
  const cases=corpus.cases.filter(c=>c.sourceCandidateID==="CAND-CAMA-814-BUSINESS-NAME");
  assert.equal(cases.length,20);
  for(const c of cases){
    const r=evaluateBusinessNameCandidate(c.facts,c.assessmentDate,cama);
    assert.equal(r.inputHash,digest(c.facts));assert.equal(r.eligibleForCustomerUse,false);
    assert.equal(r.createRegistrationTask,false);assert.equal(r.automaticReminder,false);
    assert.ok(r.gaps.some(s=>/negative|naming|exemption/i.test(s)));
  }
});
