# Bounded replay and current repair evidence

The receipt repair unit was saved separately at `cbd0b7e`. Its 94-order
forensic run is linked in `synthetic-receipt-recovery.md`; lost original
exception causes remain unknown.

## Bounded recovery

Recovery no longer re-hashes the entire object journal for every object and
application batch. A successful full check can be reused only under the exact
reviewed immutable PostgreSQL trigger and function, completed seal, database
epoch and catalog revisions. Before every destructive dispatch the service
still checks current case/hold state, historical keys, scope and guard metadata.

Attestations are process-local, bounded to 64 entries and five minutes. A new
process, changed seal, expiry, changed/disabled guard or catalog revision
invalidates reuse. Missing or unrecognised guard definitions always fall back
to full verification. Recovery receipt imports explicitly force a fresh full
check. No new migration or database privilege was required.

This relies on trusted database administration and the existing immutable
guard; it is not a claim to defeat a malicious database superuser. Recovery
imports must not bypass the independently authenticated receipt validation.

The native regression restored **13 object locators and 205 profile revisions**.
It killed a worker after ten objects and a second after the first 100-row
application batch, then resumed in a fresh process. Results:

- Exactly **13** object deletion calls, no duplicate calls.
- All **205** restored revisions removed.
- At most **10 objects** or **100 application rows** per batch.
- Final restarted process: **one** full inventory check and **29** guarded
  reuse checks. Completed worker exits normally.
- Existing corrupt-inventory/case tests still produced zero destructive
  operations; hold, role and historical-key checks still passed.

## Executed checks and limits

**32 native erasure/key/HTTP tests**, **13 seal/lock/cache controls**,
**11 large-download HTTP tests**, and **23 controlled inference-dispatch
tests** passed. The inference results are zero-paid-call controls, not new
model-quality evaluation or owner approval.

The isolated development restore passed in **67,803 ms**, including **35,197 ms**
for restore/validation; cutoff age **42,517 ms**. This is local disposable
PostgreSQL/local fixture-object evidence, not production or App Storage backup
recovery and not proof of 35-day retention.

The large-download regression verifies existing preparation cancellation,
current session/membership checks, exact paginated data and interruption
behavior. Passing it does not invent any missing durable-export capability.
New native private-object operations used only fresh synthetic fixtures.

The initial new replay test failed before the child started because two test
imports were missing. Its logs and type errors are retained alongside the
successful run; it was not counted as a passed scenario.

Full R1/R2, external privacy fulfilment, eligible content, formal 80/60/60
acceptance and production/commercial decisions remain unaccepted. No new
inference spending, external message, merchant action, quota escalation or
public release occurred.
