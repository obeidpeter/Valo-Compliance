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
