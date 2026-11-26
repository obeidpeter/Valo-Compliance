import { useState } from "react";
import { keepPreviousData } from "@tanstack/react-query";
import { useGetAuditHistory, type GetAuditHistoryKind } from "@workspace/api-client-react";
import { describeError } from "@/lib/api";
import { formatCount, formatDateTime } from "@/lib/format";

/** The histories no other staff screen shows (ADM-009, docs/architecture/audit-trail.md, slice 4). */
const kinds: { value: GetAuditHistoryKind; label: string }[] = [
  { value: "access", label: "Staff reads" },
  { value: "safety", label: "Safety controls" },
  { value: "prices", label: "Price changes" },
  { value: "refunds", label: "Refund changes" },
  { value: "counts", label: "History counts" },
];

export function AuditHistory() {
  const [kind, setKind] = useState<GetAuditHistoryKind>("access"),
    [page, setPage] = useState(1);
  // The page shown stays until the next one arrives, so the buttons, and keyboard focus, stay put.
  const q = useGetAuditHistory(
    { kind, page },
    { query: { retry: false, placeholderData: keepPreviousData } },
  );
  const shown = q.data,
    pages = shown ? Math.max(1, Math.ceil(shown.total / shown.pageSize)) : 1;
  return (
    <section className="mt-6 space-y-4 rounded-xl border p-4" aria-labelledby="audit-history-heading">
      <h2 id="audit-history-heading" className="font-display text-2xl">
        Audit history
      </h2>
      <p className="text-sm">
        Read only. Each of these histories is kept as it was written, and opening one is itself recorded.
      </p>
      <div role="group" aria-label="Which history" className="flex flex-wrap gap-2">
        {kinds.map((k) => (
          <button
            key={k.value}
            type="button"
            className={kind === k.value ? "btn btn-primary btn-sm" : "btn btn-secondary btn-sm"}
            aria-pressed={kind === k.value}
            onClick={() => {
              setKind(k.value);
              setPage(1);
            }}
          >
            {k.label}
          </button>
        ))}
      </div>
      {q.isFetching && <p role="status">Loading the history…</p>}
      {q.isError && (
        <div>
          <p role="alert" className="my-3">
            {describeError(q.error).message}
          </p>
          <button type="button" className="btn btn-secondary" onClick={() => void q.refetch()}>
            Try again
          </button>
        </div>
      )}
      {shown && (
        <>
          <p className="text-sm">{shown.notice}</p>
          {shown.entries.length === 0 ? (
            <p>Nothing is recorded in this history yet.</p>
          ) : (
            <ul
              className="space-y-2"
              aria-label={`${kinds.find((k) => k.value === shown.kind)?.label ?? "This"} history`}
            >
              {shown.entries.map((entry) => (
                <li key={entry.id} className="rounded-lg border p-3 text-sm">
                  <p className="font-semibold">{entry.action}</p>
                  <p className="break-all">
                    {formatDateTime(entry.at)} · {entry.actor} · {entry.object}
                  </p>
                  {entry.reason && <p className="break-words">{entry.reason}</p>}
                </li>
              ))}
            </ul>
          )}
          <nav aria-label="History pages" className="flex items-center gap-3">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={shown.page <= 1 || q.isFetching}
              onClick={() => setPage(shown.page - 1)}
            >
              Newer
            </button>
            <span>
              Page {formatCount(shown.page)} of {formatCount(pages)}
            </span>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={shown.page >= pages || q.isFetching}
              onClick={() => setPage(shown.page + 1)}
            >
              Older
            </button>
          </nav>
        </>
      )}
    </section>
  );
}
