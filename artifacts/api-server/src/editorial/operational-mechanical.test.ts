import test from "node:test";
import assert from "node:assert/strict";
import {candidateDigest,disclosure,sha256,type PublicationBundle} from "@workspace/valo-core";
import {inventoryCandidate} from "./operational-content";
import {operationalPolicy} from "./operational-policy";
import {operationalMechanicalChecks} from "./operational-mechanical";
import {readTemplateIntake} from "./operational-intake";

async function fixture(){
  const now=new Date("2026-11-14T12:00:00Z"),intake=await readTemplateIntake("TPL-07",42),
    content=await inventoryCandidate(42,now,{original:intake.section.body,provenance:intake.provenance});
  const raw:Omit<PublicationBundle["candidate"],"hash">={id:"TPL-07",version:42,
    body:JSON.stringify(content.document),contentClass:"general_template",jurisdiction:"NG",risk:"general",
    scope:content.scope,limitations:content.limitations,assumptions:["Blank optional internal form"],
    unresolvedMaterialIssues:[],missingEvidence:[],sourceCheckDate:now.toISOString(),reviewBy:content.reviewBy,
    disclosure,claims:[],evidenceMode:"original_operational",legalScopeStatus:"not_applicable"};
  const candidate:PublicationBundle["candidate"]={...raw,hash:candidateDigest(raw)};
  const text="CONTROLLED PERMISSION FIXTURE, not actual provider evidence.";
  return {candidate,policy:(await operationalPolicy()).policy,provenance:content.provenance,
    provenanceArtifactHash:sha256("controlled-provenance-artifact"),
    rights:{applicabilityHash:sha256("controlled-permission"),provenanceHash:sha256("controlled-provenance-artifact"),
      validUntil:content.reviewBy,permissions:[{url:"https://example.test/controlled",hash:sha256(text),quote:text}]},
    applicability:{verified:true,hash:sha256("controlled-permission")},
    snapshot:{retrievedAt:now.toISOString(),pages:[{url:"https://example.test/controlled",text,truncated:false}]},now};
}
test("measured operational checks execute separately on a controlled, non-published fixture",async()=>{
  const input=await fixture(),checks=operationalMechanicalChecks(input);
  assert.equal(checks.length,10);assert.deepEqual(checks.filter(c=>c.result!=="pass"),[]);
  assert.equal(new Set(checks.map(c=>c.evidenceHash)).size,10);
  assert.deepEqual(operationalMechanicalChecks(input),checks);
});
test("operational checks fail closed for missing, stale, altered and out-of-scope inputs",async t=>{
  const cases:[string,(x:Awaited<ReturnType<typeof fixture>>)=>void,string][]=[
    ["altered canonical hash",x=>{x.candidate.hash=sha256("altered");},"schema"],
    ["invalid canonical schema",x=>{x.candidate.body="{}";},"schema"],
    ["altered source bytes",x=>{x.provenance.sourceText+="changed";},"source_locators"],
    ["missing provider passage",x=>{x.snapshot.pages=[];},"source_locators"],
    ["altered provider bytes",x=>{x.snapshot.pages[0].text+="altered";},"source_locators"],
    ["expired review",x=>{x.now=new Date("2027-11-14");},"dates"],
    ["future source check",x=>{x.candidate.sourceCheckDate="2027-11-14T00:00:00Z";},"dates"],
    ["unapproved permission",x=>{x.applicability.verified=false;},"rights"],
    ["wrong artifact",x=>{x.rights.provenanceHash=sha256("different");},"rights"],
    ["employment scope",x=>{x.candidate.risk="employment";},"scope"],
    ["unverified legal scope",x=>{x.candidate.legalScopeStatus="unverified";},"scope"],
    ["unlisted template",x=>{x.candidate.id="TPL-99";},"scope"],
    ["new legal claim",x=>{x.candidate.claims.push({text:"Invented obligation",kind:"source_statement",sourceId:"fake",
      quote:"fake",locator:"fake",numbers:[]});},"rule_fixtures"],
    ["missing disclosure",x=>{x.candidate.body=x.candidate.body.replace(disclosure,"Removed");},"disclosures"],
    ["invented business fact",x=>{const doc=JSON.parse(x.candidate.body);doc.content.fields.issuerName="Invented business";
      x.candidate.body=JSON.stringify(doc);},"numeric_extraction"],
  ];
  for(const[name,mutate,check]of cases)await t.test(name,async()=>{
    const input=await fixture();mutate(input);
    assert.equal(operationalMechanicalChecks(input).find(c=>c.name===check)?.result,"fail");
  });
});
