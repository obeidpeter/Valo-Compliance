import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { workspaceRowPolicy } from "./valo-workspace-scope";
import { valoWorkspaces } from "./valo-workspaces";

/**
 * A notice to a workspace that holds a template, or made a document from one of its editions, that the
 * edition was replaced by a later release or withdrawn (docs/architecture/editions.md, slice 3). The
 * database writes it, in the transaction that makes the change, on either route; the workspace may
 * only mark it read. One per workspace, edition and kind of change.
 */
export const valoEditionNotices = pgTable(
  "valo_edition_notices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => valoWorkspaces.id),
    route: text("route").notNull(),
    edition: uuid("edition").notNull(),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    version: integer("version").notNull(),
    replacementVersion: integer("replacement_version"),
    reason: text("reason"),
    held: boolean("held").notNull(),
    documents: integer("documents").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("valo_edition_notice_once").on(t.workspaceId, t.edition, t.kind),
    index("valo_edition_notice_workspace").on(t.workspaceId, t.createdAt),
    check(
      "valo_edition_notice_shape",
      sql`${t.route} IN ('library', 'reviewed') AND ${t.kind} IN ('replaced', 'withdrawn') AND ${t.documents} >= 0 AND (${t.held} OR ${t.documents} > 0) AND ((${t.kind} = 'replaced') = (${t.replacementVersion} IS NOT NULL)) AND (${t.reason} IS NULL OR ${t.kind} = 'withdrawn')`,
    ),
    workspaceRowPolicy(t.workspaceId),
  ],
);
