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
const groups = [
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
];
export function partialWorkflowEvidence(id:string){
  const matching=groups.filter(g=>g.ids.includes(id));
  return{paths:[...new Set(matching.flatMap(g=>g.paths))],
    records:[...new Map(matching.map(g=>[g.record.path,g.record])).values()]};
}
