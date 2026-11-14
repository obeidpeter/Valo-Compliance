# External completion decisions

Current private-development decision packet, reviewed against commit `ab793f2e2495903aefff1271c89a1c30a39b028b` on 14 November 2026. This replaces the obsolete schedule and token estimates in earlier revisions; those revisions remain in Git history. Engineering and release acceptance are separate. No approval, spend, production deployment or external communication is recorded by this document.

## Finite additional inference proposal

Proposed authorization: **up to US$30 of additional application inference before tax, for 24 hours from approval**, shared across the immutable package below. It excludes historical charges, Replit Agent development, hosting, subscriptions, other projects and unrelated calls. It is not a total project budget or a promise that every item will finish for $30.

Package: `finite-package:46a5933fd296adb648dae1becaaabd835d5b203ce5a5d470887ec74cb27bba37`.

[The disabled package](../valo/evidence/finite-allocation-package-disabled.json) binds 108 actual content units and the original 60 editorial, 80 checker and 60 customer-AI evaluation cases to repository source hashes. Its maximum attempt counts are:

| Lane | Attempt ceiling |
| --- | ---: |
| Publication factual/challenge reviews | 216 |
| Editorial evaluation roles | 68 |
| Checker expected-result challenges | 80 |
| Customer-AI attempts, including explicit retries | 94 |

These are scope ceilings, not a reservation of every slot, a forecast of necessary calls or evidence that every preparer is implemented. Deterministic negative cases and valid unchanged evidence need no new billable call.

**Current executable coverage at the reviewed commit:** the original TPL-07 publication pair only. Its maximum reservation is **$0.7411008**. The repository proposal does not establish that a current native Replit plan has been prepared, or that the underlying candidate passes all source, rights and export gates. The remaining preparers and full corpus execution remain engineering work.

The implemented policy reserves **$0.3705504 per attempt**, based on the named model's full 400,000-token input capacity plus 8,192 completion tokens and the retained 10% price uplift. This deliberately conservative reservation does not rely on a byte count being an exact token count. Actual valid returned usage settles the reservation. Pending or unknown outcomes keep their full reservation and occupy a concurrency slot. Invalid usage is not returned downstream; bounded unknown liability does not by itself suspend unrelated work if budget and another slot remain. An unexpected model or an unbounded/explicit suspension condition stops further admission. At the full reserved amount, 80 attempts fit into an otherwise unused $30 allocation; settling smaller actual usage can make more slots available. No completion count is guaranteed.

The shared durable ledger checks the parent approval, exact child scope, expiry, revocation and remaining allocation before every dispatch. Independent review roles reserve together after preflight. Concurrency is two. There are no automatic SDK retries or unlisted retry identities. One package approval can admit exact in-scope children without per-item financial approval. An approved package replaces the legacy publication daily scheduling throttle for that package; there is no invented 60/day or four-day minimum. It does not waive publication gates or authorize customer launch.

Historical liabilities remain recorded separately. The new proposal explicitly funds additional work; it neither resets historical usage nor certifies the account's remaining balance. The last retained import contained 57 potential-charge records and 20 unresolved/unbounded records, not 57 proven charged calls. Read-only reconciliation verifies actual retained artifact bytes and exact joins; missing or ambiguous receipts remain unresolved. Account-wide totals, available credits and tax remain unknown.

## Inputs needed for external proof

| Proof or decision | Minimum owner/provider input | Work that remains independent |
| --- | --- | --- |
| Actual Paystack test merchant round trip | A Valo-controlled test merchant configuration in the server secret store, its active signature mode, and configured reachable test callbacks/webhooks | Durable dispute workflow, actual transport verification, timeout/reconciliation and staff/customer journeys. Controlled transport tests do not prove a merchant settlement. |
| Actual email delivery | Verified Valo sender/domain, an owner-controlled verified test recipient, provider configuration and authorization for the specific bounded test | Outbox, retries, suppression, unsubscribe and controlled delivery tests. Clerk sign-in mail is a separate identity-provider proof. |
| Production recovery and retention | Selected providers/regions, isolated restore target, approved impact/cost boundary, accountable operator and a retention architecture meeting the specification | Native worker/storage tests, independent journal backup/import and recovery proof. Disposable local restore tests do not establish production RPO/RTO. |
| Production privacy | Actual processor agreements, regions/transfers, retention/deletion decisions and accountable owners | Engineering for erasure, legal holds, post-closure status and recovery. Synthetic tests do not authorize real customer deletion. |
| Future launch and real sales | Approved NGN prices, licence/refund policy, live merchant/identity/email setup and bounded real-transaction/launch authorization | R1 engineering and controlled acceptance; R2 follows the required R1 gates. |
| Additional inference | The concrete finite allocation above, followed by genuine executable plans and current evidence | Candidate/source preparation, deterministic evaluations, bug fixes and unfinished preparers continue without paid calls. |

The specification's 35-day retention requirement remains unresolved: retained Replit capability evidence describes at most 28 days on eligible plans. Do not silently reduce the requirement, assume this account has that plan, or buy an upgrade. A compatible retention design or explicit specification decision is still needed.

No secret value belongs in chat or repository documentation. Configuration should use the authorized server Secrets/integration flow. Additional inference approval is not approval for subscriptions, public launch, live payments, external messages, real-data erasure or main-branch release.

## Verification and remaining acceptance

The integrated checkpoint passed [all four CI jobs](https://github.com/obeidpeter/Valo-Compliance/actions/runs/43653607973), including typecheck, controlled API/browser tests, synthetic PostgreSQL isolation, isolated restore, build and security checks. This proves the executed engineering checks, not full R1/R2 acceptance.

The published eligible catalogue, original source-backed 80/60/60 suites, remaining commerce/privacy/export work, native and production verification, and gated R2 implementation remain incomplete. The checker corpus still retains eight source disagreements; engineering fixtures are not a replacement oracle. See the [finite completion checkpoint](../valo/finite-inference-completion-checkpoint.md) for implementation detail.
