import assert from "node:assert/strict";
import test from "node:test";
import { paginateReleasedItems } from "./valo-catalogue";
import { verifiedRightsApplicability } from "../editorial/rights-applicability";
test("synthetic already-eligible catalogue metadata produces nonzero counts, filters and pagination",()=>{
  const rows=Array.from({length:23},(_,i)=>({id:`synthetic-${i}`,slug:`synthetic-${i}`,title:`Inventory${i}`,type:"template",
    industry:"All industries",summary:"Synthetic metadata adapter case, not published business content"}));
  assert.equal(paginateReleasedItems(rows).total,23);
  assert.equal(paginateReleasedItems(rows,{page:2}).items.length,3);
  assert.equal(paginateReleasedItems(rows,{q:"Inventory22"}).total,1);
  assert.equal(paginateReleasedItems(rows,{type:"guidance"}).total,0);
  assert.equal(paginateReleasedItems([]).total,0,"withdrawn/held versions must not be passed as eligible inputs");
});
test("rights applicability is evidence-dependent, not an unconditional development hold",()=>{
  const now=new Date("2026-11-14T12:00:00Z");
  const fixture={version:"synthetic-only",status:"verified",accountPlan:"synthetic-account-contract",
    accountTerms:"Synthetic contract fixture, not actual terms evidence",integration:"replit_managed_openai",provider:"openai",
    commercialUseScope:"blank_operational_forms_internal_business_licence",checkedAt:now.toISOString(),limitations:[],
    evidence:["account","integration","provider"].map(kind=>({kind,url:"https://synthetic.example/terms",hash:"a".repeat(64),
      locator:"Synthetic fixture",quote:"Synthetic quote, not business evidence",applicabilityEvidence:"Synthetic mapping"}))};
  assert.ok(verifiedRightsApplicability(fixture,now),"Synthetic engineering predicate only; no real clearance");
  assert.equal(verifiedRightsApplicability({...fixture,status:"unverified"},now),false);
  assert.equal(verifiedRightsApplicability({...fixture,accountTerms:null},now),false);
  assert.equal(verifiedRightsApplicability({...fixture,evidence:fixture.evidence.slice(1)},now),false);
  assert.equal(verifiedRightsApplicability({...fixture,checkedAt:"2025-01-01T00:00:00Z"},now),false);
});
