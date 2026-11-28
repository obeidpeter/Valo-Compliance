import { check, date, pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { workspaceRowPolicy } from "./valo-workspace-scope";
import { valoWorkspaces } from "./valo-workspaces";

/**
 * One day's notices to a workspace, as the record their message is about
 * (docs/architecture/messages.md, part 7). A correction, a rule's replacement or withdrawal and a
 * template's withdrawal each leave a notice in the app as they happen. Once that day has ended, the
 * worker's `messages` task records here that the day's notices owe the workspace one message, and queues
 * it. A row holds nothing of the notices: the message is composed from them when it is sent.
 *
 * - `day`: the Lagos day whose notices the message is about. A workspace has one row for a day, and a row
 *   is only ever written for a day that has ended, so the day's notices are all there.
 *
 * The worker writes a row on the application's own connection. Customer requests, and the dispatcher in
 * the workspace's scope, only read their own workspace's.
 */
export const valoNoticeDigests = pgTable(
  "valo_notice_digests",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => valoWorkspaces.id),
    day: date("day").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("valo_notice_digest_once").on(t.workspaceId, t.day),
    check("valo_notice_digest_day_ended", sql`${t.day} < (${t.createdAt} AT TIME ZONE 'Africa/Lagos')::date`),
    workspaceRowPolicy(t.workspaceId),
  ],
);
export type ValoNoticeDigest = typeof valoNoticeDigests.$inferSelect;
