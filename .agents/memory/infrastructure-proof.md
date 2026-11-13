---
name: Infrastructure proof pitfalls
description: Non-obvious SDK, peer-dependency and migration behaviours observed during the Valo foundation spike.
---

Use the official native Replit App Storage SDK behind the private-file adapter for
generated documents. Do not invent a GCP project ID or replace private storage with
local disk to make a probe pass.

**Why:** The generic Google client with the prescribed empty-project configuration
failed real writes during project-ID autodetection despite managed storage setup.
The native SDK passed actual private writes, reads, anonymous-denial and deletion.

**How to apply:** Keep the same storage service and authorisation boundary.
SDK changes need new round-trip/isolation evidence; development success does not
approve deployed worker credentials, retention or processor geography.

Keep optional peer dependencies consistent across packages that exchange Drizzle
types.

**Why:** Adding pg-boss's OpenTelemetry peer in only the API package made pnpm
instantiate two otherwise identical Drizzle packages. Their private class members
caused extensive incompatible-column type errors.

**How to apply:** Align the relevant peer context in API/database consumers rather
than casting away ORM types or duplicating schema definitions.

Do not trust a schema-push process exit code as migration evidence.

**Why:** A real development push logged a foreign-key failure yet exited zero.
Referenced composite unique indexes must precede their foreign keys; generated
ordering did not do this.

**How to apply:** Review SQL order, inspect output and execute negative constraint
tests. Never add production startup/deploy DDL to compensate.
