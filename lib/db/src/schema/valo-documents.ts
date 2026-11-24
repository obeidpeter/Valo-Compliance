import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  pgTable,
  uuid,
  integer,
  smallint,
  text,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { workspaceRowPolicy } from "./valo-workspace-scope";
import { createInsertSchema } from "drizzle-zod";
import { valoWorkspaces } from "./valo-workspaces";
import { valoContentVersions } from "./valo-publication";
import { valoManualLibrary } from "./valo-manual-library";
import { valoOrders } from "./valo-commerce";

export const valoDocuments = pgTable(
  "valo_documents",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => valoWorkspaces.id),
    templateVersionId: uuid("template_version_id").references(() => valoContentVersions.id),
    currentRevision: integer("current_revision").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * The form a document was started with (forms v2, docs/architecture/forms-v2.md): the form's
     * version, the staff-library edition whose form text its answers fill, and that text's SHA-256.
     * Written once, when the document starts from a released edition, and never changed (DOC-005).
     */
    formVersion: smallint("form_version"),
    formEdition: uuid("form_edition").references(() => valoManualLibrary.id),
    formDigest: text("form_digest"),
    /**
     * For a premium edition, the workspace's own verified order of that edition the document was
     * started under (forms v2, slice 6). Written with the form record and never changed (DOC-007).
     */
    formOrder: uuid("form_order"),
  },
  (t) => [
    index("valo_documents_workspace_idx").on(t.workspaceId),
    uniqueIndex("valo_document_workspace_unique").on(t.id, t.workspaceId),
    check(
      "valo_document_form",
      sql`(${t.formEdition} IS NULL) = (${t.formDigest} IS NULL) AND (${t.formEdition} IS NULL) = (${t.formVersion} IS NULL) AND (${t.formVersion} IS NULL OR ${t.formVersion} = 2) AND (${t.formDigest} IS NULL OR ${t.formDigest} ~ '^[0-9a-f]{64}$')`,
    ),
    foreignKey({
      name: "valo_document_form_order_tenant_fk",
      columns: [t.workspaceId, t.formOrder],
      foreignColumns: [valoOrders.workspaceId, valoOrders.id],
    }),
    check("valo_document_form_order", sql`${t.formOrder} IS NULL OR ${t.formEdition} IS NOT NULL`),
    workspaceRowPolicy(t.workspaceId),
  ],
);
export const insertValoDocumentSchema = createInsertSchema(valoDocuments);
export type ValoDocument = typeof valoDocuments.$inferSelect;
