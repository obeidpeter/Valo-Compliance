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

Do not infer AI inference compatibility from an advertised model list, an HTTP
health response or rejection of an intentionally invalid request.

**Why:** The same managed gateway returned input-validation responses but failed
actual structured generation for one configuration; another supported
configuration completed real drafting and separate reviews.

**How to apply:** Keep task-level model/configuration evidence, including failed
and dependency-held runs. A successful alternative does not establish why the
original failed, and model completion does not clear content publication gates.

Do not trust a schema-push process exit code as migration evidence.

**Why:** A real development push logged a foreign-key failure yet exited zero.
Referenced composite unique indexes must precede their foreign keys; generated
ordering did not do this.

**How to apply:** Review SQL order, inspect output and execute negative constraint
tests. Never add production startup/deploy DDL to compensate.

Failed schema pushes can leave earlier objects applied before reporting an
existing-index error, still with a zero process exit code.

**Why:** A later development push created the requested table and index before
failing on an existing composite index. Blindly replaying the whole operation
would misrepresent both its success and its starting state.

**How to apply:** Inspect the live catalog and test the intended objects before
retrying. Report partial application separately from clean migration acceptance.

Automatic task merges are not schema-review approval.

**Why:** A documentation-only merge invoked a guarded schema push without a
reviewed migration acknowledgement. Injecting acknowledgements into the merge
hook would falsely turn task approval into database-change approval.

**How to apply:** Keep dependency/type validation separate from explicit,
reviewed SQL application and database postconditions. Hook success is not
schema acceptance; never weaken the schema guard to make a merge succeed.
