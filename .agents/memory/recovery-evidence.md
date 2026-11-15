---
name: Recovery evidence
description: Historical recovery causes require per-record attempt evidence, not aggregate inference.
---

Never infer original failure causes from later zero-missing counts or successful
repairs. Keep lost original errors explicitly unknown, even when a later defect
is a plausible explanation.

**Why:** The user required correction of an unsupported causal claim based on
aggregate-only receipt recovery reports.

**How to apply:** Retain scoped cohorts, pre-dispatch intents, safe errors and
before/after per-record provenance. Distinguish corroborating audit windows from
original attempt receipts; do not invent missing history.
