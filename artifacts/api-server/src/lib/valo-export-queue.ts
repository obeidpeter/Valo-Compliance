import { PgBoss } from "pg-boss";
import {assertDevelopmentRuntime} from "./valo-development-runtime";
export const EXPORT_QUEUE = "valo-manual-export-v1";
export function exportQueue() {
  assertDevelopmentRuntime();
  return new PgBoss({
    connectionString: process.env.DATABASE_URL, schema:"valo_jobs",
    migrate:false, createSchema:false, schedule:false, max:3,
  });
}
