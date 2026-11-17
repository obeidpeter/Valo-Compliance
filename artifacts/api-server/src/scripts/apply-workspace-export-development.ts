import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db, pool } from "@workspace/db";
import { assertDevelopmentRuntime } from "../lib/valo-development-runtime";
try {
  assertDevelopmentRuntime();
  if (process.env.VALO_APPLY_WORKSPACE_EXPORT_SCHEMA !== "reviewed-additive-development-only")
    throw Error("EXPLICIT_DEVELOPMENT_REVIEW_REQUIRED");
  const migration = process.argv.includes("--convergence")
    ? "0030_workspace_export_convergence"
    : process.argv.includes("--cleanup")
      ? "0028_workspace_export_cleanup"
      : "0027_workspace_exports";
  const text = await readFile(
    new URL(
      migration === "0030_workspace_export_convergence"
        ? "../../../../lib/db/drizzle/0030_workspace_export_convergence.sql"
        : migration === "0027_workspace_exports"
          ? "../../../../lib/db/drizzle/0027_workspace_exports.sql"
          : "../../../../lib/db/drizzle/0028_workspace_export_cleanup.sql",
      import.meta.url,
    ),
    "utf8",
  );
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(747115)`);
    await tx.execute(sql.raw(text));
  });
  console.log(
    JSON.stringify({
      migration,
      sha256: createHash("sha256").update(text).digest("hex"),
      developmentApplied: true,
      productionApplied: false,
      baselineAdopted: false,
    }),
  );
} finally {
  await pool.end();
}
