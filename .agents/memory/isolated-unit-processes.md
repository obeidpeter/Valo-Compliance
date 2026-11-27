---
name: Isolated unit processes
description: Avoid false no-database test evidence from inherited Node test-runner context.
---

Clear inherited `NODE_TEST_CONTEXT` when launching an independent Node test
runner from an existing test. Require actual positive test counts, not just
exit status zero.

**Why:** An inherited child-runner context produced exit zero with empty output;
that is not evidence the credential-free unit files executed.

**How to apply:** Keep the child environment credential-free, set its working
directory explicitly and verify the intended suite and failure count in output.

An experimental flag accepted on Node's CLI may still be forbidden inside
`NODE_OPTIONS`. Check `process.allowedNodeEnvironmentFlags` before propagating
test-process instrumentation.

**Why:** In this environment, placing experimental module-mock enablement in
`NODE_OPTIONS` terminated worker children before their application code ran.

**How to apply:** Pass unsupported environment flags explicitly on the isolated
test child's CLI. Keep test storage opt-in, synthetic and independent of the
production worker configuration; capture bounded child startup errors.
