import { pgTable, uuid, integer, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { valoWorkspaces } from "./valo-workspaces";

export const valoDocuments = pgTable("valo_documents", {
  id: uuid("id").primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => valoWorkspaces.id),
  currentRevision: integer("current_revision").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [index("valo_documents_workspace_idx").on(t.workspaceId), uniqueIndex("valo_document_workspace_unique").on(t.id, t.workspaceId)]);
export const insertValoDocumentSchema = createInsertSchema(valoDocuments);
export type ValoDocument = typeof valoDocuments.$inferSelect;
