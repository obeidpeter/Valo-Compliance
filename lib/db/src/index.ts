import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Signed privacy projections include PostgreSQL JSON timestamps. Pin every app
// session to UTC so restores on hosts with another timezone verify identically.
export const pool = new Pool({ connectionString: process.env.DATABASE_URL, options: "-c timezone=UTC" });
export const db = drizzle(pool, { schema });
export { schema };

export * from "./schema";
