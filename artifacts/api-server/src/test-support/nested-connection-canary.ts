// Deliberately takes a second pooled connection inside a transaction, so
// nested-connection-report.mjs can prove the CI check still sees one.
import { sql } from "drizzle-orm";
import { db, pool } from "@workspace/db";

await db.transaction(async () => {
  await db.execute(sql`select 1`);
});
await pool.end();
