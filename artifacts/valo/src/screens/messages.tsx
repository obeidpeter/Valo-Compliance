import { useMemo } from "react";
import { Mail } from "lucide-react";
import { Link } from "wouter";
import {
  useListWorkspaceMessages,
  useListReminders,
  useListTasks,
  getListWorkspaceMessagesQueryKey,
  getListRemindersQueryKey,
  getListTasksQueryKey,
  type ReminderRecord,
  type ReminderRecordStatus,
  type WorkspaceMessage,
  type WorkspaceMessageStatus,
} from "@workspace/api-client-react";
import { WorkspaceNav } from "@/components/workspace-nav";
import { EmptyState, ErrorState, Skel } from "@/components/states";
import { live } from "@/lib/checker";
import { formatDateTime } from "@/lib/format";
import { deliveryWords } from "@/lib/delivery-words";
import {
  messageLabel,
  messageMeaning,
  messageNeedsHelp,
  messageSubject,
  recordStays,
} from "@/lib/message-words";
import { reminderLabel, reminderMeaning, triedTimes } from "@/lib/reminder-words";

/**
 * The colour of each state's label. Green is kept for a message an email service accepted. A report from
 * the email service has a colour of its own (delivery-words.ts).
 */
const TONE: Record<WorkspaceMessageStatus, string> = {
  queued: "pill-ink",
  sending: "pill-ink",
  held: "pill-ochre",
  accepted: "pill-forest",
  recorded: "pill-ink",
  failed: "pill-ochre",
  cancelled: "pill-ink",
};
const REMINDER_TONE: Record<ReminderRecordStatus, string> = {
  held: "pill-ochre",
  pending: "pill-ink",
  sent: "pill-forest",
  cancelled: "pill-ink",
  failed: "pill-ochre",
};
const LINK =
  "underline decoration-border underline-offset-4 hover:decoration-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

type Entry =
  | { at: number; id: string; message: WorkspaceMessage }
  | { at: number; id: string; reminder: ReminderRecord };

/**
 * The workspace's delivery log (WRK-003): every message Valo owes the workspace and what has happened to
 * it, with the reminders about its tasks, newest first. Nothing here is called sent. A message is called
 * delivered only where the email service reported that it was; without that report, the most the log says
 * is that an email service accepted it.
 */
export default function MessagesPage() {
  const messages = useListWorkspaceMessages({
    query: { queryKey: getListWorkspaceMessagesQueryKey(), ...live },
  });
  const reminders = useListReminders({ query: { queryKey: getListRemindersQueryKey(), ...live } });
  // Only the titles of the reminders' tasks: without them a reminder is still listed.
  const tasks = useListTasks({ query: { queryKey: getListTasksQueryKey(), ...live } });
  const taskTitle = useMemo(
    () => new Map((tasks.data ?? []).map((task) => [task.id, task.title])),
    [tasks.data],
  );
  const entries = useMemo<Entry[]>(
    () =>
      [
        ...(messages.data ?? []).map((message) => ({
          at: Date.parse(message.createdAt),
          id: message.id,
          message,
        })),
        ...(reminders.data ?? []).map((reminder) => ({
          at: Date.parse(reminder.scheduledAt),
          id: reminder.id,
          reminder,
        })),
      ].sort((a, b) => b.at - a.at || a.id.localeCompare(b.id)),
    [messages.data, reminders.data],
  );
  const failed = messages.isError ? messages : reminders.isError ? reminders : null;
  return (
    <div className="mx-auto max-w-6xl px-5 py-10 lg:px-8">
      <WorkspaceNav />
      <header className="mb-8 max-w-2xl">
        <p className="eyebrow">Account</p>
        <h1 className="font-display mt-2 text-4xl">Messages from Valo</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground" data-testid="text-messages-intro">
          Each message Valo owes this workspace about a purchase, a refund or a change that affects it, and
          each reminder about a task, with what has happened to it. A message is shown as delivered only when
          the email service reports that it was. Until then, the most Valo knows is that an email service
          accepted it.
        </p>
      </header>
      <section aria-labelledby="messages-h">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
          <h2 id="messages-h" className="font-display text-2xl">
            Delivery log
          </h2>
          <span className="text-xs text-muted-foreground">Newest first</span>
        </div>
        {messages.isLoading || reminders.isLoading ? (
          <div className="grid gap-2">
            {[0, 1, 2].map((i) => (
              <Skel key={i} className="h-16" />
            ))}
          </div>
        ) : failed ? (
          <ErrorState
            error={failed.error}
            onRetry={() => {
              // Everything that failed is asked for again, so one press can bring the whole log back.
              for (const query of [messages, reminders, tasks]) if (query.isError) void query.refetch();
            }}
          />
        ) : entries.length === 0 ? (
          <EmptyState
            mark={<Mail className="h-5 w-5 text-muted-foreground" />}
            title="No messages yet"
            action={
              <Link href="/workspace" className="btn btn-ghost">
                Back to Home
              </Link>
            }
          >
            A message appears here when Valo owes you one about a purchase, a refund or a change that affects
            this workspace, or when a reminder is planned for a task.
          </EmptyState>
        ) : (
          <ul className="surface divide-y divide-border overflow-hidden" data-testid="list-messages">
            {entries.map((entry) =>
              "message" in entry ? (
                <MessageRow key={entry.id} message={entry.message} />
              ) : (
                <ReminderRow
                  key={entry.id}
                  reminder={entry.reminder}
                  title={taskTitle.get(entry.reminder.taskId)}
                />
              ),
            )}
          </ul>
        )}
      </section>
    </div>
  );
}

/** When the email service made its report about a message or reminder, where it has made one. */
function Reported({ entry }: { entry: Pick<WorkspaceMessage, "delivery" | "deliveryAt"> }) {
  if (!entry.delivery || !entry.deliveryAt) return null;
  return (
    <p className="mt-1 text-xs text-muted-foreground">
      The email service reported this on {formatDateTime(entry.deliveryAt)}.
    </p>
  );
}

function MessageRow({ message }: { message: WorkspaceMessage }) {
  return (
    <li
      className="grid gap-1 p-4 sm:grid-cols-[1fr_auto] sm:items-center"
      data-testid={"row-message-" + message.id}
    >
      <div className="min-w-0">
        <p className="break-words text-sm font-medium">{messageSubject(message)}</p>
        <p className="mt-0.5 break-words text-xs text-muted-foreground">
          {formatDateTime(message.createdAt)} ·{" "}
          {message.forYou ? "For you" : "For another member of this workspace"}
          {message.refundReference ? " · Refund " + message.refundReference : ""}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{messageMeaning(message)}</p>
        <Reported entry={message} />
        <p className="mt-1 text-xs text-muted-foreground">
          {recordStays(message)}{" "}
          {message.kind === "notices_digest" ? (
            <Link href="/workspace" className={LINK}>
              Go to Workspace
            </Link>
          ) : (
            <Link href="/workspace/purchases" className={LINK}>
              Go to Purchases
            </Link>
          )}
        </p>
        {messageNeedsHelp(message) && (
          <Link
            href="/support"
            className="mt-1 inline-block text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4"
          >
            Report a problem
          </Link>
        )}
        {/* A message Valo only recorded was offered to no email service, so it has no tries to count. */}
        {message.lastAttemptAt && message.status !== "recorded" && (
          <p className="mt-1 text-xs text-muted-foreground">
            {triedTimes(message.attempts)} Last tried {formatDateTime(message.lastAttemptAt)}.
          </p>
        )}
        {message.nextAttemptAt && (
          <p className="mt-1 text-xs text-muted-foreground">
            {message.status === "held" ? "Valo looks at this again after " : "Valo tries again after "}
            {formatDateTime(message.nextAttemptAt)}.
          </p>
        )}
      </div>
      <span className={"pill w-fit " + (deliveryWords(message)?.tone ?? TONE[message.status] ?? "pill-ink")}>
        <span className="dot" />
        {messageLabel(message)}
      </span>
    </li>
  );
}

function ReminderRow({ reminder, title }: { reminder: ReminderRecord; title: string | undefined }) {
  return (
    <li
      className="grid gap-1 p-4 sm:grid-cols-[1fr_auto] sm:items-center"
      data-testid={"row-reminder-" + reminder.id}
    >
      <div className="min-w-0">
        <p className="break-words text-sm font-medium">
          {title ? "Reminder: " + title : "Reminder for a task no longer in your list"}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Planned for {formatDateTime(reminder.scheduledAt)}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{reminderMeaning(reminder)}</p>
        <Reported entry={reminder} />
        <p className="mt-1 text-xs text-muted-foreground">
          Its times and tries are on your Reminders page.{" "}
          <Link href="/workspace/reminders" className={LINK}>
            Go to Reminders
          </Link>
        </p>
      </div>
      <span
        className={
          "pill w-fit " + (deliveryWords(reminder)?.tone ?? REMINDER_TONE[reminder.status] ?? "pill-ink")
        }
      >
        <span className="dot" />
        {reminderLabel(reminder)}
      </span>
    </li>
  );
}
