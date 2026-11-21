# Signed erasure inventory and late-upload recovery

This private development change builds on the existing versioned privacy-key
registry and scoped-copy redaction at `e542ff15` / `1b44e7c2`. It does not rotate real secrets, enable production
erasure, contact external processors or claim complete account deletion.

## Behavior

- Quarantine signs the original synthetic owner/tenant/case binding. Capture
  then signs the complete ordered object inventory. A database trigger prevents
  adding, removing or substituting sealed keys; deletion-status receipts remain
  writable. Existing unsigned journals remain held and are not silently signed.
- Recovery validates the completed case's audit chain, completion receipt,
  exact inventory, key versions and signed recovery cursor before object I/O.
  It checks current case hold state before every object call. Initial staff
  erasure additionally rechecks the current privacy role/session on every call.
- Current signing material is pinned and checked before destructive work, even
  when all historical proofs verify. Dispatch keys are captured inside the same
  locked transaction that authenticates the exact inventory; the sealed inventory
  binding cannot be cleared to admit a new key.
- Advisory locks use a separate two-connection pool with finite acquisition/query
  timeouts, idle-exit safety and explicit worker/test shutdown. They cannot consume
  all shared data connections and prevent hold/revoke transactions from running.
- The latest development support/contact and prepared-result redaction is retained,
  including signed case updates, unsent-notice holds and accepted-outcome retention.
- An explicit hold release resumes the recorded erasure phase. Claiming cannot
  bypass a hold, and begun erasure cannot be rejected as though nothing happened.
  Results of already-dispatched deletions are retained even if a later hold or
  role revocation prevents the next call.
- Each object batch deletes at most 10 keys; application replay changes at most
  100 rows in one named section per invocation. Signed persistent progress
  prevents every application batch from restarting object replay. Full inventory
  verification scans ordered 250-row pages with bounded application memory before
  each object batch; total validation latency has not been load-tested.
- Export cleanup checks whether its object became a retained asset after any
  ambiguous database commit. For an unretained temporary key, cleanup no longer
  depends on a tracking row still existing. Once a privacy tombstone exists,
  both temporary-file and ordinary orphan cleanup defer to the signed case
  gate, so they cannot bypass a hold. The independent erasure inventory survives
  deleted export/job rows and is revisited by the existing worker.
- Repeated cleanup remains scheduled after successful deletes, so a storage
  request accepted before process death can be removed if it completes later.
  This is an ongoing cleanup obligation, not proof that such a request cannot
  finish in the future. Held replay emits a count-only operational log event.

## Verification performed here

- The standalone signing/inventory tests passed: **5 TAP records** (four cases
  plus their parent). They exercise same-workspace substitution, omissions,
  additions, malformed scope, altered completion/identity, wrong historical
  material and forged/cross-inventory progress.
- Five standalone lock tests also passed: six distinct cases with separate
  two-slot lock/one-slot data pools, same-case contention, callback rejection,
  ambiguous acquisition and failed unlock. Failed/uncertain ownership destroys
  the connection instead of returning a possibly locked session to the pool.
- Strict TypeScript checking passed for both standalone helpers and their tests.
  Syntax transpilation passed for all 18 locally materialized TypeScript files.
- No PostgreSQL, native object-storage, app build or browser integration run was
  possible in this scratch environment. Those are **unrun**, not passing.

The new PostgreSQL integration suite is prepared to exercise 23 objects,
235 restored application rows, holds and role revocation during object I/O,
the actual `executeExport` function's late-upload completion after its tracking rows are
removed, and a separate export process killed with SIGKILL before upload
acknowledgement. Its object service is explicitly controlled through an internal
test transport; it is not a native-storage or production recovery proof.
The full pg-boss worker and native-storage regressions remain separate. Current-key mismatch, missing historical keys, corrupted audit/completion proof, incomplete/corrupt/held ordinary cleanup, and concurrent distinct cases with a one-connection data pool are also prepared as database regressions.

## Required integration before merge

Migration `0022_privacy_erasure_hardening.sql` is registered after 0021 without
rewriting history. Focused `test:valo-erasure-controls` and `test:valo-erasure-db`
scripts are registered as separate CI steps; the latter uses explicitly synthetic
PostgreSQL fixtures and controlled DOCX upload transport, with no browser or native
storage credentials. The genuine native storage case reports its missing runtime
prerequisite separately rather than skipping the portable controls.

Apply only to the reviewed disposable/development target; validate schema parity,
the trigger, new erasure tests, privacy key/HTTP regressions, export tests, complete
typecheck and CI. Native Replit storage/full-worker verification remains separate.

Independent destructive-path review is required before integration. Do not
silently adopt old unsigned inventories: they need independently authenticated
post-cutoff evidence or must remain held. The existing production recovery,
external-provider deletion, full retention inventory and owner decisions remain
outside this partial synthetic-content capability.

## Executed synthetic CI checkpoint

At code commit `b77b2b14704ab8332511c3ce979dd231a509fab7`, GitHub CI applied
registered migration 0022 to an empty disposable PostgreSQL service. The focused
erasure suite passed 15 tests, failed 0 and explicitly skipped 1 genuine native
Replit storage case because its runtime prerequisite was unavailable. This run
executed the delayed `executeExport` upload, SIGKILL-before-acknowledgement replay,
23-object/235-row continuation, hold/role revocation, historical/current key
failure, corrupt audit/completion and one-data-connection concurrency regressions.

The standard PostgreSQL suite passed 100 tests with the same one native skip;
write security passed 12/12, commerce 15/15 and refunds 17/17. Full source typecheck,
the 10 pure privacy test records, foundation units, static security and dependency/
redacted-secret checks passed. The overall foundation job still failed in the
separately owned inference-budget/customer-AI unit tests due to eager database
imports without DATABASE_URL. Those failures are not waived or reported green.

Independent source review at `b127edf1451614fa897376b32b1139340d7f7be5` found no
remaining blocker within the synthetic scope; subsequent changes registered
migration/tests and corrected only a test pg-config type error. Native Replit
object storage, the full pg-boss export worker and production recovery remain
unverified and outside this controlled transport proof. A normal merge of the
reviewed rich-checker branch follows this checkpoint; its combined CI must be
read separately rather than assuming the earlier run covers the merge.
