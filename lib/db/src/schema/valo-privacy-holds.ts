import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { workspaceRowPolicy } from "./valo-workspace-scope";
import { valoWorkspaces } from "./valo-workspaces";

/**
 * A hold on a workspace that stands apart from any privacy request (PRV-003;
 * docs/architecture/privacy-requests.md, slice 4). While one is active, Valo's own deletion of the
 * workspace's data stops: an erasure does not start or continue, and its old downloads are not
 * removed. Privacy staff place it with a reason and release it with one; the row keeps who did each,
 * and when, and is never removed. Customer requests have no access to it: the reviewed function
 * valo_workspace_under_hold tells them only whether their own workspace is held.
 */
export const valoPrivacyHolds = pgTable(
  "valo_privacy_holds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => valoWorkspaces.id),
    reason: text("reason").notNull(),
    placedBy: text("placed_by").notNull(),
    placedAt: timestamp("placed_at", { withTimezone: true }).notNull().defaultNow(),
    releasedBy: text("released_by"),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    releaseReason: text("release_reason"),
  },
  (t) => [
    index("valo_privacy_hold_workspace").on(t.workspaceId, t.releasedAt),
    // At most one hold stands on a workspace at a time.
    uniqueIndex("valo_privacy_hold_standing")
      .on(t.workspaceId)
      .where(sql`${t.releasedAt} IS NULL`),
    check(
      "valo_privacy_hold_shape",
      sql`char_length(${t.reason}) BETWEEN 10 AND 1000 AND ((${t.releasedBy} IS NULL AND ${t.releasedAt} IS NULL AND ${t.releaseReason} IS NULL) OR (${t.releasedBy} IS NOT NULL AND ${t.releasedAt} IS NOT NULL AND char_length(${t.releaseReason}) BETWEEN 10 AND 1000))`,
    ),
    workspaceRowPolicy(t.workspaceId),
  ],
);
export type ValoPrivacyHold = typeof valoPrivacyHolds.$inferSelect;
