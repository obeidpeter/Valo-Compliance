import { getConstructionPlans } from "pg-boss";
import { readFile, writeFile } from "node:fs/promises";
import { pool } from "@workspace/db";
import { exportQueue, EXPORT_QUEUE } from "../lib/valo-export-queue";
import {WORKSPACE_EXPORT_QUEUE} from "../lib/valo-workspace-exports";
const sqlPath = new URL("../../../../lib/db/drizzle/pg-boss-development.sql", import.meta.url);
try {
  if (process.argv[2] === "generate") {
    await writeFile(sqlPath, getConstructionPlans("valo_jobs"));
    console.log("Generated pinned pg-boss development construction SQL; review before applying.");
  } else {
    if (process.argv[2] !== "apply-development" || process.env.NODE_ENV === "production" ||
      process.env.VALO_DEV_QUEUE_MIGRATION !== "reviewed-synthetic-development")
      throw new Error("DEVELOPMENT_MIGRATION_GUARD");
    const result = await pool.query("select to_regclass('valo_jobs.version') as installed");
    if (!result.rows[0].installed) await pool.query(await readFile(sqlPath, "utf8"));
    const boss = exportQueue();
    boss.on("error", () => console.error("QUEUE_DATABASE_ERROR"));
    await boss.start();
    await boss.createQueue(EXPORT_QUEUE, { retryLimit:2, retryDelay:5, expireInSeconds:120 });
    await boss.createQueue(WORKSPACE_EXPORT_QUEUE, { retryLimit:0, expireInSeconds:360 });
    await boss.stop();
    console.log("Development queue schema and bounded export queue installed; no production migration performed.");
  }
} catch (error) {
  console.error("Queue setup failed:", (error as {code?:string}).code || (error as Error).name);
  process.exitCode = 1;
} finally { await pool.end(); }
