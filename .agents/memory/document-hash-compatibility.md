---
name: Saved document hash compatibility
description: JSONB reorders keys; historic revision hashes need a stable, version-aware reconstruction.
---

Preserve historic saved revision digests. Do not hash raw PostgreSQL JSONB
serialisation and assume it matches the original write-time JSON string.

**Why:** JSONB reordered object keys, causing the first real export integrity check
to reject unchanged saved content. Reconstructing the validated v1 input order
matched the existing digest without rewriting customer revisions.

**How to apply:** Freeze the legacy reconstruction when changing schemas. Any new
canonical hashing scheme needs an explicit version/backwards-compatible reader;
do not silently change hashes or export from a newer mutable revision.
