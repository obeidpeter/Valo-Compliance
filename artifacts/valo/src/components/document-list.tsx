import { useMemo, useState } from "react";
import { Link } from "wouter";
import { ArrowRight, FilePlus2, FileText, Search, X } from "lucide-react";
import { useListDocuments, getListDocumentsQueryKey } from "@workspace/api-client-react";
import { EmptyState, ErrorState, Skel } from "@/components/states";
import { missingFields } from "@/lib/api";
import { formatDateTime } from "@/lib/format";

/**
 * The workspace's documents, most recently saved first: each opens its editor. `limit` shows only
 * the first few, as the home screen does; the documents screen shows them all. With none, it leads
 * to the page where a document starts.
 */
export function DocumentList({
  enabled,
  limit,
  searchable = false,
}: {
  /** Whether the workspace is known, so the list may be read. */
  enabled: boolean;
  limit?: number;
  /** Show a title search box when the workspace has more than one saved document. */
  searchable?: boolean;
}) {
  const docs = useListDocuments({ query: { enabled, queryKey: getListDocumentsQueryKey() } });
  const [query, setQuery] = useState("");
  const all = docs.data ?? [];
  const trimmed = query.trim().toLowerCase();
  const shown = useMemo(() => {
    const filtered = searchable && trimmed ? all.filter((d) => d.title.toLowerCase().includes(trimmed)) : all;
    return filtered.slice(0, limit);
  }, [all, limit, searchable, trimmed]);
  const showSearch = searchable && all.length > 1;
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
      ) : all.length > 0 ? (
        <>
          {showSearch && (
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <div className="relative min-w-0 flex-1 sm:max-w-sm">
                <Search
                  className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  className="field !pl-10"
                  aria-label="Search your documents by title"
                  placeholder="Search by title"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  data-testid="input-document-search"
                />
              </div>
              {trimmed && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setQuery("")}
                  data-testid="button-clear-document-search"
                >
                  <X className="h-4 w-4" aria-hidden="true" /> Clear
                </button>
              )}
            </div>
          )}
          {shown.length > 0 ? (
            <ul className="grid gap-3">
              {shown.map((d) => {
                const miss = missingFields(d.content).length;
                return (
                  <li key={d.id}>
                    <Link
                      href={"/workspace/documents/" + d.id}
                      className="surface group flex items-center gap-4 p-5 transition-shadow hover:shadow-[var(--shadow-md)] sm:gap-5"
                      data-testid={"link-doc-" + d.id}
                    >
                      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent text-primary">
                        <FileText className="h-5 w-5" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{d.title}</span>
                        <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span>Draft</span>
                          <span>Version {d.revision}</span>
                          <span>Saved {formatDateTime(d.updatedAt)}</span>
                        </span>
                        {miss > 0 && (
                          <span className="pill pill-ochre mt-2 inline-flex sm:hidden">
                            {miss === 1 ? "1 detail missing" : `${miss} details missing`}
                          </span>
                        )}
                      </span>
                      {miss > 0 && (
                        <span className="pill pill-ochre hidden shrink-0 sm:inline-flex">
                          {miss === 1 ? "1 detail missing" : `${miss} details missing`}
                        </span>
                      )}
                      <ArrowRight
                        className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                        aria-hidden="true"
                      />
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="surface p-6 text-sm text-muted-foreground" role="status">
              <p>No saved documents match &ldquo;{query.trim()}&rdquo;.</p>
              <button type="button" className="btn btn-ghost btn-sm mt-3" onClick={() => setQuery("")}>
                Show all documents
              </button>
            </div>
          )}
        </>
      ) : (
        <EmptyState
          mark={<FilePlus2 className="h-5 w-5 text-muted-foreground" />}
          title="No documents yet"
          action={
            <Link
              href="/workspace/documents/new"
              className="btn btn-primary"
              data-testid="link-first-document"
            >
              New document
            </Link>
          }
        >
          Start with an invoice, a quotation or another everyday document, or with a blank page.
        </EmptyState>
      )}
    </>
  );
}
