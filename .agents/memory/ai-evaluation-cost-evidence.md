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
