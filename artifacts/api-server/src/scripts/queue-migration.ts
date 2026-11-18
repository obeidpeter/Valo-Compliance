import { getConstructionPlans } from "pg-boss";
import { readFile, writeFile } from "node:fs/promises";
import { pool } from "@workspace/db";
import { exportQueue, EXPORT_QUEUE } from "../modules/exports";
import { WORKSPACE_EXPORT_QUEUE } from "../modules/privacy";
import { installOperationsQueue } from "../lib/valo-operations-queue";
import { assertDevelopmentRuntime } from "../platform/valo-development-runtime";
const sqlPath = new URL("../../../../lib/db/drizzle/pg-boss-development.sql", import.meta.url);
try {
  if (process.argv[2] === "generate") {
    await writeFile(sqlPath, getConstructionPlans("valo_jobs"));
    console.log("Generated pinned pg-boss development construction SQL; review before applying.");
  } else {
    assertDevelopmentRuntime();
    if (
      process.argv[2] !== "apply-development" ||
      process.env.NODE_ENV === "production" ||
      process.env.VALO_DEV_QUEUE_MIGRATION !== "reviewed-synthetic-development"
    )
      throw new Error("DEVELOPMENT_MIGRATION_GUARD");
    const result = await pool.query("select to_regclass('valo_jobs.version') as installed");
    if (!result.rows[0].installed) await pool.query(await readFile(sqlPath, "utf8"));
    const boss = exportQueue();
    boss.on("error", () => console.error("QUEUE_DATABASE_ERROR"));
    await boss.start();
    await boss.createQueue(EXPORT_QUEUE, { retryLimit: 2, retryDelay: 5, expireInSeconds: 120 });
    await boss.createQueue(WORKSPACE_EXPORT_QUEUE, { retryLimit: 0, expireInSeconds: 360 });
    await installOperationsQueue(boss);
    await boss.stop();
    console.log(
      "Development queue schema, bounded export queues and the scheduled operations queue installed; no production migration performed.",
    );
  }
} catch (error) {
  console.error("Queue setup failed:", (error as { code?: string }).code || (error as Error).name);
  process.exitCode = 1;
} finally {
  await pool.end();
}
