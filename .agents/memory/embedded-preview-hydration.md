---
name: Embedded preview hydration
description: Why startup verification must include the actual proxied app inside an iframe.
---

Verify startup in both standalone and embedded development previews.

**Why:** Standalone Valo checks passed while the embedded preview repeatedly failed hydration. The development proxy injected a devtools script into the document head in the iframe, conflicting with hydration of an unmanaged external stylesheet. Only the embedded reproduction exposed the full, actionable React difference.

**How to apply:** Load the app through its actual development domain inside an iframe and capture full page errors, not just truncated console summaries. Keep framework-managed stylesheet resource handling. Do not suppress hydration errors or remove preview instrumentation to manufacture a passing check.
