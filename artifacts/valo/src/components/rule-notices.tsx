import { useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListRuleNoticesQueryKey,
  markRuleNoticeRead,
  useListRuleNotices,
  type RuleNotice,
} from "@workspace/api-client-react";
import { ErrorState } from "@/components/states";
import { describeError } from "@/lib/api";
import { formatCount, formatDay } from "@/lib/format";

const checkAgain = "Check again to see what applies now.";
const sentence = (text: string) => text + (/[.!?]$/.test(text) ? "" : ".");

/**
 * What a notice says (docs/architecture/rule-changes.md, slice 2): the rule, its version, what happened
 * and when, the reason given, and what it means for the workspace's saved results and tasks. A saved
 * result is kept as it was saved (EDP-011); a task is marked for review and its reminders stop
 * (RUL-009).
 */
export function ruleNoticeWords(notice: RuleNotice) {
  const on = " on " + formatDay(notice.createdAt);
  const title =
    notice.kind === "replaced"
      ? `“${notice.title}” version ${notice.version} was replaced by version ${notice.replacementVersion}${on}`
      : `“${notice.title}” version ${notice.version} was withdrawn${on}`;
  const reason = notice.reason.trim();
  const lines = [sentence((notice.kind === "replaced" ? "What changed: " : "Why: ") + reason)];
  if (notice.results === 1)
    lines.push(`Your saved result that lists it is kept as it was saved. ${checkAgain}`);
  else if (notice.results > 1)
    lines.push(
      `Your ${formatCount(notice.results)} saved results that list it are kept as they were saved. ${checkAgain}`,
    );
  if (notice.tasks === 1)
    lines.push("Your task made from it is marked for review, and its reminders have stopped.");
  else if (notice.tasks > 1)
    lines.push(
      `Your ${formatCount(notice.tasks)} tasks made from it are marked for review, and their reminders have stopped.`,
    );
  return { title, lines };
}

/** One notice's sentences, with "Check again" as a link to the requirements check. */
function Line({ line }: { line: string }) {
  if (!line.endsWith(checkAgain)) return <p className="mt-1">{line}</p>;
  return (
    <p className="mt-1">
      {line.slice(0, -checkAgain.length)}
      <Link className="underline" href="/workspace/checker">
        Check again
      </Link>
      {checkAgain.slice("Check again".length)}
    </p>
  );
}

/**
 * The workspace home's list of unread notices that a requirements-check rule version it saved a result
 * under, or made a task from, was replaced or withdrawn. Each can be marked as read, and then leaves
 * the list.
 */
export function RuleNotices() {
  const queryClient = useQueryClient();
  const notices = useListRuleNotices({
    query: { retry: false, queryKey: getListRuleNoticesQueryKey() },
  });
  const [busy, setBusy] = useState<string | null>(null),
    [error, setError] = useState<string | null>(null);
  if (notices.isError)
    return (
      <section className="mt-5">
        <ErrorState error={notices.error} onRetry={() => notices.refetch()} />
      </section>
    );
  const items = notices.data?.items ?? [];
  if (!items.length) return null;
  async function markRead(id: string) {
    setBusy(id);
    setError(null);
    try {
      queryClient.setQueryData(getListRuleNoticesQueryKey(), await markRuleNoticeRead(id));
    } catch (failure) {
      setError(describeError(failure).message);
    } finally {
      setBusy(null);
    }
  }
  return (
    <section
      className="mt-5 rounded-2xl border border-[hsl(var(--ochre-border))] p-5"
      aria-labelledby="rule-notices-title"
      data-testid="card-rule-notices"
    >
      <h2 id="rule-notices-title" className="font-display text-xl">
        Changes to requirements you checked
      </h2>
      <ul className="mt-3 grid gap-4">
        {items.map((notice) => {
          const { title, lines } = ruleNoticeWords(notice);
          return (
            <li key={notice.id} className="text-sm" data-testid={`rule-notice-${notice.id}`}>
              <p className="font-semibold">{title}</p>
              {lines.map((line) => (
                <Line key={line} line={line} />
              ))}
              <button
                type="button"
                className="btn btn-ghost btn-sm mt-2"
                disabled={busy !== null}
                aria-label={`Mark as read: ${title}`}
                onClick={() => void markRead(notice.id)}
              >
                {busy === notice.id ? "Marking as read…" : "Mark as read"}
              </button>
            </li>
          );
        })}
      </ul>
      {error && (
        <p className="mt-3 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
