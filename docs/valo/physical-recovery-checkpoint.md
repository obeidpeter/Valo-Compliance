# Physical erasure after an older snapshot — development evidence

Application revision: `96efe764e977cae7299f44b2e4ad26ed62432617`.
Private development branch and draft PR2; no repository visibility change.

## Implemented and executed

The isolated runner creates three new synthetic businesses in disposable local
PostgreSQL, applies real journalled migrations and queue DDL, and snapshots both
database and local fixture objects before erasing one business. It captures the
actual completed erasure's signed case/history, redaction witnesses, sealed
object inventory and required key registrations outside that snapshot.
Verification key material is held in a separate private file, not accepted from
the journal payload. No managed database is dumped or read by this drill.

After restoring the older snapshot, target/schema/workspace guards and the outer
journal authentication run before receipt import. The full inventory is inserted
before its signed seal in one transaction: the immutable database trigger is
never disabled. Actual completion signatures, audit projections and inventory
are checked before commit. Repeat import preserves the authenticated replay
cursor rather than resetting it.

The final run passed:

- Altered outer journal rejected without effects.
- Changed inner seal, even under a newly signed outer journal, rejected with
  `ERASURE_SEAL_INVALID`; the whole metadata import rolled back.
- Pre-cutoff audit reason redacted using its authentic retained witness.
- Storage failure returned incomplete with its object still present.
- Actual Node process received SIGKILL immediately after local file deletion,
  before recording success; a new process resumed the durable cursor.
- Restored private application rows and owned queued payloads were removed.
  Repeated completion was safe; the other two fixture businesses remained.
- Deleted and revoked identities were denied without provisioning new rows;
  the active tenant's document remained accessible and cross-tenant access failed.

Actual total: **63,927 ms**. Restore/validation: **33,528 ms**.
Recovery cutoff age: **40,874 ms**. These timings are local observations, not
production RPO/RTO guarantees.

## Verification and preserved failures

`docs/valo/evidence/physical-recovery-development.json` binds the final execution
and source hashes. Timestamped earlier failures and logs are retained in
`docs/valo/evidence/physical-recovery-attempts/`. Import development found and
fixed raw-column mismatches and inventory-before-seal ordering; the test harness
was corrected to observe the Node child signal instead of pnpm's wrapper exit.
These failures are not represented as passing recovery attempts.

Selected regressions: 177 foundation/traceability tests; six private-copy/scratch tests; 15 customer-access,
isolation and export-scope tests; 45 runtime/account-boundary checks. Configured
and unconfigured HTTP suites each had 18 passes and one explicit skip. Root
typecheck and API build passed. Counts overlap earlier engineering checks and
are not the required source-backed 80/customer-AI 60/editorial 60 acceptance.

## Still unproved or incomplete

- Production restore, Replit App Storage restoration and worker topology.
- The proposed 35-day retention design; native shorter retention is not relabelled.
- Adoption of existing unsigned/quarantine-only control records and the measured
  legacy development migration history; no historical executions were invented.
- Approved field-level policy/holds and genuine external-processor outcomes.
  Local erasure does not delete Clerk, historical AI or Paystack copies.
- Full scope across production operating conditions, independent review and
  release acceptance. R1/R2 remain incomplete and unaccepted.

No owner content was deleted for verification. No genuine usage records were
removed. No new inference, external email, charge, refund or launch occurred.
