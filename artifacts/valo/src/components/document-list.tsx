import { Link } from "wouter";
import { ArrowRight, FilePlus2, FileText } from "lucide-react";
import { useListDocuments, getListDocumentsQueryKey } from "@workspace/api-client-react";
import { EmptyState, ErrorState, Skel } from "@/components/states";
import { missingFields } from "@/lib/api";
import { formatDateTime } from "@/lib/format";

/**
 * The workspace's documents, most recently saved first: each opens its editor. `limit` shows only
 * the first few, as the home screen does; the documents screen shows them all. With none, it offers
 * to start one.
 */
export function DocumentList({
  enabled,
  limit,
  onNew,
  creating,
}: {
  /** Whether the workspace is known, so the list may be read. */
  enabled: boolean;
  limit?: number;
  onNew: () => void;
  creating: boolean;
}) {
  const docs = useListDocuments({ query: { enabled, queryKey: getListDocumentsQueryKey() } });
  const shown = (docs.data ?? []).slice(0, limit);
  return (
    <>
      {docs.isLoading ? (
        <div className="grid gap-3">
          {[0, 1].map((i) => (
            <Skel key={i} className="h-24" />
          ))}
        </div>
      ) : docs.isError ? (
        <ErrorState error={docs.error} onRetry={() => docs.refetch()} />
      ) : shown.length > 0 ? (
        <ul className="grid gap-3">
          {shown.map((d) => {
            const miss = missingFields(d.content).length;
            return (
              <li key={d.id}>
                <Link
                  href={"/workspace/documents/" + d.id}
                  className="surface group flex items-center gap-5 p-5 transition-shadow hover:shadow-[var(--shadow-md)]"
                  data-testid={"link-doc-" + d.id}
                >
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent text-primary">
                    <FileText className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{d.title}</span>
                    <span className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                      <span>Business draft</span>
                      <span className="font-mono">rev {d.revision}</span>
                      <span>{formatDateTime(d.updatedAt)}</span>
                    </span>
                  </span>
                  {miss > 0 && <span className="pill pill-ochre hidden sm:inline-flex">{miss} missing</span>}
                  <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState
          mark={<FilePlus2 className="h-5 w-5 text-muted-foreground" />}
          title="No drafts yet"
          action={
            <button className="btn btn-primary" onClick={onNew} disabled={creating}>
              Start a blank draft
            </button>
          }
        >
          A new draft starts empty. Choose a released template from the library when one fits, or write your
          own document.
        </EmptyState>
      )}
    </>
  );
}
