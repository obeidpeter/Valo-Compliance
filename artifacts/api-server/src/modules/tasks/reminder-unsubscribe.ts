import { eq } from "drizzle-orm";
import { db, runInWorkspaceScope, valoReminderPreferences, valoWorkspaces } from "@workspace/db";
import { ValoProblem } from "../../platform/valo-problem";
import { workspaceActorFromRecord } from "../../platform/workspace-context";
import { workspaceTransaction } from "../rules";
import { turnRemindersOffByLink } from "./valo-tasks";

/** What a reminder's unsubscribe link says, once its signature has been checked. */
type ReminderLink = { workspaceId: string; recordId: string; madeFor(identityId: string): boolean };

/**
 * Stops a workspace's reminders from the link in one of them (docs/architecture/messages.md, part 4).
 * Nobody is signed in: the link, which Valo signed, is what allows it, and it allows this and nothing
 * else.
 *
 * - The workspace comes from the link, and everything else from the workspace's own stored records, read
 *   in that workspace's database scope.
 * - Reminders go to the workspace's owner. A link made for someone who is no longer its owner stops
 *   nothing, and neither does one for a workspace that is no longer there.
 * - The change is made as the owner, through the same checks as a change made in the app. Where the app
 *   would take no change of the owner's, because their access is off or the workspace's deletion is
 *   recorded, the link changes nothing either. No reminder is sent in that state: the worker makes the
 *   same checks before each one.
 *
 * It answers `off` when it turned reminders off, `already_off` when they were off, and `refused`
 * otherwise, without saying why. A link used twice changes nothing the second time.
 */
export function stopRemindersByLink(link: ReminderLink) {
  return runInWorkspaceScope(link.workspaceId, async () => {
    const [workspace] = await db
      .select({ id: valoWorkspaces.id, ownerIdentityId: valoWorkspaces.ownerIdentityId })
      .from(valoWorkspaces)
      .where(eq(valoWorkspaces.id, link.workspaceId));
    if (!workspace || !link.madeFor(workspace.ownerIdentityId)) return "refused" as const;
    // Nothing to change is found without a lock or a write.
    const [chosen] = await db
      .select({ enabled: valoReminderPreferences.enabled })
      .from(valoReminderPreferences)
      .where(eq(valoReminderPreferences.workspaceId, workspace.id));
    if (!chosen?.enabled) return "already_off" as const;
    const actor = workspaceActorFromRecord({
      workspaceId: workspace.id,
      identityId: workspace.ownerIdentityId,
    });
    try {
      return await workspaceTransaction(actor, (tx) => turnRemindersOffByLink(tx, actor, link.recordId));
    } catch (error) {
      // The checks every change of the owner's passes refused this one: the workspace went, the owner's
      // access is off, or a deletion is recorded. Whoever holds the link is not told which.
      if (error instanceof ValoProblem && (error.status === 403 || error.status === 404))
        return "refused" as const;
      throw error;
    }
  });
}
