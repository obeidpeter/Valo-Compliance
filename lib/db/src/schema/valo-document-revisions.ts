import { pgTable, uuid, text, integer, jsonb, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { valoDocuments } from "./valo-documents";
import { valoWorkspaces } from "./valo-workspaces";

export const valoDocumentRevisions = pgTable("valo_document_revisions", {
  id: uuid("id").primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => valoWorkspaces.id),
  documentId: uuid("document_id").notNull().references(() => valoDocuments.id),
  revision: integer("revision").notNull(),
  title: text("title").notNull(),
  content: jsonb("content").notNull().$type<Record<string, unknown>>(),
  contentHash: text("content_hash").notNull(),
  actorId: text("actor_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  uniqueIndex("valo_document_revision_unique").on(t.documentId, t.revision),
  index("valo_revisions_workspace_idx").on(t.workspaceId),
]);
export const insertValoRevisionSchema = createInsertSchema(valoDocumentRevisions);
export type ValoDocumentRevision = typeof valoDocumentRevisions.$inferSelect;
