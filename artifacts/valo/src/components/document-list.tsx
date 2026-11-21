import { Link } from "wouter";
import { ArrowRight, FilePlus2, FileText } from "lucide-react";
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
}: {
  /** Whether the workspace is known, so the list may be read. */
  enabled: boolean;
  limit?: number;
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
                      <span>Draft</span>
                      <span>Version {d.revision}</span>
                      <span>Saved {formatDateTime(d.updatedAt)}</span>
                    </span>
                  </span>
                  {miss > 0 && (
                    <span className="pill pill-ochre hidden sm:inline-flex">
                      {miss === 1 ? "1 detail missing" : `${miss} details missing`}
                    </span>
                  )}
                  <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </Link>
              </li>
            );
          })}
        </ul>
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
