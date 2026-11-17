import { PgBoss } from "pg-boss";
import { assertApplicationRuntime } from "./valo-runtime-activation";
import { setting } from "../platform/settings";
export const EXPORT_QUEUE = "valo-manual-export-v1";
export function exportQueue() {
  assertApplicationRuntime();
  const connectionString = setting("DATABASE_URL");
  return new PgBoss({
    ...(connectionString !== undefined ? { connectionString } : {}),
    schema: "valo_jobs",
    migrate: false,
    createSchema: false,
    schedule: false,
    max: 3,
  });
}
