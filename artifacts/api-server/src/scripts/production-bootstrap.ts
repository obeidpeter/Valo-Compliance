import { Client } from "pg";
import { assignEmptyRehearsalDatabase, prepareEmptyRehearsalQueue } from "../lib/valo-production-bootstrap";
import { readFile } from "node:fs/promises";
import { rehearsalConfiguration, verifyRehearsalDatabase } from "../lib/valo-runtime-activation";
let client: Client | undefined;
try {
  if (process.argv.slice(2).join(" ") !== "--assign-empty-rehearsal")
    throw Error("EXPLICIT_EMPTY_DATABASE_BOOTSTRAP_REQUIRED");
  rehearsalConfiguration(process.env);
  client = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 5000,
    query_timeout: 10000,
  });
  await client.connect();
  await client.query("BEGIN");
  await client.query("SET LOCAL lock_timeout='5s'");
  const construction = await readFile(
    new URL("../../../lib/db/drizzle/pg-boss-development.sql", import.meta.url),
    "utf8",
  );
  await prepareEmptyRehearsalQueue((sql, values) => client!.query(sql, values), process.env, construction);
  const result = await assignEmptyRehearsalDatabase((sql, values) => client!.query(sql, values), process.env);
  await verifyRehearsalDatabase((sql) => client!.query(sql), process.env);
  await client.query("COMMIT");
  console.log(JSON.stringify(result));
} catch {
  await client?.query("ROLLBACK").catch(() => {});
  console.error("EMPTY_REHEARSAL_BOOTSTRAP_FAILED");
  process.exitCode = 1;
} finally {
  await client?.end();
}
