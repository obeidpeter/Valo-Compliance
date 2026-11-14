---
name: AI evaluation cost evidence
description: Why genuine provider usage must survive cleanup of synthetic evaluation fixtures.
---

Synthetic inputs do not make a real provider request free or simulated. Preserve
its usage evidence and quota consumption when cleaning evaluation fixtures.
Keep real-provider cases distinct from preflight refusals and injected faults.

**Why:** Removing synthetic request records can erase the consumption history
used by daily limits, increase available allowance incorrectly, and destroy the
evidence distinguishing actual calls from transport simulations.

**How to apply:** Clean only owned negative fixtures with no outbound attempt,
or preserve the necessary aggregate usage/audit evidence first. Check the
current quota implementation before cleanup. Do not use this rule to retain
private prompt bodies beyond an approved privacy/retention policy.

When only a downstream renderer or evaluation harness fails, reuse the exact
hash-bound provider result where safe instead of paying to regenerate unchanged
inputs. Reject changed corpus, prompt/notice or provider payloads and distinguish
new outbound attempts from retained attempts in the rerun evidence.

**Why:** A real provider completion can be valid even when later file inspection
fails; rerunning the entire pipeline otherwise adds cost and obscures provenance.

An authored complete-generation case stopped by a missing-fact preflight remains
partial. Keep the original oracle and record any synthetic follow-up separately.
Fault/quota/kill-switch evidence must reach that specific boundary, not fail
earlier on unrelated missing data. Use the existing evaluation identity and limits.

**Why:** The user repeatedly required these distinctions; safe preflight behavior
must not be miscounted as completed generation or the intended failure test.

The $30 all-lane managed-inference ceiling is a **disabled proposal**, not
permission to spend or increase daily/identity limits. Reconcile prior pilot
usage and unknown charges and actual price/region bounds before activation.
Exact full-request tokenization is required only for the smaller reservation:
the user supplied the verified 400,000-token model context as a conservative
fallback input reservation, plus 8,192 output tokens, at $0.3705504 including
10% uplift. This fallback is not authorization. A byte estimate plus protocol
allowance is not tokenization proof. Synthetic enabled fixtures are not approval.

If necessary full-request context exceeds its proposed bound, hold the case and
revise the estimate before authorisation; never truncate needed evidence,
instructions or schema to manufacture a passing bound.

**Why:** The user explicitly authorised budget preparation only, while retaining
the existing limits and prohibiting new identities or alternate-lane evasion.

Do not impose a 60/day or four-day minimum schedule on the proposed finite
batch. Those were coordinating-team proposals, not user/provider requirements.
Use the manifest, monetary ceiling, concurrency two and actual provider limits;
leave existing daily/identity caps unchanged until separately authorized.

**Why:** The user explicitly corrected the proposed schedule and authorized
preparation, not spending or quota increases.

**How to apply:** Reserve independent-review pairs atomically, retain unknown
charges, and require a fresh reservation for every additional attempt. An
incomplete batch may stop safely without spending beyond its allocation.
