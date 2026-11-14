# Signed erasure inventory and late-upload recovery

This private development change builds on the existing versioned privacy-key
registry at `388b4d42`. It does not rotate real secrets, enable production
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
  depends on a tracking row still existing. The independent erasure inventory
  survives deleted export/job rows and is revisited by the existing worker.
- Repeated cleanup remains scheduled after successful deletes, so a storage
  request accepted before process death can be removed if it completes later.
  This is an ongoing cleanup obligation, not proof that such a request cannot
  finish in the future. Held replay emits a count-only operational log event.

## Verification performed here

- The standalone signing/inventory tests passed: **5 TAP records** (four cases
  plus their parent). They exercise same-workspace substitution, omissions,
  additions, malformed scope, altered completion/identity, wrong historical
  material and forged/cross-inventory progress.
- Strict TypeScript checking passed for the standalone signing implementation
  and its tests. Syntax transpilation passed for the locally materialized files.
- No PostgreSQL, native object-storage, app build or browser integration run was
  possible in this scratch environment. Those are **unrun**, not passing.

The new PostgreSQL integration suite is prepared to exercise 23 objects,
235 restored application rows, holds and role revocation during object I/O,
the actual export worker's late-upload completion after its tracking rows are
removed, and a separate export process killed with SIGKILL before upload
acknowledgement. Its object service is explicitly controlled through an internal
test transport; it is not a native-storage or production recovery proof.
The existing native-storage regression stays explicitly separate.

## Required integration before merge

Register `pending_privacy_erasure_hardening.sql` under the next available
migration number without rewriting the existing journal. Apply it only to the
reviewed disposable/development target, validate schema parity and the trigger,
then run the new `valo-erasure-hardening.integration.test.ts`, the updated
erasure integration tests, privacy key/HTTP regressions, export tests, complete
typecheck and CI. Add the new tests to the appropriate standard suites.

Independent destructive-path review is required before integration. Do not
silently adopt old unsigned inventories: they need independently authenticated
post-cutoff evidence or must remain held. The existing production recovery,
external-provider deletion, full retention inventory and owner decisions remain
outside this partial synthetic-content capability.
