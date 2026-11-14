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
  hash:"e98ffe46ae88f05f6bb8aa3d253170e0f81e7e421a7591b7667d32d7f4ea81d7",result:"pass" as const,
};
const exportRecovery={
  kind:"test" as const,path:"docs/valo/evidence/export-recovery-checkpoint.json",
  hash:"79d87f0bff23cea6800e48d1519b10747e7b8eb46ff4208c7cadc7b4b5ae0c47",result:"pass" as const,
};
const businessNameEvidence={
  kind:"test" as const,path:"docs/valo/evidence/business-name/checkpoint.json",
  hash:"8536ff9eea70993efe135105b2acba1bf4daec2b2509ab6db9b11e90a11d6ff0",result:"pass" as const,
};
const groups = [
  {ids:["EDP-006","EDP-007","EDP-012","ADM-005"],
    paths:["artifacts/api-server/src/editorial/operational-mechanical.ts",
      "artifacts/api-server/src/editorial/operational-mechanical.test.ts",
      "artifacts/api-server/src/editorial/operational-preparation.ts",
      "artifacts/api-server/src/editorial/publication-publisher.ts",
      "artifacts/api-server/src/scripts/mechanical-checkpoint.ts"],
    record:{kind:"test" as const,path:"docs/valo/evidence/operational-mechanical-actual.json",
      hash:"c606a72ea199297d7f976b743c97e7f570a0938209f4fa48b9f3388cdab06dd5",result:"pass" as const}},
  {ids:["PAY-001","PAY-002","PAY-003","PAY-004","PAY-005","PAY-006","PAY-007","PAY-008","PAY-009",
      "DOC-005","DOC-006","DOC-007","EDP-007","ADM-001","SEC-001","SEC-006","OPS-003","NFR-006","NFR-007","PRV-003"],
    paths:["artifacts/api-server/src/lib/valo-commerce.ts","artifacts/api-server/src/lib/valo-paystack-contract.ts",
      "artifacts/api-server/src/lib/valo-commerce.integration.test.ts","artifacts/api-server/src/lib/valo-paystack-http.integration.test.ts",
      "artifacts/api-server/src/routes/valo-commerce.ts","artifacts/api-server/src/routes/valo-paystack-webhook.ts",
      "artifacts/api-server/src/editorial/operational-read-permission.ts","artifacts/valo/src/screens/purchase-history.tsx",
      "artifacts/api-server/src/scripts/commerce-clean-migrations.ts","lib/db/drizzle/0011_commerce_ledger.sql"],
    record:{kind:"test" as const,path:"docs/valo/evidence/commerce-development-checkpoint.json",
      hash:"c546b978dd4b25d0344db715bb037c8e849e92f6314a9684d61f6f417e1e6a48",result:"pass" as const}},
  {ids:["DOC-006","EDP-004","EDP-012","ADM-002"],
    paths:["artifacts/api-server/src/editorial/rights-applicability.ts",
      "artifacts/api-server/src/editorial/operational-preparation.ts",
      "artifacts/api-server/src/editorial/operational-review.ts",
      "artifacts/api-server/src/editorial/publication-publisher.ts",
      "artifacts/api-server/src/scripts/chatgpt-permission-proof.ts",
      "docs/valo/policies/chatgpt-provider-permission.json",
      "docs/content-candidates/chatgpt-content-provenance-rights.md"],
    record:{kind:"test" as const,path:"docs/valo/evidence/chatgpt-permission-publication-proof.json",
      hash:"ab6339d2f6b0c4d84716ee526d739416401df50d845ffdb5ffbd2a93861e616c",result:"pass" as const}},
  {ids:["AI-001","AI-003","AI-005","AI-008","EDT-002","EDT-003","EDT-006","EDT-007","EDT-008","NFR-008"],
    paths:["lib/valo-core/src/money.ts","artifacts/api-server/src/lib/valo-reminder.test.ts",
      "artifacts/api-server/src/scripts/reminder-evaluation.ts","artifacts/valo/src/components/financial-fields.tsx"],
    record:{kind:"test" as const,path:"docs/valo/evidence/reminder-candidate-evaluation.json",
      hash:"3c82cb0560b0c131a836bf562ac6bb56b755bae5d241ee183712457052c169f2",result:"pass" as const}},
  {ids:["AI-009","EDT-003","NFR-006","NFR-007"],
    paths:["artifacts/api-server/src/scripts/customer-experience-journey.ts","artifacts/valo/src/index.css"],
    record:{kind:"test" as const,path:"docs/valo/evidence/reminder-browser-journey.json",
      hash:"0bde05a74ecff15b3185a6ee6cf364a52bfdebee8d746c57801031fa77f05346",result:"pass" as const}},
  {ids:["SEC-003","SEC-007","NFR-009","OPS-007"],
    paths:["artifacts/api-server/src/app.ts","artifacts/api-server/src/lib/request-complexity.test.ts",
      "artifacts/api-server/src/scripts/parser-regression-checkpoint.ts"],
    record:{kind:"test" as const,path:"docs/valo/evidence/parser-regression.json",
      hash:"882a261cf412fdbccc67f6fa9f24fc694f1095348e907cbeab5f3f944de08960",result:"pass" as const}},
  {ids:["DOC-001","EDT-002","EDT-006","ADM-005"],
    paths:["artifacts/api-server/src/editorial/original-content-adapter.ts",
      "artifacts/api-server/src/editorial/original-content-adapter.test.ts",
      "artifacts/api-server/src/scripts/original-content-checkpoint.ts"],
    record:{kind:"test" as const,path:"docs/valo/evidence/original-content-adaptation.json",
      hash:"e9bf78e7caa05a5ed4a327527d280180bfbce8cd03509614eb029f4390328384",result:"pass" as const}},
  {ids:["SEC-002","OPS-007","EDT-008"],
    paths:["artifacts/api-server/src/scripts/dependency-storage-proof.ts","pnpm-workspace.yaml"],
    record:{kind:"test" as const,path:"docs/valo/evidence/dependency-storage-compatibility.json",
      hash:"81c9a6a86eabd1ad95a0d6a8f521a4d82ed85a1823ef82a8264e94ecce534819",result:"pass" as const}},
  {ids:["EDP-002","EDP-005","EDP-006","CMP-004","ADM-003"],
    paths:["artifacts/api-server/src/editorial/business-name-evidence.ts",
      "artifacts/api-server/src/scripts/ingest-business-name.ts","artifacts/api-server/src/scripts/prepare-business-name.ts",
      "artifacts/api-server/src/editorial/business-name-evidence.test.ts",
      "lib/valo-core/src/research-source-leads.ts"],record:businessNameEvidence},
  {ids:["EDT-003","EDT-006","EDT-007","EDT-008","DOC-002","SEC-001","OPS-002","OPS-007","NFR-006","NFR-007","NFR-009"],
    paths:["artifacts/api-server/src/lib/valo-export-recovery.ts","artifacts/api-server/src/lib/valo-exports.ts",
      "artifacts/api-server/src/workers/export-worker.ts","artifacts/api-server/src/lib/valo-export-recovery.integration.test.ts",
      "artifacts/api-server/src/lib/valo-catalogue-pages.test.ts","artifacts/valo/src/screens/library.tsx",
      "artifacts/valo/src/screens/document-editor.tsx","artifacts/valo/src/screens/profile.tsx"],record:exportRecovery},
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
