import {pgTable,uuid,text,integer,timestamp,uniqueIndex,check} from "drizzle-orm/pg-core";
import {sql} from "drizzle-orm";
import {valoWorkspaces} from "./valo-workspaces";
/** Public title snapshot permits a useful unavailable state after withdrawal.
 * No source file, candidate text, entitlement or claimed legal applicability. */
export const valoSavedTemplates=pgTable("valo_saved_templates",{
  id:uuid("id").primaryKey(),workspaceId:uuid("workspace_id").notNull().references(()=>valoWorkspaces.id),
  templateId:text("template_id").notNull(),savedTitle:text("saved_title").notNull(),savedVersion:integer("saved_version").notNull(),
  createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[uniqueIndex("valo_saved_template_unique").on(t.workspaceId,t.templateId),
  check("valo_saved_template_identity",sql`length(${t.templateId}) BETWEEN 1 AND 80`),
  check("valo_saved_template_title",sql`length(${t.savedTitle}) BETWEEN 1 AND 300`),
  check("valo_saved_template_version",sql`${t.savedVersion}>0`)]);
