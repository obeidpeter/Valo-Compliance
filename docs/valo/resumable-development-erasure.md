# Resumable development application-content erasure

This is a partial privacy capability, not accepted R1, production erasure,
complete account deletion or processor fulfilment.

Verified, assigned deletion requests now support start/resume rather than an
unconditional 503. The privacy operator needs a fresh server-verified MFA
session, active privacy role, current request version, recorded reason and
explicit acknowledgement. Held/unverified requests cannot proceed. Runtime must
be explicit non-deployed development and the workspace must be explicitly
synthetic. Production and non-synthetic workspace deletion remain disabled.

## Actual behavior

- Commit membership revocation and a deletion tombstone before the destructive
  phase. A second transaction fences export generations, disables reminders and
  captures registered/pre-upload object keys. Export workers now reauthorize
  before registering a new object, in addition to their delivery authorization.
- Delete at most ten captured objects per step. Failures retain the same keys
  and block progression; retries do not claim successful deletion prematurely.
  Keys must match the journal workspace even if the journal is corrupted.
- Advance through static child-before-parent application sections, at most 100
  rows per step. A crash rolls back the current database batch; the next resume
  retries the same phase without an unreliable in-memory cursor.
- Physically remove scoped drafts/revisions, profiles, assessments, tasks,
  reminder records and export rows. Redact private AI preview/plan content and
  unlink accepted documents while retaining provider usage and quota metadata.
  Erasure must not erase already-incurred cost or reset a quota.
- Retain financial history, support/privacy requests, audit records and the
  recovery journal. These are conservative unresolved retention exclusions, not
  assertions that a particular statutory hold or retention period applies.
- Report **partially fulfilled**, not fulfilled. Managed identity, backup expiry,
  external processors and retained exclusions remain visibly held.
- Internal recovery helpers revoke restored membership and repeat captured
  object deletion. After a completed case and its authenticated deletion journal
  have been restored/imported, a bounded replay physically removes restored
  scoped application content. This does not implement external journal backup
  or claim that post-cutoff tombstones magically exist in an older backup.

Staff UI exposes start/resume with the irreversible-scope acknowledgement and
actual per-system outcomes. Closing access prevents further private customer
operations; public account-access support remains available. A dedicated
post-closure authenticated result-delivery flow is not implemented.

## Executed evidence

- Nine actual development integration test records passed (including suite
  parent): authorization/version/acknowledgement failures, concurrent start,
  quarantine, storage failure/resume, physical row deletion, cross-tenant
  preservation, retained usage, restored-data replay, native private-storage
  write/read/delete/re-delete, corrupted cross-workspace key denial and rejected
  environment modes with zero object-deletion calls.
- Existing privacy domain proof: 10/10 passed, controlled staff identity/MFA.
- Workspace typecheck passed.
- Actual private-export regression: 10/10 passed, including private App Storage,
  Chromium PDF and abrupt worker restart. The initial invocation used the wrong
  test opt-in and skipped; only the subsequent explicitly enabled run is counted.
- Requirement/engineering regression: 174/174 passed, not formal 80/60/60 acceptance.
- Empty disposable local PostgreSQL executed all 20 journalled migrations.
  Existing development has no adopted baseline ledger; a direct migration
  attempt refused on an already-existing baseline table. The separately reviewed
  additive delta was applied without fabricating baseline migration history.
  No production migration was performed.

Provider erasure, approved production retention, independently assessed launch
security/privacy, production restoration and the 35-day retention design remain
unproved. Test outcomes are not content publication, AI quality acceptance,
payment execution or R1/R2 acceptance.
