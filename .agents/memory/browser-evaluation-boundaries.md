---
name: Browser evaluation boundaries
description: Keep browser callback semantics intact when browser tests compile in a Node-only TypeScript project.
---

Keep locator DOM reads in real Playwright callback functions. When the harness
compiles without global DOM declarations, scope browser APIs through the
element's `ownerDocument.defaultView` instead of changing a callback into a string
containing an arrow function.

**Why:** In this runtime, the arrow-function string was evaluated as a function
value rather than invoked as a locator callback. Its result failed validation
even though the actual page's focus state was correct.

**How to apply:** Type-check the harness and validate returned browser values
separately. Retain and label harness failures; do not describe them as product
failures or change the product to satisfy a broken observation.

Cross-tab tests need pages created from one explicitly shared browser context.
The browser-level single-page convenience creates an isolated, owned context;
separate contexts do not share same-origin session communication.

**Why:** A session-end broadcast regression initially tested isolated storage
partitions instead of two tabs of the same browser session.

**How to apply:** Establish a shared context before creating peers and prove the
native cross-tab transport, while labelling controlled identity separately from
a real managed-provider session test.
