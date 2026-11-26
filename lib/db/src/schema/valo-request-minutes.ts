import { sql } from "drizzle-orm";
import { pgTable, integer, timestamp, check } from "drizzle-orm/pg-core";

/**
 * NFR-003, NFR-010 (docs/architecture/alerts.md, part 3): the API's requests counted by the minute they
 * began in: how many, how many failed unexpectedly, and how many took at most each of the fixed times.
 * Each process adds its own minute's counts once, so the counts of every process add up here. It holds
 * no address, identity or request content, and no workspace's rows: the workspace scope has no access
 * to it.
 */
export const valoRequestMinutes = pgTable(
  "valo_request_minutes",
  {
    minute: timestamp("minute", { withTimezone: true }).primaryKey(),
    requests: integer("requests").notNull(),
    failures: integer("failures").notNull(),
    // How many took at most each time; the rest took longer than ten seconds.
    within100ms: integer("within_100ms").notNull(),
    within250ms: integer("within_250ms").notNull(),
    within500ms: integer("within_500ms").notNull(),
    within1s: integer("within_1s").notNull(),
    within2500ms: integer("within_2500ms").notNull(),
    within5s: integer("within_5s").notNull(),
    within10s: integer("within_10s").notNull(),
  },
  (t) => [
    check("valo_request_minutes_minute_check", sql`${t.minute} = date_trunc('minute', ${t.minute})`),
    check(
      "valo_request_minutes_counts_check",
      sql`0 <= ${t.failures} AND ${t.failures} <= ${t.requests}
        AND 0 <= ${t.within100ms} AND ${t.within100ms} <= ${t.within250ms}
        AND ${t.within250ms} <= ${t.within500ms} AND ${t.within500ms} <= ${t.within1s}
        AND ${t.within1s} <= ${t.within2500ms} AND ${t.within2500ms} <= ${t.within5s}
        AND ${t.within5s} <= ${t.within10s} AND ${t.within10s} <= ${t.requests}`,
    ),
  ],
);
export type ValoRequestMinute = typeof valoRequestMinutes.$inferSelect;
