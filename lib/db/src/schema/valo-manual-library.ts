import { sql } from "drizzle-orm";
import {
  check,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const bytes = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

export type ManualRegulatorySource = {
  url: string;
  title: string;
  locator: string;
  rawSha256: string;
  validThrough: string;
  retrievedAt: string;
  retrieval: "official_url" | "retained_official_pdf";
};

/** Each source check records its own result, including unsuccessful checks. */
export const valoManualRegulatoryChecks = pgTable(
  "valo_manual_regulatory_checks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    candidateId: text("candidate_id").notNull(),
    title: text("title").notNull(),
    bodySha256: text("body_sha256").notNull(),
    evidenceSha256: text("evidence_sha256").notNull(),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull(),
    sources: jsonb("sources").$type<ManualRegulatorySource[]>().notNull(),
    holds: text("holds").array().notNull(),
  },
  (t) => [
    index("valo_manual_regulatory_checked").on(t.candidateId, t.checkedAt, t.id),
    check(
      "valo_manual_regulatory_candidate",
      sql`${t.candidateId} ~ '^GUD-(0[1-9]|[12][0-9]|30)$' AND length(${t.title}) BETWEEN 1 AND 140`,
    ),
    check(
      "valo_manual_regulatory_hashes",
      sql`${t.bodySha256} ~ '^[a-f0-9]{64}$' AND ${t.evidenceSha256} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      "valo_manual_regulatory_references",
      sql`jsonb_typeof(${t.sources}) = 'array' AND (cardinality(${t.holds}) > 0 OR jsonb_array_length(${t.sources}) > 0)`,
    ),
  ],
);

/** A private editorial revision. Its immutable text and attachment are the exact staff preview. */
export const valoManualLibrary = pgTable(
  "valo_manual_library",
  {
    id: uuid("id").primaryKey(),
    itemId: uuid("item_id").notNull(),
    version: integer("version").notNull(),
    slug: text("slug").notNull(),
    kind: text("kind", {
      enum: [
        "practical_guide",
        "industry_introduction",
        "industry_pack",
        "template",
        "premium_template",
        "regulatory_article",
      ],
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
    regulatoryCheckId: uuid("regulatory_check_id"),
    /**
     * A template's wording with its placeholders named, for the fill-in forms (forms v2,
     * docs/architecture/forms-v2.md). Released with the rest of the revision and unchanged afterwards.
     * Only staff routes read it; customers reach it only through the forms (DOC-004).
     */
    formText: text("form_text"),
  },
  (t) => [
    foreignKey({
      name: "valo_manual_regulatory_check_fk",
      columns: [t.regulatoryCheckId],
      foreignColumns: [valoManualRegulatoryChecks.id],
    }),
    uniqueIndex("valo_manual_item_version").on(t.itemId, t.version),
    uniqueIndex("valo_manual_one_release")
      .on(t.itemId)
      .where(sql`${t.state} = 'published'`),
    uniqueIndex("valo_manual_one_intro")
      .on(t.industry)
      .where(sql`${t.state} = 'published' AND ${t.kind} = 'industry_introduction'`),
    uniqueIndex("valo_manual_one_pack")
      .on(t.industry)
      .where(sql`${t.state} = 'published' AND ${t.kind} = 'industry_pack'`),
    index("valo_manual_state_slug").on(t.state, t.slug),
    check(
      "valo_manual_kind",
      sql`${t.kind} IN ('practical_guide','industry_introduction','industry_pack','template','premium_template','regulatory_article')`,
    ),
    check(
      "valo_manual_state",
      sql`${t.state} IN ('draft','published','replaced','withdrawn') AND ((${t.kind} = 'regulatory_article' AND ${t.state} <> 'draft') = (${t.regulatoryCheckId} IS NOT NULL))`,
    ),
    check(
      "valo_manual_identity",
      sql`${t.version} > 0 AND ${t.digest} ~ '^[0-9a-f]{64}$' AND ${t.slug} = 'manual-' || ${t.itemId}::text`,
    ),
    check(
      "valo_manual_text",
      sql`length(${t.title}) BETWEEN 1 AND 140 AND length(${t.body}) BETWEEN 1 AND 60000 AND (${t.kind} NOT IN ('industry_introduction','industry_pack') OR ${t.industry} IS NOT NULL)`,
    ),
    check(
      "valo_manual_file",
      sql`(${t.fileBytes} IS NULL AND ${t.fileFormat} IS NULL AND ${t.kind} NOT IN ('template','premium_template')) OR (${t.fileBytes} IS NOT NULL AND ${t.kind} IN ('template','premium_template') AND ${t.fileFormat} IS NOT NULL AND ${t.fileFormat} IN ('pdf','docx') AND octet_length(${t.fileBytes}) BETWEEN 1 AND 2097152)`,
    ),
    check("valo_manual_premium_preview", sql`${t.kind} <> 'premium_template' OR length(${t.body}) <= 600`),
    check(
      "valo_manual_form_text",
      sql`${t.formText} IS NULL OR (${t.kind} IN ('template','premium_template') AND length(${t.formText}) BETWEEN 1 AND 60000)`,
    ),
    check(
      "valo_manual_actors",
      sql`(${t.state} = 'draft') = (${t.publishedBy} IS NULL) AND (${t.publishedBy} IS NULL) = (${t.publishedAt} IS NULL) AND (${t.state} IN ('replaced','withdrawn')) = (${t.closedBy} IS NOT NULL) AND (${t.closedBy} IS NULL) = (${t.closedAt} IS NULL)`,
    ),
  ],
);
