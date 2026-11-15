import { PgBoss } from "pg-boss";
import {assertApplicationRuntime} from "./valo-runtime-activation";
export const EXPORT_QUEUE = "valo-manual-export-v1";
export function exportQueue() {
  assertApplicationRuntime();
  return new PgBoss({
    connectionString: process.env.DATABASE_URL, schema:"valo_jobs",
    migrate:false, createSchema:false, schedule:false, max:3,
  });
}
