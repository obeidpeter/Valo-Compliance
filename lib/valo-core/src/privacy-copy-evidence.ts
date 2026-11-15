/** Partial development evidence, not a release or full-privacy acceptance. */
export function partialPrivacyCopyEvidence(id:string){
  if(!["PRO-002","PRV-003","SEC-001","IAM-003","EDT-008","NFR-005","NFR-009","OPS-003",
    "OPS-008","SEC-002","OPS-004","IAM-002"].includes(id))
    return{paths:[],records:[]};
  return{
    paths:["artifacts/api-server/src/lib/valo-private-copy-inventory.ts",
      "artifacts/api-server/src/lib/valo-privacy-redactions.ts",
      "artifacts/api-server/src/lib/valo-privacy-erasure.ts",
      "artifacts/api-server/src/lib/valo-customer-access.ts",
      "artifacts/api-server/src/lib/valo-private-copy-inventory.integration.test.ts",
      "artifacts/api-server/src/lib/valo-recovery-erasure.ts",
      "artifacts/api-server/src/lib/valo-recovery-controls.ts",
      "artifacts/api-server/src/scripts/isolated-recovery.ts",
      "lib/db/drizzle/0029_privacy_copy_redaction.sql"],
    records:[{kind:"test" as const,path:"docs/valo/evidence/privacy-copy-coverage.json",
      hash:"a2b6f7276226e3e9f6d08c7c65ffe904a49d4e4b94e3b76e74443e0b89507606",result:"pass" as const},
      {kind:"test" as const,path:"docs/valo/evidence/physical-recovery-development.json",
        hash:"c48c947f5f1944ba941fa53795512a2ea1b19bb616bfbb207110e648c8dfee96",result:"pass" as const}],
  };
}
