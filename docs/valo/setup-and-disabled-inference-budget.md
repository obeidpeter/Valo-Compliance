# Valo — setup checklist and disabled inference proposal

## Current refinement: whole-context fallback, still disabled

The finite batch can reserve the verified named model's entire 400,000-token
context as input plus 8,192 completion tokens when exact full-request tokenization
is unproved. At the supplied prices and a 10% uplift this is **$0.370550400 per
attempt**, rounded upward in integer nano-USD. Reserving input plus output this
way deliberately overestimates the shared context capacity. It covers only this
named pre-tax text-inference batch, not taxes, other account charges or development.

Settled charges plus all outstanding reservations must remain at or below $30.
Independent factual/challenge reviews reserve together atomically. With no
prior charges and maximum unknown usage, at most 80 attempts (40 full pairs)
fit; this is not a promised completion count or available balance. Existing
pilot charges and unresolved liabilities still count and must be reconciled.
Unknown outcomes retain their full reservations and occupy concurrency until
trustworthy usage is reconciled. No elapsed-time release, tools, multiple
completions or automatic retries are allowed. Every additional attempt reserves
again. Concurrency is two; original lane ceilings remain 216/68/80/94. Exact,
unchanged and fresh evidence can be reused without a new call.

There is **no imposed 60/day or four-day minimum schedule**. Existing application
daily/identity quotas remain unchanged and independently enforced; genuine
provider rate limits still apply. Existing input-size guards remain necessary.
The smaller lane-specific estimates below apply only with trustworthy exact
full-request bounds, not byte estimates. Otherwise the whole-context reservation
is required; a partial batch may stop safely before all slots are used.

The batch and managed transport remain disabled and unapproved. The changed
policy hash intentionally holds any existing ledger pending reviewed adoption;
this change does not overwrite the old policy, discard pilot use or reconcile
unknown charges. No SDK call or new spend is enabled by this refinement.

**Preparation only. No spending approval, activation, quota increase, new
evaluation identity, live commerce or production launch.** New managed inference
is held; existing private drafts/previews/downloads and manual editing remain
available. Daily identity/workspace limits remain unchanged.

## Reviewable allocation (USD, pre-tax)

| Lane | Slot ceiling, including retries | Full input per call | Total output per call | Base maximum | With 10% uplift |
|---|---:|---:|---:|---:|---:|
| Publication | 216 | 32,000 | 8,192 | 13.146624 | 14.4612864 |
| Editorial evaluation roles | 68 | 32,000 | 8,192 | 4.138752 | 4.5526272 |
| Independent checker challenges | 80 | 32,000 | 8,192 | 4.869120 | 5.356032 |
| Customer attempts | 94 | **4,096** | 8,192 | 3.753984 | 4.1293824 |
| Combined | 458 | Lane-specific | Lane-specific | **25.908480** | **28.499328** |

Proposed shared ceiling: **$30**. Nominal headroom before prior use is
**$1.500672**. These are ceilings, not an estimate of necessary calls or an
assertion every evaluation requires a model. Original supplied content need not
be regenerated to manufacture provenance. The combined figure mathematically
requires the 4,096 customer full-input ceiling. Using 32,000 for every slot would
cost $30.6632832 with uplift and does **not** fit $30.

If a legitimate case needs more complete input or output, hold that case and
revise its allocation/estimate before authorisation. Never truncate necessary
source, schema or instructions to manufacture a passing bound.

The application uses integer nanodollars: 750 per input token, 4,500 per output
token; uplift is rounded upward. No cache discount, refund or free failed call
is assumed. Every retry needs another slot and worst-case reservation. One
PostgreSQL row lock covers all lanes. Pending/unknown/time-out liability never
expires automatically. Known reported usage settles idempotently; bound breaches
suspend further admissions. Exact fresh request/evidence/scope bindings can
return a prior result reference without new inference; ordinary authorisation,
withdrawal, deletion and result validation still apply.

### Why spending stays held

1. Owner spend approval is absent and the proposal is disabled in code. There
   is no environment switch or activation endpoint.
2. The smaller lane-specific estimates still lack a verified full-request
   token-count adapter, including instructions and schemas. This **does not
   block the whole-context fallback** above. Bytes plus protocol allowances
   are not token proof; no count/generation request was made without authority.
3. **Provider/owner-controlled evidence:** actual managed routing, processing
   region, service tier and applicable price upper bound require confirmation.
   The public price/uplift calculation is not a billing guarantee.
4. **Mixed code/data reconciliation:** existing pilot metadata is imported
   without prompts/draft bodies. Missing model/usage or unresolved attempts stay
   explicitly unbounded. Reported-token amounts are provisional, not receipts.
   Legacy simulation markers are not all reliable enough to infer a zero bill.
   Reconcile the project usage statement, returned-model records and any gaps
   before approving finite remaining capacity.

`evidence/inference-budget-proposal.json` records actual metadata counts and
estimates. Do not mistake potential-charge records for a count of genuine paid
calls. No source rows or real usage history were deleted. The budget only covers
this application's managed inference, not Agent use, tax, hosting, subscriptions,
other projects or externally initiated calls.

## One setup checklist

| Area | Genuinely owner/provider-controlled input | Code/evidence still required |
|---|---|---|
| Merchant test | Valo-owned Paystack **test** account; approved sandbox price/licence/refund policy; test credential through Secrets; merchant's active timestamped signing-secret or legacy mode; test webhook URL/configuration | Verify raw-body mode/rotation/no downgrade, actual sandbox initialise/verify/refund/reconcile, timeout/race/dispute and durable receipt evidence. Controlled transports are not settlements. No live key accepted for these tests. |
| Owned email test | Verified Valo sender/domain and authentication; the selected verified owner's recipient/identity; specific approval for one bounded test | Confirm integration sender verification and actual acceptance/delivery event; default off, development-only, owner-only guards remain. No automatic backlog dispatch or messages to other people. Controlled events do not prove delivery. |
| Production/privacy | Actual providers/regions, agreements, transfer assessment, retention/deletion/backup policy and named accountable owners | Separate environment configuration, worker/storage access, reviewed migration/adoption, production-shaped restore/rollback/RPO/RTO, data lifecycle, monitoring and security/privacy evidence. Native backup retention is not assumed to meet 35 days. No real confidential customer data yet. |
| Independent testing | Consenting beta participants, named accountable owners and approval for sensitive privacy/production or external/live tests | A separate AI technical security/privacy assessment may provide independent evidence; external human hiring is not required. Coding agents cannot approve their own security work. Routine scans alone are not that assessment. Accessibility/usability evidence and genuine participant outcomes remain required. R1 gates precede R2 activation. |
| Inference | Explicit bounded approval only after the above token/pricing/legacy proofs; optional reduction of allocation if prior cost exceeds headroom | Full-request attestation, verified actual tier/region price bound, pilot reconciliation and reviewed dispatcher activation remain absent. No quota increase is authorised by this checklist. |

Do not paste secret values into chat or documents. Use the existing authorised
integration/Secrets flow when configuring merchant/email credentials.

## Verification and migration boundaries

Offline controls and isolated PostgreSQL tests exercise reservations, races,
duplicate runs/settlements, retries, unknown outcomes, depletion and unchanged
evidence reuse. Their enabled authorities/token attestations are **synthetic
fixtures**, never provider/tokenizer proof.

All journalled migrations, including the additive budget tables, ran on an
isolated local cluster. The existing development database has an empty Drizzle
ledger despite pre-existing tables; the normal migrator failed rather than
adopting that history. Only reviewed additive `0018` was applied explicitly to
development, without inventing old journal entries. This is not production
migration, database adoption or recovery proof.

## Official references retrieved on 14 November 2026

- OpenAI model/prices: https://developers.openai.com/api/docs/models/gpt-5.4-mini
  — $0.75 uncached input / $4.50 output per million tokens.
- OpenAI regional pricing: https://developers.openai.com/api/docs/pricing
  — qualifying regional endpoints have a 10% uplift.
- Count endpoint: https://developers.openai.com/api/reference/resources/responses/subresources/input_tokens/methods/count
  — Responses input counting; not proof of our current chat/proxy equivalence.
- Replit managed integrations: https://docs.replit.com/features/integrations/replit-ai-integrations
  — official documentation search confirms public API pricing deducted from
  Replit credits. This is not an account-specific invoice or regional attestation.

All 127 requirements and existing R1/R2 scope remain active and incomplete.

## Executed checkpoint

`evidence/inference-budget-checkpoint.json` binds runtime source hashes and test
log hashes. Current execution: API **172 passed / 1 skipped**; database **62
passed**, including the isolated shared-ledger race; commerce **15 passed**;
refund lifecycle **17 passed**; controlled refund adapter **5 passed**; email,
dispatch isolation and privacy-state controls **10 passed**; workspace typecheck
passed. The API total includes the **11 budget controls**, not 11 extra cases.
All 19 journalled migrations passed on the isolated local cluster.

Actual metadata import: 11 publication attempts, 15 editorial runs and 74
customer-draft rows scanned; **57 potential-charge records**, **20 unresolved
unbounded records**, provisional reported-token estimate **$0.061027725**.
These are not 57 verified paid calls or a certified bill. A second import added
zero records and recognised all 57 existing entries; reconciliation remains
false. Unknown liabilities prevent claiming an available balance.

The first refund test run exposed a harness assumption that previous cases had
already exhausted the current database-clock minute. The negative test now
explicitly exhausts only its synthetic actor's current/next windows and proves
429 without losing history. The final 17-case run passed; no payment was sent.
The standard development migrator failure and the separate reviewed additive
delta are retained above, not counted as adoption/production proof.

These checks do **not** replace source-backed 80 / customer-AI 60 / editorial 60
acceptance. No eligible content, released rules, real merchant execution, email
delivery, production restore, independent security/beta sign-off or R1/R2
acceptance was created by this checkpoint.
