# Financial dispatch and actual-caller review corrections

Status: implemented and controlled-tested; **independent re-review remains
pending**. No spending, owner approval, quota increase, message, PSP action,
production migration or publication was enabled. The complete R1/R2 assignment
is not accepted.

## Changed application behavior

1. `assertFinancialDispatchAllowed` checks the current validated ledger for
   suspension, unreconciled prior use and unbounded liability. Every new
   transport admission explicitly invokes it under the store lock, including
   a role reserved by an earlier atomic pair operation. The transition also
   checks it before any already-dispatched shortcut. Free, still-valid retained
   result retrieval remains distinct from a new dispatch.
2. Each real operational role enters its own exact `withApprovedInferenceRole`
   context. The whole review requires an approved pair context; wrapping both
   requests in one work context fails before creating attempt rows.
3. Operational pair admission is sequential, while requests remain blind and
   distinct. The first provider transport still follows atomic reservation of
   **both** roles. A first-role financial failure is durably handled before the
   challenge is admitted. The shared allocation concurrency ceiling remains two;
   this does not increase any limit or authorize a retry.
4. The managed wrapper respects a server-composed dispatcher, allowing the
   actual entry and callers to exercise real scoped SQL and binding checks.
   This is not HTTP-controlled authority: the dispatcher still loads the
   durable exact manifest, approval, expiry, policy, source and work identity.

## New actual-caller proof

`managed-callers-real-bindings.integration.test.ts` runs against actual
PostgreSQL tables in a disposable schema. It uses the real managed entry,
actual operational reviewer and customer organizer, actual SDK adapter,
unmocked `assertFiniteWorkBindings`, actual source files and authored customer
case, real candidate reconstruction, rights checks and readable DOCX/PDF
inspection. Only the model SDK and private-file adapter are controlled.
The private adapter uses real temporary files and verifies checksums.

The clock is explicitly fixed to the committed official-terms snapshot for this
offline fixture. That is not a current legal/publication eligibility finding.
Responses are labelled controlled fixtures and never counted as genuine AI
reviews or provider-quality acceptance.

**11 tests passed, zero failures/skips**, including the parent:

- Both different role requests traverse the actual entry and settle separate
  work identities; both record outbound observation.
- A first-role **bound breach**, suspension, unreconciled flag or unbounded
  liability permits exactly one controlled SDK invocation. The challenge
  remains reserved with no response ID and records the actual financial hold.
  Both reservations exist before the first transport.
- A single-work whole-review wrapper makes zero SDK calls, no reservations and
  no publication-attempt rows.
- Real saved candidate corruption and actual source-hash corruption stop the
  operational entry before transport.
- The real customer organizer uses a separately allowlisted second attempt
  after schema failure; without that work item it stops after one invocation
  with a usable held/manual-fallback result.
- The actual customer corpus checker rejects a changed case with zero dispatch.
- Shared content, publication/usage/approval rows have identical before/after
  SHA-256 fingerprints. Fixture sequences, files, schemas and any CI-created
  fixture-only NOLOGIN roles are cleaned up.

There are **zero live model calls**. PostgreSQL is real; the model transport is
zero-network. Portable file checks are not native App Storage or production
recovery proof.

## Failures retained, not counted as passes

Initial harness attempts exposed missing schema usage for switched drafter and
publisher roles. PostgreSQL resolved inaccessible schemas through `public`,
leading to rejected duplicate-key inserts or an unreadable held candidate.
The harness now explicitly sets/verifies its schema, has no `public` search-path
fallback, grants only disposable-object permissions to the switched roles, and
retargets copied serial defaults. Existing application content was not replaced.

An initial source-tamper fixture changed only one role and hit
`REVIEW_PAIR_BINDING_MISMATCH`. It was not called a source-check pass.
Both pair bindings now carry the deliberate mutation, allowing the actual
`SOURCE_BINDING_CHANGED` boundary to execute.

The earlier review findings, source reports, 57-record historical accounting and
three unresolved liabilities remain preserved. No genuine usage was reset or
deleted. All synthetic test resets occur inside the newly created schema.

## Standard commands and CI

`test:valo-db-core` now chains `test:valo-managed-callers-db`, so the normal
PostgreSQL CI step cannot omit this new actual-caller proof. The actual HTTP
privacy-role step remains independent and enabled.

Executed locally:

- Existing PostgreSQL core: **117 pass**, zero failures/skips.
- New actual-caller suite: **11 pass**, zero failures/skips.
- Actual HTTP privacy-role suite: **7 pass**, zero failures/skips.
- Finite-entry/packet/history controls: **54 pass**, zero failures/skips.
- API/workspace type checks passed during the correction.

These results do not execute the formal source-backed 80-rule, 60-customer-AI
or 60-editorial acceptance suites. Requirement evidence improves AI-007,
EDP-004/009 and OPS-005 but does not make their whole release scope accepted.
The existing exact finite request preparation must be fresh and independently
reviewed before an owner can authorize any actual batch. Expiry, source changes,
financial holds and missing authority still stop it.

## Saved-head CI failures and environment correction

Application checkpoint `b6f435a020f03a3ecd22637c761fc22e9ef20b40`
was pushed normally. Its runs
[43687118608](https://github.com/obeidpeter/Valo-Compliance/actions/runs/43687118608)
and
[43687114935](https://github.com/obeidpeter/Valo-Compliance/actions/runs/43687114935)
retain the failed evidence:

- The new actual database caller reached real rendering before that job's
  Chromium installation step. It failed on the missing Replit-default binary,
  not a financial rejection. The existing Chromium/Poppler installation and
  explicit portable executable path now precede the real-caller step.
- The runner log identifies `ubuntu-26.04`; `ubuntu-latest` had advanced and
  `postgresql-16` was unavailable. The foundation and database jobs are pinned
  to supported `ubuntu-24.04`, retaining the intended PostgreSQL 16 recovery
  target rather than dropping the restore test.
- Static checks with canaries and dependency/redacted-secret checks passed.
  Neither those passes nor local results cancel either failed CI run.

The corrected configuration must pass on its new exact saved head.

## Refreshed disabled packet

Preparation completed at `2026-11-15T06:48:26.983Z`, with **zero provider calls
and zero approval rows written**. An earlier 60-second operator timeout did not
constitute a preparation pass; the bounded rerun completed successfully.

- Package: `finite-package:1ed5cf253bcc0ea5483d038cc0e7f1cba760dcce49fb30f7f2a6c4832ecbda25`.
- Exact roster: **11 operational pairs / 22 attempts**, not 11 publications.
- Decision packet hash: `fce0eb7b59e08c1ab82ed398c08631ae92ce6be1cfe453c9a76667605c1c4943`.
- Expiry: `2026-11-15T07:47:54.999Z`; expiry requires fresh preparation, never
  elapsed-time authorization.
- Worst-case reserved exposure if authorized: **$8.1521088** using the complete
  context fallback, inside the proposed **$30 pre-tax additional-use ceiling**.
- Concurrency two, one completion, no tools or automatic retries. Current
  execution admits the two operational roles sequentially.
- `ownerApproved`, `enabled` and `authorizesDispatch` are **false**.
- Independent review is **pending**. This is prepared, not activation approval.

The exact request manifests and private report are retained in the existing
private artifact adapter; report ID `fe037e74-4050-4dc3-8e6f-32f1d72af430`,
SHA-256 `c20a98110b81e5102b2141d1cd230034ba5298ff7ce113969b9bac91947a2eaf`.
The original case rosters remain frozen, but nonpublication executable
preparers are still held. No unsupported evaluation work is implied by these
22 actual requests. Historical accounting remains separate from this proposed
new-allocation start boundary.
