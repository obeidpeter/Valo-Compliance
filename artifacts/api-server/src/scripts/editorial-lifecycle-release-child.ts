/** Isolated crash probe. Its IPC marker is test coordination, not an application acknowledgement. */
import { pool } from "@workspace/db";
import { publishOperationalVersion } from "../editorial/publication-publisher";
import { assertLifecycleRunDatabase } from "../editorial/editorial-lifecycle-sandbox";
try {
  assertLifecycleRunDatabase(
    process.env.DATABASE_URL,
    (await pool.query("select current_database() as name")).rows[0].name,
  );
  const result = await publishOperationalVersion(process.argv[2]!);
  process.send?.({ phase: "committed_before_application_acknowledgement", result });
  await new Promise(() => {});
} catch {
  process.send?.({ phase: "failed" });
  await pool.end();
  process.exitCode = 1;
}
