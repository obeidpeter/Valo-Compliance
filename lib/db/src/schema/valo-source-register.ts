import { check, date, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * The source register (docs/architecture/source-register.md, slice 1, ADM-003): each official source as
 * staff keep it, its authority, jurisdiction, instrument, the version in force and the day it took
 * effect. An entry is a series of versions: a correction, a retirement or a return is a new version
 * with why, by an active Content editor, and no version is ever changed or removed. Its address stays
 * the one Valo may fetch, from the leads in code.
 */
export const valoSourceRegister = pgTable(
  "valo_source_register",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: text("source_id").notNull(),
    version: integer("version").notNull(),
    title: text("title").notNull(),
    url: text("url").notNull(),
    /** The body that issues the text, as staff record it. Empty until it is known. */
    authority: text("authority"),
    /** Nigeria, or one of the states the requirements check lists. */
    jurisdiction: text("jurisdiction").notNull(),
    /** An Act, a regulator's document, or an official page; empty until it is known. */
    instrument: text("instrument", { enum: ["act", "regulatory_document", "official_page"] }),
    /** The edition in force, as the text names it. */
    versionInForce: text("version_in_force"),
    /** The day the version in force took effect. An official page has none. */
    effectiveFrom: date("effective_from"),
    status: text("status", { enum: ["active", "retired"] }).notNull(),
    /** Why this version was recorded. */
    reason: text("reason").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("valo_source_register_version").on(t.sourceId, t.version),
    check(
      "valo_source_register_fields",
      sql`${t.version} >= 1 AND length(${t.sourceId}) BETWEEN 1 AND 100 AND length(${t.title}) BETWEEN 1 AND 300 AND ${t.url} ~ '^https://' AND length(${t.jurisdiction}) BETWEEN 1 AND 60 AND (${t.authority} IS NULL OR length(${t.authority}) BETWEEN 1 AND 200) AND (${t.instrument} IS NULL OR ${t.instrument} IN ('act','regulatory_document','official_page')) AND (${t.versionInForce} IS NULL OR length(${t.versionInForce}) BETWEEN 1 AND 200) AND (${t.instrument} IS DISTINCT FROM 'official_page' OR ${t.effectiveFrom} IS NULL) AND ${t.status} IN ('active','retired') AND length(${t.reason}) BETWEEN 20 AND 1000`,
    ),
  ],
);
