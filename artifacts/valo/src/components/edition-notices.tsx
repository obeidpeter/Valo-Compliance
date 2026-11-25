import { useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListEditionNoticesQueryKey,
  markEditionNoticeRead,
  useListEditionNotices,
  type EditionNotice,
} from "@workspace/api-client-react";
import { ErrorState } from "@/components/states";
import { describeError } from "@/lib/api";
import { formatCount, formatDay } from "@/lib/format";

const purchases = "Download it from Purchases.";

/**
 * What a notice says (docs/architecture/editions.md, section 3): the template, its version, what
 * happened and when, then what it means for the workspace's purchase and for the documents it made
 * from that version. Every notice ends by saying that files already downloaded are not affected
 * (EDT-010).
 */
export function editionNoticeWords(notice: EditionNotice) {
  const on = " on " + formatDay(notice.createdAt);
  const title =
    notice.kind === "replaced"
      ? `“${notice.title}” version ${notice.version} was replaced by version ${notice.replacementVersion}${on}`
      : `“${notice.title}” version ${notice.version} was withdrawn${on}`;
  const lines: string[] = [];
  // A withdrawal's notice carries its reason, and a replacement's what changed in the new version
  // (docs/architecture/guidance-currency.md, slice 3).
  const reason = notice.reason?.trim();
  if (reason)
    lines.push(
      `${notice.kind === "withdrawn" ? "The reason given" : "What changed"}: ${reason}${/[.!?]$/.test(reason) ? "" : "."}`,
    );
  if (notice.held)
    lines.push(
      notice.kind === "replaced"
        ? `Your purchase carries to version ${notice.replacementVersion} at no further charge. ${purchases}`
        : "It can no longer be downloaded or used to start a document. You can take the replacement when one is released, or ask for a refund under the refund policy.",
    );
  if (notice.documents === 1)
    lines.push(
      notice.kind === "replaced"
        ? `Your document made from version ${notice.version} is unchanged.`
        : "Your document made from it stays yours: you can still open, edit and download it. Check its wording before you use it.",
    );
  else if (notice.documents > 1)
    lines.push(
      notice.kind === "replaced"
        ? `Your ${formatCount(notice.documents)} documents made from version ${notice.version} are unchanged.`
        : `Your ${formatCount(notice.documents)} documents made from it stay yours: you can still open, edit and download them. Check their wording before you use them.`,
    );
  lines.push("Files you already downloaded are not affected.");
  return { title, lines };
}

/** One notice's sentences, with Purchases as a link where it says where to download. */
function Line({ line }: { line: string }) {
  if (!line.endsWith(purchases)) return <p className="mt-1">{line}</p>;
  return (
    <p className="mt-1">
      {line.slice(0, -"Purchases.".length)}
      <Link className="underline" href="/workspace/purchases">
        Purchases
      </Link>
      .
    </p>
  );
}

/**
 * The workspace home's list of unread notices that a template it bought or used was replaced or
 * withdrawn. Each can be marked as read, and then leaves the list.
 */
export function EditionNotices() {
  const queryClient = useQueryClient();
  const notices = useListEditionNotices({
    query: { retry: false, queryKey: getListEditionNoticesQueryKey() },
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
      queryClient.setQueryData(getListEditionNoticesQueryKey(), await markEditionNoticeRead(id));
    } catch (failure) {
      setError(describeError(failure).message);
    } finally {
      setBusy(null);
    }
  }
  return (
    <section
      className="mt-5 rounded-2xl border border-[hsl(var(--ochre-border))] p-5"
      aria-labelledby="edition-notices-title"
      data-testid="card-edition-notices"
    >
      <h2 id="edition-notices-title" className="font-display text-xl">
        Changes to templates you bought or used
      </h2>
      <ul className="mt-3 grid gap-4">
        {items.map((notice) => {
          const { title, lines } = editionNoticeWords(notice);
          return (
            <li key={notice.id} className="text-sm" data-testid={`edition-notice-${notice.id}`}>
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
