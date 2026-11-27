---
name: Migration registration and adoption
description: Clean CI and an existing development database need distinct, measured migration evidence.
---

Do not treat manually applied development SQL as proof that clean installations
or the migration runner execute the same changes. Register reviewed SQL in the
Drizzle journal, retain corresponding schema snapshots and exercise an empty
synthetic database. Do not fabricate an existing database's migration ledger.

**Why:** Development tests passed against manually applied changes while clean CI
skipped unregistered SQL. The existing database had no Drizzle ledger to adopt.

**How to apply:** Check actual migration state first. Before existing-database
adoption, compare schema, functions, constraints and grants to reviewed SQL.
Publishing limitations for database objects remain a separate production gate.

For isolated Drizzle snapshot generation, use an output path relative to the
package working directory, even if the output is outside the workspace.

**Why:** This environment's Drizzle generator prefixes its output with `./` when
reading existing snapshots; an absolute `/tmp` output became `.//tmp` and failed.

**How to apply:** Generate a proposed schema diff in temporary output, inspect
the result, and preserve applied SQL instead of silently regenerating it.
