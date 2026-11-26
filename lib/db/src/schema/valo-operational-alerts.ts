import { sql } from "drizzle-orm";
import { pgTable, text, integer, timestamp, uuid, index, check } from "drizzle-orm/pg-core";

/**
 * SEC-008, NFR-010 (docs/architecture/alerts.md, part 1): each alert the worker raised or cleared, as
 * its own journal on the worker's disk recorded it, so staff can read them. The worker copies each change
 * here by the change's own id once the database can take it; a row is never changed or removed. It holds
 * no request content, address or identity, and no workspace rows: the workspace scope has no access to it.
 */
export const valoOperationalAlerts = pgTable(
  "valo_operational_alerts",
  {
    id: uuid("id").primaryKey(),
    code: text("code").notNull(),
    state: text("state").notNull(),
    raisedAt: timestamp("raised_at", { withTimezone: true }).notNull(),
    reading: integer("reading"),
    threshold: integer("threshold"),
    runbook: text("runbook"),
    accountable: text("accountable"),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("valo_operational_alerts_raised_idx").on(t.raisedAt),
    index("valo_operational_alerts_code_idx").on(t.code, t.raisedAt),
    check("valo_operational_alerts_code_check", sql`${t.code} ~ '^[A-Z][A-Z_]{2,80}$'`),
    check("valo_operational_alerts_state_check", sql`${t.state} IN ('active', 'resolved')`),
    check(
      "valo_operational_alerts_reading_check",
      sql`(${t.reading} IS NULL OR ${t.reading} >= 0) AND (${t.threshold} IS NULL OR ${t.threshold} >= 0)`,
    ),
  ],
);
export type ValoOperationalAlert = typeof valoOperationalAlerts.$inferSelect;
