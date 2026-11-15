# Finite inference: final SDK admission and disabled review packet

This is a development implementation checkpoint, not R1/R2 acceptance, a
content publication, an approval to spend, or a verified provider bill.

## Changed behavior

- The dispatcher snapshots the approved request before asynchronous work. A
  caller changing its object during SDK loading cannot change the sent model
  or payload.
- Authorization, immutable manifest identity, real source/case bindings and
  hard financial holds are rechecked at transport invocation **and after lazy
  SDK loading, immediately before SDK create**. A newly suspended allocation,
  unknown liability, revocation, expiry or changed manifest stops that handoff.
- Outbound observation still occurs only after that final check. A denial
  produces no SDK create/observation. Its reservation is conservatively retained,
  not reported as a charge, a settled receipt or usable model output.
- Existing trustworthy receipts from calls already in flight still settle
  after approval expiry/revocation. Each real review role and schema retry uses
  its own exact approved work. No automatic model retry was added.
- The operator CLI now provides credential-free `--help` and rejects unknown
  modes before database/SDK initialization. Preparation progress contains only
  safe stage/template identifiers, never request bodies.

## Executed verification

Final isolated run: `72532877-ce8e-400a-8cde-129619556b59`, started
2026-11-15 09:18:41.992 UTC, finished 09:19:43.500 UTC.

| Group | Passed | Failed | Skipped |
|---|---:|---:|---:|
| Credential-free finite controls | 67 | 0 | 0 |
| No-database and native-I/O detector | 3 | 0 | 0 |
| Controlled runtime boundary | 1 | 0 | 0 |
| PostgreSQL dispatch and historical reconciliation | 29 | 0 | 0 |
| Actual managed entry, review/customer callers and real bindings | 19 | 0 | 0 |
| Portable storage with native I/O forbidden | 18 | 0 | 1 |
| **Total engineering checks** | **137** | **0** | **1** |

The native-storage-only skip is explicit. Controlled storage is not native
provider proof. These counts include test parents and are **not** the formal
80 source-rule / 60 customer-AI / 60 editorial acceptance suites.
All workspace typechecks passed; the final CLI help wording change was followed
by another 67/67 finite-control run and API typecheck.

The test database was a fresh disposable PostgreSQL instance:
`postgres|valo_finite_proof|127.0.0.1|39273`. Its tracked Drizzle migrations and
the same reviewed queue installation used by ordinary CI were applied there,
not to the workspace database. Provider credentials were excluded; no owner
approval, real inference, PSP action or email dispatch was performed. The
cluster was stopped and removed.

Reproduce with:

```sh
NODE_ENV=development node scripts/src/valo/verify-finite-budget-integration.mjs
```

Logs and result metadata are under
`generated-artifacts/valo-finite-final-gate/72532877-ce8e-400a-8cde-129619556b59/`.
The [committed result projection](evidence/finite-sdk-admission-result.json)
retains counts, source/log hashes and environment boundaries for repository review.
Earlier incomplete/failed harness runs remain retained: one outer timeout,
one synthetic session key below the required length, and a portable run missing
the separately installed queue schema. They are not counted as passes. The
final harness mirrors CI's explicit queue migration before the erasure tests;
no erasure, recovery-key, checker or receipt source was changed.

## Exact additional-new preparation, still disabled

- Package: `finite-package:35bf0560c1393012cd74b4610329cfacc5a39113dd7f237ac7616e768a819817`.
- Private report: `ba21d36d-ec3b-4325-93d3-03bc164fd5ee.json`;
  SHA-256 `1720e66998968abbe198c33ee86085f673e0224e6c659358d067ce3f1b4ca3f1`.
- Decision packet SHA-256:
  `0fe67583b983837e59fe578bed9e48f3a785d8ae5d3ebf6a3e1b8446310df864`.
- Prepared 2026-11-15 09:19:19.110 UTC; earliest expiry
  **2026-11-15 10:18:45.671 UTC**. An expired packet cannot be dispatched.
- Twelve exact submanifests: eleven factual/challenge operational review pairs
  and `CAI-CAND-INV-01` primary plus its separate, conditional schema retry.
  **22 publication + 2 customer attempts; 0 editorial-evaluation or checker
  attempts in this first selection.** Their broader frozen corpora remain
  distinct, and their unsupported preparers remain held.
- Full-context reservation: $0.3705504/attempt, including the 10% contingency.
  The selected 24 attempts reserve at most **$8.8932096 pre-tax** within the
  proposed, unfunded **$30 additional-new ceiling**. This does not promise that
  all attempts will run or finish before expiry.
- Existing lane ceilings remain 216/68/80/94; concurrency two, one completion,
  no tools, no automatic retries. Existing daily/identity limits were unchanged.
  New authoring is excluded. Preparation does not consume review authority.

The exact requests, candidate versions, source/case hashes and retry links are
retained privately, not copied into routine logs. Read-back verification
reconstructed all **24 work items / 12 manifests**, checked the decision packet
and current bindings, and returned `independent-review-pending`,
`approvalRowsWritten: 0`, `providerCalls: 0`, `authorizesDispatch: false`.
No budget approval or spending activation was performed. Existing useful
input-size guards remain; pricing uses the verified full-context fallback
rather than claiming the byte estimate proves provider tokenization.

## Historical accounting is separate, not erased

Read-only observation at 2026-11-15 09:22:14 UTC:

- Legacy ledger: 57 potential-charge records; 48 retained usage settlements,
  six evidenced no-outbound cancellations and **three unresolved records**.
  Known estimated amount: $0.2341911, **not a verified bill**. Unresolved
  historical exposure remains explicitly held; no global historical allocation
  or remaining balance was invented.
- Legacy fingerprint:
  `c07bf75aaa2a4ac75de022025411c98877d44a23bbc9674d45de99b2359be29d`.
- Additional-new allocation: uninitialized/default policy, **zero records,
  settlements and reservations**, not a funded $30 balance. It begins only
  at actual durable owner approval; unrelated older uncertainty is not silently
  imported as a new-spending prerequisite.
- Additional-new fingerprint:
  `862c5a4daa20b04c1a52f0fc4d51f711f2d2df171e462b75b05611d70679aa96`.

Both fingerprints match the preceding observation. Exact supported historical
joins, audited corrections, unknown-outcome accounting, racing reservations,
real caller role/retry selection and post-revocation settlement are exercised
by the retained engineering suites, not described as newly executed paid calls.

## CI, traceability and remaining boundaries

The 67 controls are in ordinary `test:valo-finite-entry`; actual caller tests,
portable storage and HTTP privacy regression remain in ordinary database CI.
Latest saved-head hosted runs before this checkpoint, 43696413640 and
43696408600, could not start any job because of GitHub's account billing/spending
restriction. Local passes do not establish new-head hosted CI success. No plan,
account spending setting or workflow authorization was changed.

Partial engineering evidence relates to **AI-002, AI-005, AI-007, SEC-005,
SEC-006, NFR-009 and OPS-005**. It does not satisfy those requirements in full
or advance a release gate. The original 127 requirement texts/IDs and formal
unverified acceptance status are preserved.

Independent budget review and actual owner authorization remain outstanding.
Prepared source drafts are not eligible publications, model-quality results or
licence acceptance. No new formal 80/60/60 acceptance was executed. Public
launch, live payments and R3 remain disabled. The existing PR11 merge and its
26-check Replit proof remain recorded in
[receipt verification](receipt-pr11-replit-verification.md); no receipt code
needed to be merged or rewritten again.
