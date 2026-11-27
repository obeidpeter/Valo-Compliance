import type { MessageSender } from "./message-sender";
import { recordDeliveryReports } from "./valo-email-events";
import { dispatchDueMessages } from "./valo-message-dispatcher";

/**
 * The worker's `messages` task, each minute (docs/architecture/messages.md, parts 1 and 3): it offers each
 * due message to the sender, then records what the email provider has reported about the messages it
 * took. The second part runs whatever became of the first, so a message that cannot be offered never holds
 * back a report, and the task fails if either part did.
 *
 * `scope` keeps a test's run to one workspace's messages; `parts` lets a test fail one part.
 */
export async function runMessagesJob(
  sender: MessageSender | null,
  now = new Date(),
  scope?: { workspaceId: string },
  parts = { offer: dispatchDueMessages, record: recordDeliveryReports },
) {
  const failures: unknown[] = [];
  const keep = (error: unknown) => {
    failures.push(error);
    return null;
  };
  const offered = await parts.offer(sender, now, scope).catch(keep);
  const reports = await parts.record(now).catch(keep);
  if (failures.length) throw new AggregateError(failures, "MESSAGES_JOB_PARTIALLY_FAILED");
  return { ...offered, reports };
}
