# Read-only finite-budget inspection and explicit privacy HTTP CI

This unit adds operator capability, not spending authority or acceptance of
the R1/R2 product.

## Current accounting without changing it

Run `pnpm --filter @workspace/api-server inference:inspect` in the guarded
development environment. It reads each allocation in a repeatable-read,
read-only PostgreSQL transaction. It does not initialize the ledger, adopt a
policy, append events, create approvals, reserve attempts or call a provider.
The two scopes have separately recorded observation times, not a fictitious
single global-account snapshot.

The output exposes counts, policy/version binding, a state fingerprint,
settled accounting and outstanding reservations. Unknown outcomes retain
their entire reservation. Missing bounds, unreconciled scoped use, suspended
state or a changed policy prevent an available-capacity claim. Private request
bodies, business context and per-request identifiers are not printed.

An uninitialized additional allocation is explicitly labelled
`uninitialized-policy-default`: its proposed capacity is not an approved or
funded balance. Initialization belongs to the existing atomic authorized
mutation path, not another human technical-verification decision.

### Actual inspection

`evidence/budget-inspection/actual-read-only-inspection.txt` retains the real
read at its recorded database timestamps:

- Historical exposure: 57 records — 48 settled-accounting classifications,
  six cancelled/no-dispatch classifications, three unknown/unbounded records.
  These are not 57 verified paid calls. The bounded ledger amount is
  234,191,100 nano-USD; it is not a verified provider bill or a total including
  the three unknown charges. No historical available balance is asserted.
- Proposed additional allocation: no persisted ledger row or attempts.
  Prospective policy capacity is $30, separate from historical liabilities.
  The whole-context fallback reserves $0.3705504 per attempt, allowing at most
  80 such attempts or 40 independent pairs before any settled usage releases
  trustworthy differences. This does not promise completion of all lane slots.
- Inspection creates no approval and authorizes no dispatch. Existing
  daily/identity quotas and the disabled spending decision are unchanged.

The existing dispatcher still requires the actual durable package approval,
unexpired exact work, lane/role/source/candidate/case bindings and locked
reservations. Its 47-case controlled suite remains separate from genuine
provider-quality acceptance. Unsupported request preparers remain held.

## Privacy regression is standard, not manual

The HTTP privacy regression was already present in the database command at
the starting saved head. It is now an explicit mandatory command chain:

`test:valo-db` → `test:valo-db-core` → `test:valo-privacy-http-db`

The last command explicitly enables the synthetic-development fixture guard,
and runs the actual HTTP/session boundary: privacy-only access, finance-only
denial, fresh MFA, revocation, tenant isolation, requester replies and hostile
origins. CI invokes the same two components as separately named steps, without
running the HTTP suite twice. Its HTTP step runs even after an earlier failure
unless the workflow is cancelled. A contract test guards the wiring,
portable storage selection and separate native lane.

The earlier native-storage / export-harness repairs are preserved. On starting
head `a50df5f`, both PostgreSQL CI jobs and both runtime-boundary steps passed.
This is not a reason to skip the new head's CI or waive separate static,
secret-scanning or internal-alert failures.

## Executed checks

| Check | Result |
|---|---|
| New inspection and CI-wiring controls | 6 passed |
| New isolated PostgreSQL inspection | 1 passed |
| Actual HTTP privacy regression, CI mode/native config removed | 7 passed |
| Full standard database command, portable CI mode | 117 core + 7 HTTP passed, zero skipped |
| Existing finite inference entry and recovery controls | 47 passed |
| Runtime/account/export boundary controls | 46 passed |
| Workspace type checks | passed |

The PostgreSQL test uses a new disposable schema. It proves absent-row reads
do not initialize anything; parallel reads leave ledger and event rows
unchanged; a changed stored policy is reported, not silently adopted.
These are controlled engineering results, not the formal 80/60/60 suites.

## Retained boundaries

Full physical erasure is still incomplete. Later removal of owner/workspace
records must not remove independent authenticated deletion-identity controls.
Retained-row quarantine does not prove the record-removal case. No owner data,
shared content, real usage history or external provider records were deleted
for this unit. There were no new inference calls, quota changes, emails,
merchant actions, production migrations or public launch.
