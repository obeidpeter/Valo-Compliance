import { Client } from "pg";
import { inspectExportRetention, proposeExportRetention } from "../lib/valo-export-retention-inventory";
let client: Client | undefined;
try {
  const [mode, databaseId, ...args] = process.argv.slice(2);
  if (
    process.env.VALO_RETENTION_INSPECTION !== "read-only" ||
    !databaseId ||
    !((mode === "inventory" && args.length === 0) || (mode === "plan" && args.length === 3)) ||
    !["development", "production"].includes(process.env.NODE_ENV ?? "")
  )
    throw Error("RETENTION_INSPECTION_USAGE_REQUIRED");
  if (
    process.env.NODE_ENV === "development" &&
    Object.entries(process.env).some(([key, value]) => key.startsWith("REPLIT_DEPLOYMENT") && value)
  )
    throw Error("RETENTION_INSPECTION_CONTEXT_INVALID");
  if (!process.env.DATABASE_URL) throw Error("RETENTION_DATABASE_REQUIRED");
  client = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 5000,
    query_timeout: 15000,
  });
  await client.connect();
  const inventory = await inspectExportRetention(client, {
    databaseId,
    environment: process.env.NODE_ENV === "development" ? "development" : "production-rehearsal",
  });
  const proposal =
    mode === "plan"
      ? proposeExportRetention(inventory, {
          effectiveAt: args[0]!,
          retentionDays: Number(args[1]),
          graceDays: Number(args[2]),
        })
      : undefined;
  console.log(JSON.stringify({ inventory, proposal }, null, 2));
  process.exitCode = inventory.retentionCoverageComplete ? 0 : 2;
} catch (error) {
  const message = error instanceof Error ? error.message : "";
  const allowed = [
    "RETENTION_TARGET_REQUIRED",
    "RETENTION_DATABASE_IDENTITY_MISMATCH",
    "RETENTION_INVENTORY_LIMIT_EXCEEDED",
    "RETENTION_PROPOSAL_OPTIONS_INVALID",
    "RETENTION_INSPECTION_USAGE_REQUIRED",
    "RETENTION_INSPECTION_CONTEXT_INVALID",
    "RETENTION_DATABASE_REQUIRED",
  ];
  console.error(allowed.includes(message) ? message : "RETENTION_INSPECTION_FAILED");
  process.exitCode = 1;
} finally {
  await client?.end();
}
