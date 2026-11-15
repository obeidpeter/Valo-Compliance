# Reviewable inference allocation and historical reconciliation

## What is now implemented

The actual managed-completion entry can execute authorized work through durable
reservation → SDK dispatch/observation → trustworthy-usage settlement. Four
lanes share one named allocation and concurrency ceiling. Independent review
pairs reserve together. Every further attempt has its own slot/reservation;
unknown outcomes retain the full reservation. Expired/changed/forged authority,
wrong work or role, altered bindings, wrong returned model and exhausted
capacity stop dispatch. There is no browser approval boolean or public
authorization endpoint.

The integration regression exercised this actual entry, injected SDK transport,
SQL ledger and outbound observer for all four lanes. These are controlled
engineering tests, **not paid provider-quality acceptance**.

Official model and Replit managed-pricing text was fetched again. Retained
source files and SHA-256 locators support the policy: $0.75/million uncached
input, $4.50/million output, 400,000 context and a conservative 10% uplift.
Full-context input plus 8,192 total completion tokens reserves **$0.3705504** per
attempt. This deliberately overestimates combined context. Smaller token
estimates remain unproved and are not used. Prices are not invoices, credits
guarantees or a cap on Agent/hosting/tax/other project charges.

## Actual historical reconciliation

All **57 existing ledger entries** are retained, including exact original
entries inside append-only classification records. Original application rows
were not modified. Source IDs, roles, candidate or drafting-prompt hashes,
actual artifact hashes, models, usage and report/run IDs were matched.

- **48 reported-usage entries**, not 48 verified billed calls.
- **6 no-dispatch reviews**: exact dependency-held rows with DRAFT_NOT_READY
  and their own failed drafting pipeline, not arbitrary failed requests.
- **3 unbounded failed gpt-5-mini drafts** remain unknown. No later context,
  completion or retry limit was assigned to them.
- The 11 publication reservations now resolve to actual retained model/usage.
  The drafting artifact binds to its original prompt hash, not the later final
  publication candidate.
- Six earlier successful editorial runs match 28,609 input / 4,749 output
  tokens, by actual IDs and source-report hashes.
- Already-excluded customer faults were **not subtracted again**. The current
  scan observes 16 zero-outbound source entries (including later controls);
  they are enumerated separately, with zero subtraction from the 57 entries.

The real development reconciliation was applied and repeated concurrently.
It retained 57 entries and 57 classifications, with identical 48/6/3 outcomes.
Controlled SQL tests also exercise eight concurrent retries and interruption.
Policy adoption preserves all usage/history and does not approve spending.

Run the metadata-only preview with:

```sh
NODE_ENV=development \
VALO_RECONCILE_INFERENCE_HISTORY=verified-metadata-disabled-only \
pnpm --filter @workspace/api-server exec tsx src/scripts/reconcile-inference-history.ts
```

The explicit `--apply-verified-history` operation re-verifies sources/artifacts
under the locked ledger, preserves original entries and appends audited
classification. It requires development and zero enabled inference batches.
It does not enable a batch, alter source rows/quotas or request a model.

## Exact prospective decision — still disabled

There is no approved global project budget. Historical scanning does not make
all past calls part of a new $30 allocation.

The reviewable proposal is explicitly **up to $30 additional pre-tax managed
text inference**, starting only at durable owner approval of the exact finite
package. Pre-approval historical liabilities remain separately visible and are
not retrospectively approved, erased, labelled free or silently counted as new
batch spending. An originally inclusive historical/new $30 balance is still
unproved because three old failures are unbounded.

The disabled decision packet freezes original content/case identities and
216/68/80/94 lane attempt ceilings. It currently contains one executable exact
operational factual/challenge pair, **two attempts / $0.7411008 maximum reserved**.
Further exact child work must pass real implemented preparation and live
bindings; unsupported corpus preparers remain software gaps, not owner holds.
Current quotas stay unchanged. Neither owner approval nor new spending occurred.

See `evidence/inference-budget-owner-decision-disabled.json` for current
package/work hashes, expiry, limits and private plan references. Its timestamped
child request must be refreshed if stale; stale evidence is never made eligible
by elapsed time.

## Executed verification

- **47** finite-entry/history/price/work-binding controls passed.
- **17** budget arithmetic/admission controls passed.
- **29** native controlled-dispatch/ledger/reconciliation checks passed.
- **177** foundation checks passed; type checks and API build passed.
- First full run found that an old frozen disabled allocation no longer
  matched the clarified boundary. That artifact was preserved; tests now prove
  it is rejected while its exact original corpus/content pins still match.
  Initial failure logs are retained.

No new paid inference, quota changes, external messages, merchant actions,
production migrations or publication occurred. Formal 80/60/60 acceptance,
eligible content, full R1/R2 and production readiness remain unaccepted.
