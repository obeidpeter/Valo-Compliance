import { sql } from "drizzle-orm";
import {
  check,
  customType,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const bytes = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

/** A private editorial revision. Its immutable text and attachment are the exact staff preview. */
export const valoManualLibrary = pgTable(
  "valo_manual_library",
  {
    id: uuid("id").primaryKey(),
    itemId: uuid("item_id").notNull(),
    version: integer("version").notNull(),
    slug: text("slug").notNull(),
    kind: text("kind", {
      enum: ["practical_guide", "industry_introduction", "template", "regulatory_article"],
    }).notNull(),
    industry: text("industry"),
    title: text("title").notNull(),
    body: text("body").notNull(),
    digest: text("digest").notNull(),
    fileFormat: text("file_format", { enum: ["pdf", "docx"] }),
    fileBytes: bytes("file_bytes"),
    state: text("state", { enum: ["draft", "published", "replaced", "withdrawn"] })
      .notNull()
      .default("draft"),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    publishedBy: text("published_by"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    closedBy: text("closed_by"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("valo_manual_item_version").on(t.itemId, t.version),
    uniqueIndex("valo_manual_one_release")
      .on(t.itemId)
      .where(sql`${t.state} = 'published'`),
    uniqueIndex("valo_manual_one_intro")
      .on(t.industry)
      .where(sql`${t.state} = 'published' AND ${t.kind} = 'industry_introduction'`),
    index("valo_manual_state_slug").on(t.state, t.slug),
    check(
      "valo_manual_kind",
      sql`${t.kind} IN ('practical_guide','industry_introduction','template','regulatory_article')`,
    ),
    check(
      "valo_manual_state",
      sql`${t.state} IN ('draft','published','replaced','withdrawn') AND (${t.kind} <> 'regulatory_article' OR ${t.state} = 'draft')`,
    ),
    check(
      "valo_manual_identity",
      sql`${t.version} > 0 AND ${t.digest} ~ '^[0-9a-f]{64}$' AND ${t.slug} = 'manual-' || ${t.itemId}::text`,
    ),
    check(
      "valo_manual_text",
      sql`length(${t.title}) BETWEEN 1 AND 140 AND length(${t.body}) BETWEEN 1 AND 60000 AND (${t.kind} <> 'industry_introduction' OR ${t.industry} IS NOT NULL)`,
    ),
    check(
      "valo_manual_file",
      sql`(${t.fileBytes} IS NULL AND ${t.fileFormat} IS NULL AND ${t.kind} <> 'template') OR (${t.fileBytes} IS NOT NULL AND ${t.kind} = 'template' AND ${t.fileFormat} IS NOT NULL AND ${t.fileFormat} IN ('pdf','docx') AND octet_length(${t.fileBytes}) BETWEEN 1 AND 2097152)`,
    ),
    check(
      "valo_manual_actors",
      sql`(${t.state} = 'draft') = (${t.publishedBy} IS NULL) AND (${t.publishedBy} IS NULL) = (${t.publishedAt} IS NULL) AND (${t.state} IN ('replaced','withdrawn')) = (${t.closedBy} IS NOT NULL) AND (${t.closedBy} IS NULL) = (${t.closedAt} IS NULL)`,
    ),
  ],
);
