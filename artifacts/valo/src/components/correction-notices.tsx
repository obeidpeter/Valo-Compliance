import { useState } from "react";
import { Link } from "wouter";
import { useGetCorrectionNotices } from "@workspace/api-client-react";
import { ErrorState } from "@/components/states";
import { formatDateTime } from "@/lib/format";
export function CorrectionNotices() {
  const [page, setPage] = useState(1),
    q = useGetCorrectionNotices({ page }, { query: { retry: false, refetchInterval: 60000 } });
  if (q.isError)
    return (
      <section className="mt-5">
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      </section>
    );
  if (!q.data?.notices.length) return null;
  return (
    <section
      className="mt-5 rounded-2xl border border-amber-600/40 p-5"
      aria-label="Source correction notices"
    >
      <h2 className="font-display text-xl">Review saved guidance</h2>
      <ul className="mt-3 grid gap-4">
        {q.data.notices.map((n) => (
          <li key={n.id} className="text-sm">
            <p>{n.message}</p>
            <p className="mt-1 text-muted-foreground">{formatDateTime(n.createdAt)}</p>
            <Link
              className="mt-2 inline-block underline"
              href={
                n.entityKind === "tasks"
                  ? "/workspace/tasks"
                  : n.entityKind === "assessments"
                    ? "/workspace/assessments"
                    : n.entityKind === "purchases"
                      ? "/workspace/purchases"
                      : `/workspace/documents/${n.entityId}`
              }
            >
              Review saved{" "}
              {n.entityKind === "documents"
                ? "document"
                : n.entityKind === "purchases"
                  ? "purchase"
                  : n.entityKind === "tasks"
                    ? "task"
                    : "assessment"}
            </Link>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex items-center gap-3">
        <button className="btn btn-ghost btn-sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
          Previous
        </button>
        <span className="text-sm">Page {page}</span>
        <button
          className="btn btn-ghost btn-sm"
          disabled={!q.data.hasMore}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </button>
      </div>
    </section>
  );
}
