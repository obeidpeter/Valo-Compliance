---
name: Paystack dispute outcome boundaries
description: Why merchant responses and terminal-looking statuses do not establish a final bank outcome.
---
Do not infer a final merchant win, refund completion or access restoration merely
from `declined`, `merchant-accepted`, `resolved` or `archived`.

**Why:** The official dispute reference reviewed in November 2026 describes merchant
responses and includes archived/null examples, but does not supply a complete
final-bank-outcome mapping or mutation idempotency guarantee.

**How to apply:** Recheck current official evidence before adding such mappings.
Preserve uncertain mutation intent and reconcile canonical state without
automatically repeating a potentially accepted financial mutation.
