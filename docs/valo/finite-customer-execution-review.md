# Finite customer execution and historical reconciliation

Application follow-up to `9ed52050b1ddf4652f7f22928a8ed06d266787fe`.
This is engineering evidence, not R1/R2 acceptance, content eligibility, owner
spending approval, or provider-quality evaluation.

## Changed behavior

- A customer preparer reconstructs the request from the exact committed authored
  case, corpus bytes and original numeric oracle. Missing follow-up facts,
  unmapped facts, oracle disagreements and cases requiring a different control
  boundary remain held. It does not invent a quotation date or alter an oracle.
- `--prepare-customer`, `--verify-prepared`, ordinary manifest admission and
  `--execute` now connect the actual default managed adapter to the finite
  dispatcher and persisted private customer-preview service.
- Execution uses the existing retained invoice-evaluation workspace, not a
  caller-supplied workspace or newly created evaluation identity. Authorization,
  daily limits, kill switches and a durable five-requests/minute identity limit
  remain enforced. Preparation does not create approval records.
- A schema retry selects its separate allowlisted attempt. No SDK automatic
  retries or unreserved transport retries were added.
- Returned model identifiers must match the explicit approved alias/snapshot
  allowlist; identifiers and token counts must be valid and internally consistent.
  Invalid metadata holds the result, preserves its reserved liability and suspends
  further dispatch. Post-dispatch holds retain the actual outbound observation.
- Revocation/expiry blocks subsequent dispatch, including a schema retry. Valid
  usage returned by an already-admitted call still settles against its recorded
  admission and immutable manifest identity.
- Corrected historical receipts can append an audited hash-linked reconciliation
  after an earlier unresolved classification. Imports remain idempotent, original
  resolutions remain intact, and contrary established financial facts are held.

## Executed local checks

| Check | Result |
|---|---|
| Workspace-wide TypeScript checks | Passed |
| Standard PostgreSQL core | 118 passed, zero failures/skips |
| Actual managed callers, PostgreSQL, exact source/case/candidate checks | 19 passed, zero failures/skips |
| Offline finite-budget and managed-entry controls | 55 passed, zero failures/skips |

The 19-case suite exercises actual request constructors, SDK adapter, dispatcher,
customer persistence and operational review callers with a **controlled,
zero-network inference transport**. Database operations are real; candidate
DOCX/PDF checks are real. Test private artifacts use an isolated portable adapter,
not a new native-storage claim. Database fixtures have no public-schema fallback,
isolated sequences and before/after shared-state fingerprints.

Cases include missing evaluation identity; actual approved preview success while
the default remains held; separate schema retry; malformed model and usage;
revocation/expiry during the first response with no second dispatch; and the
existing identity minute limit. The PostgreSQL core additionally proves repeated
and concurrent receipt correction preserves the previous resolution chain.

During fixture development, cloning inference tables before their migration
failed with `42P07`. The fixture now leaves those tables to the actual isolated
migrations. That failed setup was not counted as a safe rejection or passing test.

Retained local output in `generated-artifacts/valo-completion/`:

- `finite-customer-db-core.txt`: SHA-256
  `057ae58bba0b08bd055a87578027811ee6c87e1040d3c1ef7741656e08af102d`
- `finite-customer-offline-controls.txt`: SHA-256
  `f761b47d20076a59ccebf0d8d17a41bac4354b3b3b7c7009cabb7b97967141d6`
- `finite-customer-types.txt`: SHA-256
  `ba0130e4c1ce10c9b900b86bd79da6c401689a632c20277ec7a959204618f331`

Both test groups are in ordinary CI: the database command chains the real-caller
suite; the finite-entry command includes the new correction control. Exact-head
CI results belong to the implementation commit/PR checks, not the earlier source
or documentation merges.

## Prepared, disabled requests

The refreshed operational packet contains 11 independent review pairs / 22
attempts, with worst-case reservation **$8.1521088**. Private report:
`90df232c-14da-418a-b54a-7fcf14945efa`,
SHA-256 `52c1374cf58a62a815c1f7d87e78813e82c703ce1ff3ea55a68e3ea51696329a`.
Decision-packet hash:
`af1cbb248dad4d21c590129e549b87c19cee143c6ed14458d36bba724cdfb828`.

The additional customer preparation is **CAI-CAND-INV-01**, with primary and
explicit schema-retry attempts, worst-case reservation **$0.7411008**:

- Manifest SHA-256:
  `2622841c5b7c1aa24f8b592a55e7c0542ad3b0b62ffb4e5d0cbbbb29c6d69a16`.
- Case SHA-256:
  `5ed0815c5631dee1032ff6a58b7e18dc708045b6ecf62a6ddaa92acb89ece718`.
- Private preparation artifact: `7cb91f6b-d860-4a7b-9100-e31524adb6c5`,
  SHA-256 `64f2c2b29e17b0faea8275ade238ca7784cd39deab43bd19b24e1fb3464c3b22`.
- Read-only verification passed for both exact work items; expires
  **15 November 2026, 08:27:14.693 UTC**. Expiry requires a fresh preview and actual
  authorization, never elapsed-time approval.

These two preparations total at most **$8.8932096**, not the entire proposed
216/68/80/94-slot roster. The shared **additional-new** $30 pre-tax ceiling remains
disabled and uninitialized: zero reservations, dispatches or settlements.
Capacity is not a funded balance or authorization. Whole-context fallback is
$0.3705504/attempt, including the proposed 10% uplift. New authoring is outside
this proposal. No spending, quota changes or owner approvals occurred.

## Historical exposure remains separate

Read-only retained-evidence reconciliation classified all **57** records:
**48 reported-usage**, **6 evidenced no-outbound**, **3 unresolved potential-charge**
records. It did not apply an accounting mutation. The historical ledger remains at
version 9, fingerprint
`c07bf75aaa2a4ac75de022025411c98877d44a23bbc9674d45de99b2359be29d`.

Known recorded usage estimates total **$0.2341911**, not a verified bill. The
three failed historical `gpt-5-mini` attempts still lack supported historic
completion/context/retry bounds. Their cost remains unknown: no zero-cost
assumption or invented remaining global balance. Unrelated historical exposure
does not become a retrospective charge to the proposed additional allocation.
The 12 injected customer fault cases were not subtracted again.

## Still open

- Independent review of these application changes and an actual owner spending
  decision before any new inference. Existing quotas remain unchanged.
- Full editorial/checker finite executable preparation, other mapped customer
  cases and genuine source-backed 80 / customer-AI 60 / editorial 60 acceptance.
  This single prepared invoice is not a completed evaluation.
- No new eligible publication or source-rule release. Draft content counts did
  not become publication counts.
- Physical erasure, durable large-export and dispute corrections from the
  independent reviews remain separate unfinished units. Merchant/email setup,
  production evidence/approvals and R1/R2 gates are not cleared by these tests.
