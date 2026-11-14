# External completion decisions — concrete packet

Prepared 14 November 2026 from private PR #2 head `3409a4f0e7e38b864b6b3f3240608761569ac462`, rechecked during this review. The Replit build in progress is not represented by that head. This is a decision proposal, not a budget change, provider call, credential request in chat, deployment or release approval. Existing authorization still applies; ask only for a genuinely unresolved choice after the associated implementation is ready.

## What the current AI limits actually mean

| Path | Implemented limit at this head | Consequence |
| --- | --- | --- |
| Operational publication reviews | **6 attempts per database calendar day**, complete factual/challenge pairs reserved atomically before calling; no retries | At most 3 candidate versions/day. The database timezone is not proved by the code. Failed/reserved attempts remain counted. |
| Original inventory authoring | Separate **1 attempt/database day** | Does not consume the six-review allowance. Already-authored original candidates do not need another paid authoring call merely to manufacture provenance. |
| Legacy CAMA development proof | Separate **9 reserved/attempted role runs per rolling 24 hours**, groups of 3 | Six is **not a global provider cap**. Do not route ordinary publication through this lane to bypass its cap. |
| Customer AI | **30 requests/workspace/day; 120 requests globally/day**, resetting at 00:00 UTC; 5/minute | A reserved request can make **two** provider attempts after invalid schema; these are request limits, not a 120-call or monetary limit. No automatic retry after provider outage. |

All inspected adapters request `gpt-5.4-mini`, with **8,192 maximum completion tokens**. Recorded responses identify `gpt-5.4-mini-2026-03-17`. Editorial timeout is 45 seconds, customer timeout 18 seconds, SDK retries zero. Editorial reviewers run independently, concurrency two. Input sizes vary; the 8,192 setting is not a total-token or cost cap. The generic CAMA path bounds selected passages to 12,000 characters, which is not a token meter for every publication path.

The client uses managed `AI_INTEGRATIONS_OPENAI_BASE_URL` and `AI_INTEGRATIONS_OPENAI_API_KEY`; names only are relevant here. Repository documentation says Replit credits are billed. No current credit balance, tariff, account plan, hard billing limit or attributable invoice was available. Customer run records explicitly have `cost:null`. **Additional monetary cost is unknown.** Public OpenAI list pricing would not establish this account's managed-gateway bill, so no price or currency ceiling is invented.

## Last retained usage, not live remaining allowance

| Retained execution | Actual calls / tokens | What it proves |
| --- | --- | --- |
| Operational checkpoint, completed 14 Nov 00:11 UTC | 6 reviews: **85,697 input + 2,674 output tokens**; also 1 authoring call whose token usage is not included in the checkpoint | Three candidate versions held; zero published. Most recent pair started about 00:00:44 UTC: **48,683 input + 804 output**. Six calls span timestamps either side of midnight, so this is not proof today's quota is exhausted. |
| Old 60-customer-case run, 13 Nov 22:30 UTC | 20 actual calls: **5,572 input + 1,014 output**; 28 preflight cases, 12 injected faults | Service-layer results; not 60 provider calls and not completion of the new corpus. |
| Supplied reminder slice, final run 14 Nov 04:19 UTC | 2 retained actual calls: **480 input + 56 output**; **zero new calls in the final rerun** | Four new-corpus cases passed; two provider cases and two intended preflight stops. Reused exact bound results after downstream export-test repair. |

These reports are partial evidence, not a ledger of every call or a current balance. Query the live reservation/usage aggregates without prompt bodies before scheduling. Preserve genuine usage when cleaning synthetic fixtures. Reuse a completion only when its exact candidate/input, sources, policy, prompt and freshness bindings remain valid.

## Workload and reviewable quota options

The prepared content inventory now has **40 templates + 30 regulatory guidance entries + 12 practical guides = 82 substantive items**. Their first final-version factual/challenge pairs require **164 review calls**. The **20 industry pages + 6 packs** also contain authored prose: plan **108 items / 216 calls** unless an item truly contains only unchanged already-reviewed components. New claims cannot evade review through bundling. These are first-pass minima, not a promise that all will pass.

Keep evaluations separate from that publication count:

- The new 60-case editorial corpus marks **34 scenarios `requiresProviderRun:true` and 26 false**. Thirty-four scenarios are not automatically 34 calls, or 68 calls: the implementation must enumerate each required role, permitted reuse and changed input. Do not spend on deterministic negative controls or count an injected success as an eligible release.
- The new 60-case customer corpus has four executed reminder cases, leaving **56 cases**. Six named fault scenarios can use injected responses; three explicit unsupported/quota/kill-switch scenarios must make no provider call. The remaining **47 unexecuted cases need per-case preflight classification**; if every one reaches the model, the current two-attempt policy gives an upper bound of **94 attempts**, not a forecast. Missing-input cases may correctly use zero. Genuine quality cases must exercise the real adapter.
- The 80 checker cases need independent source-backed expected-result challenge plus deterministic execution. No implemented challenge batching/call manifest is yet evidenced. Do not invent a call count or use model-generated expected answers as their own oracle.

| Decision option | Exact scope and consequence |
| --- | --- |
| Keep current review cap | No quota change. The first 216 reviews need **at least 36 database days**, assuming all slots available and no reruns. Independent development and deterministic evaluations continue immediately. |
| **Recommended first measurement: bounded pilot** | Once three final, mechanically ready representative candidates exist, use at most **6 reviews** within the existing cap, plus two new customer quality cases with at most **4 attempts**. Maximum **10 attempts**, no new authoring, no automatic rerun of a hold. Retain separate role usage and inspect attributable managed-provider billing. Proposed preflight input ceilings: **32,000 tokens/review; 4,096/customer attempt**, with the current 8,192 output ceiling. These proposed input meters are not yet implemented; enforce them before treating the pilot as token-bounded. Pilot maxima: **208,384 input + 81,920 output tokens**; actual cost still unknown. |
| Accelerate after measurement, if needed | Prepare a one-time batch manifest of **216 review reservations**, no more than **60/day** and concurrency two; expire the temporary allowance after that manifest. First-pass minimum becomes **4 days**. With a proposed 32,000-token input ceiling, maxima are **6,912,000 input + 1,769,472 output tokens**. Holds and failures consume the allowance; the batch does not authorize rework loops, unrelated generation, evaluation calls, production traffic, upgrades or publishing a failed candidate. The owner must choose any additional credit/currency ceiling using actual billing information; enforce it through a supported hard control or stop before it can be exceeded. |

Do not grant an accelerated allowance before ready inputs, a shared atomic attempt ledger, input metering and a concrete billing ceiling exist. A supported hard billing control is not established here; a usage alert alone must not be represented as a hard stop. If existing authorization already covers a pilot within current limits, execute within it rather than ask again. All remaining evaluation call plans should be generated offline before a later aggregate allowance is proposed.

## External inputs: needed for proof now versus launch later

| Proof / decision | Minimum concrete input | Work that continues without it |
| --- | --- | --- |
| Actual Paystack sandbox round trip | Owner-controlled **test** merchant configuration installed in the server secret store; observed active webhook-signature mode and its test signing secret; reachable configured test callback/webhook URLs. Ask only for configuration presence/mode, never secret values in chat. A public key is needed only if the chosen flow uses one. | Server-priced test orders, idempotent initialization, raw-byte signature adapter, durable inbox, verification, settlement/entitlements, receipts, refunds/disputes, reconciliation, test UI and deterministic transport tests. At this head no concrete Paystack environment-variable contract or merchant account is evidenced; read the new adapter before requesting exact variable names. |
| Actual reminder/receipt email delivery | Select an existing transactional provider, or choose one if none exists; authorized sender address/domain and DNS verification access; server credential; owner-controlled verified test recipient; supported idempotency and signed delivery/bounce-event configuration. The current reminder adapter is `null` and deliberately holds jobs. | Durable outbox, verified-owner address resolution, opt-in/offset/timezone handling, unsubscribe, duplicate suppression, bounce/retry state, local transport tests and in-account receipts. **Clerk sign-in/recovery email is a separate proof:** the configured identity instance and owner-controlled mailbox are needed; do not replace it with a synthetic verified identity. |
| Actual production recovery drill | Read actual project/deployment/database/worker/storage configuration, enabled retention and oldest recoverable point; choose a provider-supported **isolated target**, synthetic checkpoint/object set, named restore operator and approved impact/cost boundary. No live overwrite is implied. | Recovery preflight, tombstone/revocation replay, payment/email suppression, consistency/tenant checks, missing-export regeneration and wall-clock measurement harness. A production deployment or paid restore target is not established. |
| Retention architecture before production acceptance | The specification proposes **35-day rolling retention**. Retained official Replit docs describe 7-day default PITR and up to **28 days** on eligible plans, not proof of this account's plan. A plan upgrade alone therefore does not meet 35 days. Prepare either a supported additional-retention design with actual quote/controls, or an explicit specification-change proposal. | Do not silently reduce retention or substitute development rollback. Prove DB RPO ≤1h, core RTO ≤4h and regenerable-export RPO ≤24h in the selected architecture. |
| Future launch / real sales only | Accept concrete NGN prices, tax presentation, licence/refund policy and post-refund master-use/export treatment; actual merchant live readiness; bounded live purchase/refund authorization; production identity/email domains, processor/geography settings and real-data policies. | Use explicit test prices/policies now. None is a reason to pause Zod remediation, commerce code, source preparation, accessible UI, tenant controls or synthetic tests. Public launch and real charges are not implicitly approved by this packet. |

## Evidence locators

All code paths below are at the reviewed head. API paths start `artifacts/api-server/src/`:

- `editorial/operational-review.ts`, `editorial/operational-authoring.ts`, `editorial/pipeline.ts`, `lib/valo-customer-ai.ts`, `lib/valo-customer-ai-model.ts`; managed client: `lib/integrations-openai-ai-server/src/client.ts`.
- `docs/valo/evidence/operational-publication-checkpoint.json`, `customer-ai-60-evaluation.json`, `reminder-candidate-evaluation.json`; `docs/valo/editorial-provider-proof.md`; `.agents/memory/ai-evaluation-cost-evidence.md`.
- Local authored datasets: `analysis/customer-ai-evaluation-candidates.json`, `analysis/editorial-evaluation-candidates.json`, `analysis/checker-evaluation-candidates.json`. Inventory counts above are the prepared handoff inventory, not a claim of published items at this head.
- API `lib/valo-reminder-worker.ts`, `middlewares/valo-identity.ts`; `analysis/commerce-security-completion.md` contains the precise commerce/download/recovery acceptance cases and official Paystack references.
- Retained source `docs/valo/evidence/platform/data-recovery.md`, official [Replit data recovery](https://docs.replit.com/features/data-and-storage/data-recovery), and specification NFR-005. Source documentation describes capability, not account-specific configuration.
