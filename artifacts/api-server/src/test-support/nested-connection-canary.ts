// Deliberately takes a second pooled connection inside a transaction of each kind the guard
// watches, so nested-connection-report.mjs can prove the CI check still sees both.
import { sql } from "drizzle-orm";
import { db, pool } from "@workspace/db";

await db.transaction(async () => {
  await db.execute(sql`select 1`);
});
// The same, inside a transaction opened with BEGIN on a connection taken from the pool.
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await db.execute(sql`select 1`);
  await client.query("ROLLBACK");
} finally {
  client.release();
}
await pool.end();
