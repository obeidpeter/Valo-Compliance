/** Historical partial execution evidence, not whole-requirement or release acceptance.
 * Refresh this binding only after an actual new run, checking the retained report's hash.
 */
export const partialCustomerJourneyEvidence = {
  ids: [
    "IAM-001",
    "IAM-002",
    "IAM-003",
    "PRO-001",
    "PRO-002",
    "EDT-002",
    "EDT-003",
    "EDT-004",
    "EDT-006",
    "EDT-007",
    "EDT-008",
    "WRK-001",
    "SEC-001",
    "NFR-007",
    "NFR-008",
    "NFR-009",
  ],
  record: {
    kind: "test" as const,
    path: "docs/valo/evidence/p0-customer-journey.json",
    hash: "020bd6f0b5d975b446012b22fd859167671c37d0fdef3d923287340da6cc3642",
    result: "pass" as const,
  },
};
