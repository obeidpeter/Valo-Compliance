import { PgBoss } from "pg-boss";
import { assertApplicationRuntime } from "../../lib/valo-runtime-activation";
import { setting } from "../../platform/settings";
export const EXPORT_QUEUE = "valo-manual-export-v1";
/** `schedules` runs pg-boss's schedule timekeeper; only the development worker asks for it. */
export function exportQueue(options: { schedules?: boolean } = {}) {
  assertApplicationRuntime();
  const connectionString = setting("DATABASE_URL");
  return new PgBoss({
    ...(connectionString !== undefined ? { connectionString } : {}),
    schema: "valo_jobs",
    migrate: false,
    createSchema: false,
    schedule: options.schedules === true,
    max: 3,
  });
}
