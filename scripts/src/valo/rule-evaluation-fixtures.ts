import { assess,checkerFactsSchema,digest,ruleSchema,type CheckerFacts,type ReleasedRule } from "@workspace/valo-core";
import assert from "node:assert/strict";

export const evaluationDate=new Date("2026-11-13T12:00:00Z");
export const baseFacts:CheckerFacts=checkerFactsSchema.parse({
  legalForm:"limited_company",registrationStatus:"registered",activities:["retail_wholesale"],state:"Lagos",lga:"Ikeja",
  employees:"5",turnoverBand:"5m_to_25m",turnoverYear:"2025",turnoverMetric:"gross_revenue",turnoverCurrency:"NGN",
  turnoverPeriod:"annual",turnoverPeriodStart:"2025-01-01",turnoverPeriodEnd:"2025-12-31",
  turnoverAmountKobo:"1000000000",premises:"yes",manufacturing:"no",importing:"no",personalData:"yes",
});
type Predicate=NonNullable<ReleasedRule["condition"]>["predicates"][number];
type Expected="likely"|"unknown"|"not_indicated"|"held"|"reject";
export type RuleFixture={id:string;name:string;facts:CheckerFacts;rules:ReleasedRule[];expected:Expected;
  fixtureMode:boolean;asOfDate:string;expectedMissing?:string};
const fixtures:RuleFixture[]=[];
const employee=(op:Predicate["op"],value:Predicate["value"]):Predicate=>({field:"employees",op,value});
const cash=(op:Predicate["op"],value:string):Predicate=>({field:"turnoverAmountKobo",op,value,
  metric:"gross_revenue",currency:"NGN",period:"annual",year:"2025",periodStart:"2025-01-01",periodEnd:"2025-12-31"});
function makeRule(predicates:Predicate[]=[employee("gte",5)],overrides:Partial<ReleasedRule>={}):ReleasedRule{
  const condition=overrides.condition??{mode:"all" as const,predicates};
  const quote=`SYNTHETIC ENGINE POLICY ONLY: ${JSON.stringify(condition)}. Not Nigerian law or publication evidence.`;
  return{id:"SYN-ENGINE-RULE",version:1,requirementVersionId:"SYN-REQUIREMENT-1",title:"Synthetic condition test",
    jurisdiction:{level:"federal"},validFrom:"2025-01-01",validTo:null,sourceCheckedAt:"2026-11-01T00:00:00Z",
    reviewBy:"2027-01-01T00:00:00Z",status:"published",provenance:"synthetic_fixture",
    manifestHash:digest("SYNTHETIC-NOT-A-PUBLICATION-MANIFEST"),
    sources:[{id:"SYN-SPEC",url:"https://example.invalid/synthetic-rule-fixture",title:"Controlled synthetic test specification",
      locator:"fixture:condition",quote,snapshotHash:digest(quote)}],
    condition,reason:"This controlled fixture meets its explicit test predicate; it asserts no Nigerian duty.",
    nextStep:"Inspect the synthetic predicate, not a regulator.",relatedTemplateIds:[],...overrides};
}
function add(name:string,expected:Expected,facts:Partial<CheckerFacts>={},predicates?:Predicate[],
  overrides:Partial<ReleasedRule>={},extra:Partial<RuleFixture>={}){
  fixtures.push({id:`RULE-EVAL-${String(fixtures.length+1).padStart(3,"0")}`,name,
    expected,facts:{...baseFacts,...facts},rules:[makeRule(predicates,overrides)],fixtureMode:true,asOfDate:"2026-11-13",...extra});
}
// 1. Five sector-specific positives/exclusions; professional services appears in group 2.
for(const[sector,actual,expected]of [
  ["retail_wholesale","retail_wholesale","likely"],["packaged_food","technology_software","not_indicated"],
  ["technology_software","technology_software","likely"],["beauty_personal_care","beauty_personal_care","likely"],
  ["restaurants_hospitality","packaged_food","not_indicated"],
] as const)add(`Activity ${actual} against ${sector}`,expected,{activities:[actual]},[{field:"activities",op:"in",value:[sector]}]);
// 2. Legal structure and explicit unknowns, including NGO forms; no nonprofit exemption.
add("Professional services included explicitly","likely",{activities:["professional_services"]},[{field:"activities",op:"in",value:["professional_services"]}]);
add("Trustees are not a limited company","not_indicated",{legalForm:"incorporated_trustees"},[{field:"legalForm",op:"eq",value:"limited_company"}]);
add("Guarantee-company condition matches its own structure","likely",{legalForm:"company_limited_by_guarantee"},[{field:"legalForm",op:"eq",value:"company_limited_by_guarantee"}]);
add("Unknown legal structure needs clarification","unknown",{legalForm:"unknown"},[{field:"legalForm",op:"eq",value:"limited_company"}]);
add("Unanswered registration does not establish exemption","unknown",{registrationStatus:"unanswered"},[{field:"registrationStatus",op:"eq",value:"registered"}]);
// 3. Three priority jurisdictions, other-state exclusion, and unknown location.
for(const state of ["Lagos","FCT","Bayelsa"])
  add(`${state} rule stays within its own state`,"likely",{state},undefined,{jurisdiction:{level:"state",state}});
add("Lagos rule is excluded for Kaduna","not_indicated",{state:"Kaduna"},undefined,{jurisdiction:{level:"state",state:"Lagos"}});
add("Unknown state is not national applicability","unknown",{state:"unknown"},undefined,{jurisdiction:{level:"state",state:"Lagos"}});
// 4. LGA scope, including all missing-answer markers.
add("Exact LGA match","likely",{},undefined,{jurisdiction:{level:"lga",state:"Lagos",lga:"Ikeja"}});
add("Different LGA is excluded","not_indicated",{lga:"Epe"},undefined,{jurisdiction:{level:"lga",state:"Lagos",lga:"Ikeja"}});
for(const lga of ["unknown","unanswered","not_applicable"])
  add(`LGA ${lga} does not invent a local duty`,"unknown",{lga},undefined,{jurisdiction:{level:"lga",state:"Lagos",lga:"Ikeja"}});
// 5. Numeric operator boundaries; zero is a value, not an unknown.
add("Strict workforce less-than below boundary","likely",{employees:"4"},[employee("lt",5)]);
add("Strict workforce less-than at boundary","not_indicated",{},[employee("lt",5)]);
add("Inclusive workforce boundary","likely",{},[employee("gte",5)]);
add("Workforce above exclusive boundary","likely",{employees:"6"},[employee("gt",5)]);
add("Zero workforce equality","likely",{employees:"0"},[employee("eq",0)]);
// 6. Missing/unknown/not-applicable workforce and safe large integer counts.
for(const employees of ["unknown","unanswered","not_applicable"])add(`${employees} workforce cannot imply exemption`,"unknown",{employees});
add("Known zero below threshold","not_indicated",{employees:"0"});
add("Large safe workforce count","likely",{employees:"100001"});
// 7. Financial threshold arithmetic in integer kobo.
add("Turnover strict less-than boundary","not_indicated",{},[cash("lt","1000000000")]);
add("Turnover inclusive lower boundary","likely",{},[cash("lte","1000000000")]);
add("Turnover strict greater-than boundary","not_indicated",{},[cash("gt","1000000000")]);
add("Turnover inclusive upper boundary","likely",{},[cash("gte","1000000000")]);
add("Turnover exact equality","likely",{},[cash("eq","1000000000")]);
// 8. Metric/currency/year/period are mandatory, not interchangeable.
add("Unknown metric requests the metric","unknown",{turnoverMetric:"unknown"},[cash("gte","1000000000")]);
add("Unknown currency is not assumed NGN","unknown",{turnoverCurrency:"unknown"},[cash("gte","1000000000")]);
add("Wrong accounting year is uncertain","unknown",{turnoverYear:"2024"},[cash("gte","1000000000")]);
add("Monthly amount cannot satisfy an annual threshold","unknown",{turnoverPeriod:"monthly"},[cash("gte","1000000000")]);
add("Missing exact amount and unknown band request a value","unknown",{turnoverAmountKobo:null,turnoverBand:"unknown"},[cash("gte","1000000000")]);
// 9. Exact fiscal period and amount precision.
add("Different fiscal start is uncertain","unknown",{turnoverPeriodStart:"2025-04-01"},[cash("gte","1000000000")]);
add("Different fiscal end is uncertain","unknown",{turnoverPeriodEnd:"2025-06-30"},[cash("gte","1000000000")]);
add("An unfinished accounting period is not completed revenue","unknown",{},[{...cash("gte","1000000000"),periodEnd:"2027-12-31"}]);
add("Invalid calendar period is rejected","reject",{turnoverPeriodStart:"2025-02-30"},[cash("gte","1000000000")]);
add("Amounts larger than IEEE safe integer remain exact","likely",{turnoverAmountKobo:"999999999999999999999999"},[cash("gt","999999999999999999999998")]);
// 10. Interval/band logic, especially equality inside a band and open upper bounds.
add("Band wholly below a threshold","not_indicated",{turnoverAmountKobo:null,turnoverBand:"under_5m"},[cash("gte","500000000")]);
add("Band straddles a threshold","unknown",{turnoverAmountKobo:null,turnoverBand:"25m_to_100m"},[cash("gte","5000000000")]);
add("Equality inside a band is unknown","unknown",{turnoverAmountKobo:null},[cash("eq","1000000000")]);
add("Open upper band wholly above threshold","likely",{turnoverAmountKobo:null,turnoverBand:"over_100m"},[cash("gt","10000000000")]);
add("Open upper band cannot prove an arbitrary high threshold","unknown",{turnoverAmountKobo:null,turnoverBand:"over_100m"},[cash("gt","99999999999999999999999")]);
// 11. AND is three-valued.
add("All true predicates match","likely",{},[employee("gte",5),{field:"premises",op:"eq",value:"yes"}]);
add("AND false overrides true","not_indicated",{},[employee("gt",5),{field:"premises",op:"eq",value:"yes"}]);
add("AND unknown with true remains uncertain","unknown",{employees:"unknown"},[employee("gte",5),{field:"premises",op:"eq",value:"yes"}]);
add("AND false with unknown is excluded without claiming exemption","not_indicated",{premises:"unknown"},[employee("gt",5),{field:"premises",op:"eq",value:"yes"}]);
add("Known no is not a missing answer","likely",{premises:"no"},[{field:"premises",op:"eq",value:"no"}]);
// 12. OR is three-valued, but never expands jurisdiction.
const either=(predicates:Predicate[])=>({condition:{mode:"any" as const,predicates}});
add("OR true with unknown matches","likely",{premises:"unknown"},undefined,either([employee("gte",5),{field:"premises",op:"eq",value:"yes"}]));
add("OR true with false matches","likely",{},undefined,either([employee("gte",5),{field:"premises",op:"eq",value:"no"}]));
add("OR false with unknown remains uncertain","unknown",{premises:"unknown"},undefined,either([employee("gt",5),{field:"premises",op:"eq",value:"yes"}]));
add("OR all false excluded","not_indicated",{},undefined,either([employee("gt",5),{field:"premises",op:"eq",value:"no"}]));
add("OR cannot escape another state","not_indicated",{state:"Bayelsa"},undefined,{...either([employee("gte",5)]),jurisdiction:{level:"state",state:"Lagos"}});
// 13. Effective-period boundaries.
add("Before effective start is held","held",{},undefined,{validFrom:"2027-01-01"});
add("At inclusive effective start","likely",{},undefined,{validFrom:"2026-11-13"});
add("At exclusive effective end is held","held",{},undefined,{validTo:"2026-11-13"});
add("Historical effective period remains reproducible","likely",{},undefined,{validFrom:"2020-01-01"},{asOfDate:"2025-02-01"});
add("Future assessment rejected","reject",{},undefined,{}, {asOfDate:"2027-01-01"});
// 14. Release/freshness holds.
add("Held source cannot recommend","held",{},undefined,{status:"held"});
add("Withdrawn source cannot recommend","held",{},undefined,{status:"withdrawn"});
add("Expired source cannot recommend","held",{},undefined,{reviewBy:"2026-11-13T12:00:00Z"});
add("Source check in the future cannot recommend","held",{},undefined,{sourceCheckedAt:"2026-11-14T00:00:00Z"});
add("Offset timestamp is compared as an instant","held",{},undefined,{reviewBy:"2026-11-13T13:00:00+02:00"});
// 15. Trust boundary and schema rejection, never eval().
add("Synthetic fixtures rejected in customer mode","held",{},undefined,{}, {fixtureMode:false});
add("Forged editorial manifest is not trusted","held",{},undefined,{provenance:"editorial_release"},{fixtureMode:false});
add("Arbitrary operator rejected","reject",{},[{field:"employees",op:"eval" as Predicate["op"],value:"process.env"}]);
add("Numeric operator on untyped location rejected","reject",{},[{field:"state",op:"gt",value:5}]);
add("Unsupported condition property rejected","reject",{},undefined,{condition:{mode:"all",predicates:[employee("gte",5)],script:"fetch()"} as ReleasedRule["condition"]});
// 16. Missing activity, empty registries, conflicting releases and deterministic order.
add("Unknown activity remains a question","unknown",{activities:"unknown"},[{field:"activities",op:"in",value:["retail_wholesale"]}]);
add("Unanswered activity remains distinct","unknown",{activities:"unanswered"},[{field:"activities",op:"exists"}]);
add("No released rules is a gap, never compliance","held",{},undefined,{}, {rules:[]});
add("Overlapping released versions are held","held",{},undefined,{}, {rules:[makeRule(),makeRule(undefined,{version:2})]});
add("Known false data-processing answer is evaluable","likely",{personalData:"no"},[{field:"personalData",op:"eq",value:"no"}]);
assert.equal(fixtures.length,80,"The engineering suite must contain exactly 80 distinct declared scenarios");
export const ruleEvaluationFixtures=fixtures;
export function executeRuleFixture(f:RuleFixture){
  const run=()=>assess(f.facts,f.rules,f.asOfDate,evaluationDate,{fixtureMode:f.fixtureMode});
  if(f.expected==="reject"){assert.throws(run);return;}
  const result=run(),label=result.items[0]?.label;
  const actual=label==="Likely relevant"?"likely":label==="More information needed"?"unknown":
    label==="Not indicated by these answers"?"not_indicated":"held";
  assert.equal(actual,f.expected,f.name);
  assert.equal(run().resultHash,result.resultHash,"Identical input and version must reproduce the same result hash");
  assert.equal("complianceScore" in result,false);
  if(actual==="held")assert.equal(result.sourceBackedRecommendations,0);
  if(actual==="unknown")assert.ok(result.items[0].missingFacts.length>0);
  assert.equal(assess(f.facts,[...f.rules].reverse(),f.asOfDate,evaluationDate,{fixtureMode:f.fixtureMode}).resultHash,result.resultHash,
    "Registry storage order must not change the result");
}
