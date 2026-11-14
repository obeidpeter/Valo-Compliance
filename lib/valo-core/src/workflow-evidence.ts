/** Partial, retained execution evidence. None of these bindings accepts a whole requirement or a release gate. */
const rules = {
  kind:"test" as const,path:"docs/valo/evidence/rule-engine-80-evaluation.json",
  hash:"b946dd5f65d03eccd6356e665ef154932bb24c0469b37cd70ce70780a0b249c1",result:"pass" as const,
};
const ai = {
  kind:"test" as const,path:"docs/valo/evidence/customer-ai-60-evaluation.json",
  hash:"0024cb591897f6402e44a92d240defe16a967c067836334af3be0823aabe9c08",result:"pass" as const,
};
const database = {
  kind:"test" as const,path:"docs/valo/evidence/checker-ai-development-tests.json",
  hash:"f0fbee5ceb16e8d2db0175e5ed7c9387b05340be1891f964b5f558a7b4d905b9",result:"pass" as const,
};
const browser = {
  kind:"test" as const,path:"docs/valo/evidence/checker-customer-journey.json",
  hash:"47382befec7a822f2bd16c59d0d7cd0c36093f6d76eb5d478916f577d1f4bb08",result:"pass" as const,
};
// A completed technical proof with zero quote errors and a correct HOLD.
// This is explicitly not factual/challenge agreement or publication eligibility.
const editorialHold = {
  kind:"test" as const,path:"docs/valo/evidence/p0-editorial-provider-proof.json",
  hash:"50b03d8942a1c7a90ec3bc63c3ecfefbcd6c995a2558cc4fb250d4228475227e",result:"pass" as const,
};
// Real independent checks FAILED eligibility. Never present this as a successful
// publication/withdrawal proof or as completion of the 60-case editorial suite.
const operationalPublication = {
  kind:"test" as const,path:"docs/valo/evidence/operational-publication-checkpoint.json",
  hash:"01219ace3b66985d259fb2bba2f53b97c5029406d1bafa826de1c49ed9d74c7e",result:"fail" as const,
};
// Targeted controls passed; unknown rights and untested whole-requirement
// acceptance stay explicitly unaccepted in the report.
const customerSecurity={
  kind:"test" as const,path:"docs/valo/evidence/customer-security-checkpoint.json",
  hash:"70f2ee336e7590fceba90ea4bfa6d54affb707fd4d33fb6e5bb8afaf47673711",result:"pass" as const,
};
const customerExperience={
  kind:"test" as const,path:"docs/valo/evidence/customer-experience-checkpoint.json",
  hash:"0f5faf6a00a2412ea753753b11492865aceb17d42837fb60651efbf45fbc4999",result:"pass" as const,
};
const groups = [
  {ids:["WEB-001","WEB-002","IAM-001","PRO-002","DOC-002","DOC-003","DOC-004","DOC-005",
    "WRK-006","ADM-001","ADM-009","SEC-001","SEC-005","PRV-003","NFR-006","NFR-007"],
    paths:["artifacts/api-server/src/lib/valo-customer-access.ts","artifacts/api-server/src/routes/valo-customer-access.ts",
      "artifacts/api-server/src/lib/valo-customer-access.integration.test.ts","artifacts/api-server/src/scripts/customer-experience-journey.ts",
      "artifacts/valo/src/screens/contact.tsx","artifacts/valo/src/screens/account.tsx",
      "artifacts/valo/src/screens/resources.tsx","artifacts/valo/src/screens/staff.tsx"],record:customerExperience},
  {ids:["IAM-003","SEC-001","SEC-003","SEC-005","EDT-004","PRO-003","WRK-006","NFR-009"],
    paths:["artifacts/api-server/src/lib/valo-site-origin.ts","artifacts/api-server/src/lib/valo-store.ts",
      "artifacts/api-server/src/lib/valo-quota.ts","artifacts/api-server/src/lib/valo-write-security.integration.test.ts",
      "artifacts/api-server/src/lib/valo-proxy-security.test.ts"],record:customerSecurity},
  {ids:["DOC-001","DOC-002","DOC-006","CMP-004","EDP-007"],
    paths:["artifacts/api-server/src/lib/valo-released-content.ts","artifacts/api-server/src/editorial/rights-applicability.ts",
      "lib/valo-core/src/coverage.ts"],record:customerSecurity},
  {ids:["EDP-001","EDP-003","EDP-004","EDP-006","EDP-007","EDP-009","EDP-012","ADM-002","ADM-005","DOC-001"],
    paths:["artifacts/api-server/src/editorial/operational-policy.ts","artifacts/api-server/src/editorial/operational-preparation.ts",
      "artifacts/api-server/src/editorial/publication-publisher.ts","artifacts/api-server/src/editorial/operational-publication.integration.test.ts",
      "lib/db/drizzle/0007_operational_publication.sql"],record:operationalPublication},
  {ids:["RUL-001","RUL-002","RUL-003","RUL-004","RUL-005","RUL-006","RUL-008","CMP-002","CMP-003","CMP-006","CMP-007"],
    paths:["lib/valo-core/src/checker.ts","artifacts/valo/src/screens/checker.tsx"],record:rules},
  {ids:["PRO-001","PRO-003","RUL-007","RUL-009","WRK-001","WRK-002","WRK-003","WRK-004","SEC-001","NFR-008","NFR-009"],
    paths:["artifacts/api-server/src/lib/valo-assessments.ts","artifacts/api-server/src/lib/valo-tasks.ts",
      "artifacts/api-server/src/lib/valo-reminder-worker.ts","artifacts/api-server/src/lib/valo-requirements.integration.test.ts"],record:database},
  {ids:["AI-001","AI-002","AI-003","AI-004","AI-005","AI-006","AI-007","AI-008","AI-009"],
    paths:["artifacts/api-server/src/lib/valo-customer-ai.ts","artifacts/api-server/src/lib/valo-customer-ai-model.ts",
      "artifacts/api-server/src/lib/valo-customer-ai-domain.ts","lib/valo-core/src/customer-document.ts"],record:ai},
  {ids:["AI-003","AI-005","AI-007","EDT-002","EDT-004","SEC-001","IAM-003"],
    paths:["artifacts/api-server/src/lib/valo-customer-ai.integration.test.ts","lib/valo-core/src/money.ts"],record:database},
  {ids:["IAM-001","IAM-003","PRO-001","PRO-003","RUL-007","WRK-001","WRK-002","WRK-003","WRK-004",
    "AI-001","AI-002","AI-003","AI-009","EDT-002","EDT-003","EDT-004","EDT-006","EDT-007","EDT-008","SEC-001","NFR-007","NFR-008","NFR-009"],
    paths:["artifacts/api-server/src/scripts/checker-customer-journey.ts"],record:browser},
  {ids:["EDP-002","EDP-003","EDP-004","EDP-006","EDP-012"],
    paths:["artifacts/api-server/src/editorial/citation-selection.ts","artifacts/api-server/src/editorial/pipeline.ts",
      "artifacts/api-server/src/editorial/model-adapter.ts"],record:editorialHold},
];
export function partialWorkflowEvidence(id:string){
  const matching=groups.filter(g=>g.ids.includes(id));
  return{paths:[...new Set(matching.flatMap(g=>g.paths))],
    records:[...new Map(matching.map(g=>[g.record.path,g.record])).values()]};
}
