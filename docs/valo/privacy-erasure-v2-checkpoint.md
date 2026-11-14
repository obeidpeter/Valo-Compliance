# Scoped erasure and rotation checkpoint

Requirements: PRV-003, IAM-003, SEC-001/002 and OPS-004 (partial development
evidence, not requirement acceptance).

New verified synthetic erasures use the explicit v2 scope. Older v1 records
retain their narrower scope; the code does not silently broaden a completed
old request.

## Working behavior and executed evidence

- The file inventory regression covers ready files, pending upload reservations
  and cleanup reservations together. A ready file appearing in both asset and
  object tables produces one deletion entry. Four distinct journal entries
  were checked; real synthetic storage bytes and missing/pending objects were
  deleted idempotently.
- Revocation and queue fencing precede deletion. A stale queue ID cannot run a
  fenced export. A failed object delete keeps document rows intact until retry.
- V2 removes support message/contact copies and privacy request/prepared-result
  bodies, including another case in the same workspace. Changes to signed case
  state append new signed events; existing signatures still verify.
- AI previews/plans are removed while usage, cost and quota receipts remain.
  Financial history and minimal case references are not silently deleted.
- Unsent purchase notices are held in bounded batches. Controlled database
  tests distinguish pending/retry from accepted, delivered and unknown
  outcomes, and preserve another workspace and original order references.
- Key rotation uses current signing and historical verification material as
  documented in `privacy-key-rotation-checkpoint.md`. No real key was rotated.
- **101/101 development database tests** passed with zero failures/skips;
  **2/2 operations tests** and workspace typecheck passed. No provider models,
  payment actions or external messages ran. The original one-object fixture
  assertions initially failed after adding more objects; those outputs are
  retained alongside the corrected exact-set/count assertions.

## Still incomplete

This is **not complete account erasure**. Signed historical audit text, minimal
case/financial references and external/provider outcomes remain explicit
exceptions or holds pending retention/privacy decisions. Deletion controls
must still be retained and authenticated independently of the restored
database snapshot; replay tests using retained development rows do not prove
that complete backup/import capability or production recovery.

Privacy-case customer replies and read-only staff inspection were subsequently
implemented in [the information-exchange checkpoint](privacy-information-checkpoint.md).
Large resumable customer exports, merchant
dispute execution/decisions, rich released-rule customer integration and the
actual finite inference manifest/liability reconciliation remain separate
unfinished software/evidence work. No spending decision is requested here.
