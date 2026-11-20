/** Partial development evidence, not a release or full-privacy acceptance. */
export function partialPrivacyCopyEvidence(id: string) {
  if (
    ![
      "PRO-002",
      "PRV-003",
      "SEC-001",
      "IAM-003",
      "EDT-008",
      "NFR-005",
      "NFR-009",
      "OPS-003",
      "OPS-008",
      "SEC-002",
      "OPS-004",
      "IAM-002",
      "SEC-006",
      "ADM-001",
    ].includes(id)
  )
    return { paths: [], records: [] };
  return {
    paths: [
      "artifacts/api-server/src/modules/privacy/valo-private-copy-inventory.ts",
      "artifacts/api-server/src/modules/privacy/valo-privacy-redactions.ts",
      "artifacts/api-server/src/modules/privacy/valo-privacy-erasure.ts",
      "artifacts/api-server/src/modules/privacy/valo-customer-access.ts",
      "artifacts/api-server/src/modules/privacy/valo-private-copy-inventory.integration.test.ts",
      "artifacts/api-server/src/modules/recovery/valo-recovery-erasure.ts",
      "artifacts/api-server/src/modules/recovery/valo-recovery-controls.ts",
      "artifacts/api-server/src/modules/privacy/valo-privacy-requester.ts",
      "artifacts/api-server/src/modules/privacy/valo-erasure-inventory-cache.ts",
      "artifacts/api-server/src/routes/valo-privacy-http.integration.test.ts",
      "artifacts/api-server/src/scripts/isolated-recovery.ts",
      "lib/db/drizzle/0029_privacy_copy_redaction.sql",
    ],
    records: [
      {
        kind: "test" as const,
        path: "docs/valo/evidence/privacy-copy-coverage.json",
        hash: "a2b6f7276226e3e9f6d08c7c65ffe904a49d4e4b94e3b76e74443e0b89507606",
        result: "pass" as const,
      },
      {
        kind: "test" as const,
        path: "docs/valo/evidence/physical-recovery-development.json",
        hash: "c48c947f5f1944ba941fa53795512a2ea1b19bb616bfbb207110e648c8dfee96",
        result: "pass" as const,
      },
      {
        kind: "test" as const,
        path: "docs/valo/evidence/erasure-review-repair.json",
        hash: "2ca98efc965e4b99257783fd25b2d56c4aa979150a7f47d7fa7e472a21257afe",
        result: "pass" as const,
      },
      {
        kind: "test" as const,
        path: "docs/valo/evidence/bounded-erasure-replay.json",
        hash: "bbfe78b02110de5f6ecf4f6e0212575048a90c08a57d1c9304346c2f7bb55c94",
        result: "pass" as const,
      },
    ],
  };
}
