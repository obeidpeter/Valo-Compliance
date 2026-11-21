/** Actual partial development test evidence. Does not clear any requirement blocker. */
export const partialExportEvidence: {
  ids: readonly string[];
  record: { kind:"test";path:string;hash:string;result:"pass"|"not_run" };
} = {
  "ids": [
    "EDT-006",
    "EDT-007",
    "EDT-008",
    "EDT-009",
    "SEC-001",
    "SEC-004",
    "OPS-002",
    "OPS-003",
    "OPS-007"
  ],
  "record": {
    "kind": "test",
    "path": "docs/valo/evidence/part5-export-checks.json",
    "hash": "40010e211e17348f36cf6ce72efccd705819be99f0056e2cfba31806357c3dfb",
    "result": "pass"
  }
};
