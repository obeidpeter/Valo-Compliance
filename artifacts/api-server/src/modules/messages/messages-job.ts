import type { MessageSender } from "./message-sender";
import { recordDeliveryReports } from "./valo-email-events";
import { dispatchDueMessages } from "./valo-message-dispatcher";
import { oweNoticeDigests } from "./valo-notice-digests";

/**
 * The worker's `messages` task, each minute (docs/architecture/messages.md, parts 1, 3 and 7): it records
 * the message each ended day's notices owe, offers each due message to the sender, then records what the
 * email provider has reported about the messages it took. Each part runs whatever became of the others,
 * so a day that cannot be recorded or a message that cannot be offered never holds back a report, and the
 * task fails if any part did.
 *
 * `scope` keeps a test's run to one workspace; `parts` lets a test fail one part.
 */
export async function runMessagesJob(
  sender: MessageSender | null,
  now = new Date(),
  scope?: { workspaceId: string },
  parts: {
    owe?: typeof oweNoticeDigests;
    offer: typeof dispatchDueMessages;
    record: typeof recordDeliveryReports;
  } = { owe: oweNoticeDigests, offer: dispatchDueMessages, record: recordDeliveryReports },
) {
  const failures: unknown[] = [];
  const keep = (error: unknown) => {
    failures.push(error);
    return null;
  };
  const notices = await (parts.owe ?? oweNoticeDigests)(now, scope).catch(keep);
  const offered = await parts.offer(sender, now, scope).catch(keep);
  const reports = await parts.record(now).catch(keep);
  if (failures.length) throw new AggregateError(failures, "MESSAGES_JOB_PARTIALLY_FAILED");
  return { ...offered, reports, notices };
}
