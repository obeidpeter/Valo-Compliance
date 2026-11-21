---
name: Managed identity browser tests
description: Avoid misdiagnosing Clerk development bot challenges as missing authentication setup.
---

Match supported browser test tooling to the FAPI actually used by the development
instance. Do not weaken provider protection or application authentication to make
an automated signup pass.

**Why:** A supported testing-token setup succeeded but signup still reached the
protect-check screen because the test assumed the production proxy while preview
used the provider's development API. Correctly scoped official tooling then
completed real signup, verification and private customer journeys without changing
provider permissions or security settings.

**How to apply:** Inspect safe request paths/provider UI state when signup stalls.
Prove the authenticated application journey independently of bot-token acquisition;
keep development test verification distinct from actual email delivery evidence.
