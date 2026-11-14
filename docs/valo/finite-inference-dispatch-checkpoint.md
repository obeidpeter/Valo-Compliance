# Finite inference dispatch — implemented, not enabled

The managed entry point now has a real success path connected to the shared
PostgreSQL reservation/dispatch/settlement ledger and managed SDK transport.
The SDK is imported only after admission and dispatch commit. No owner approval
or enabled batch was inserted, and no new paid calls ran.

Authority comes from a durable enabled batch with an actual approval reference,
approver, approval time, expiry, exact policy hash and immutable manifest. A
manifest binds each attempt's lane, role, full request, candidate, source files
and case. Runtime rechecks the retained candidate and actual source/case bytes.
Caller booleans and hash-shaped strings do not establish authorization.
Approved manifests cannot be edited or reactivated after revocation.

The global ledger reserves independent pairs together, uses the correct
publication/editorial-evaluation/checker/customer allocation, caps concurrency
at two and reserves $0.3705504 per whole-context attempt. Unknown outcomes keep
their full reservation and cannot be retried under the same identity. A further
attempt needs another allowlisted work key and reservation. Exact unchanged
fresh results can be reused without a new call. No tools, streaming, multiple
completions or SDK retries are admitted.

## Executed evidence

**26/26** combined budget unit and isolated PostgreSQL tests passed, including
the controlled success transport, reuse, pair admission, correct lanes,
duplicate dispatch denial, concurrent admission, depletion, timeout liability,
source/request/manifest changes, expiry and policy adoption. Workspace typecheck
passed. Controlled authority exists only in the disposable test schema.

Reviewed additive development migration 0020 was applied. It includes a native
immutability trigger, which must be explicitly bootstrapped and verified in a
production migration: managed schema publishing is not assumed to copy it.
No production migration or existing-baseline adoption is claimed.

Policy adoption preserved the exact existing usage-state hash and all **57**
potential-charge records. There remain **20 unresolved/unbounded records**.
Available retained operational review receipts have no exact response-ID
link to those unknown entries, so they were not guessed into reconciliation.
The zero-missing-usage assumption is expressly forbidden. The retained
preparation report keeps `availableBalance: null`, zero enabled batches and a
hard admission hold. Reported token pricing is not an invoice.

## Remaining work and decisions

The real finite work manifest still needs preparation from the exact final
requests/candidates, and unknown historical liabilities need exact retained
provider receipts or another defensible bound before a remaining allocation
can be certified. There is no artificial exact-tokenization prerequisite for
the valid full-context fallback. Existing daily/identity caps remain unchanged.
The owner's spending decision is still false. This checkpoint is not a
provider-quality evaluation, publication, or R1/R2 acceptance.
