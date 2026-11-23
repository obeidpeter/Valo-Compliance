import { Link } from "wouter";
import { FilePlus2 } from "lucide-react";
import { useGetWorkspace, getGetWorkspaceQueryKey } from "@workspace/api-client-react";
import { DocumentList } from "@/components/document-list";
import { LibraryExports } from "@/components/library-exports";
import { SavedTemplates } from "@/components/saved-templates";
import { ErrorState, Skel } from "@/components/states";
import { WorkspaceNav } from "@/components/workspace-nav";
import { formatCount } from "@/lib/format";

/**
 * The workspace's documents section: every document the business has saved, the files ready to
 * download from them, and the templates it has saved from the library. "New document" leads to the
 * one page where a document starts.
 */
export default function DocumentsPage() {
  const ws = useGetWorkspace({ query: { enabled: true, queryKey: getGetWorkspaceQueryKey() } });

  return (
    <div className="mx-auto max-w-7xl px-5 py-12 lg:px-8">
      <WorkspaceNav />
      <header className="reveal flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="eyebrow">Documents</p>
          <h1 className="font-display mt-2 text-4xl sm:text-5xl">Your documents</h1>
          {ws.data && (
            <p className="mt-3 text-sm text-muted-foreground" data-testid="text-document-count">
              {formatCount(ws.data.documentCount)} saved
            </p>
          )}
        </div>
        {/* With nothing saved yet, the empty list below offers this instead: one button, not two. */}
        {(ws.data?.documentCount ?? 0) > 0 && (
          <Link href="/workspace/documents/new" className="btn btn-primary" data-testid="link-new-document">
            <FilePlus2 className="h-4 w-4" /> New document
          </Link>
        )}
      </header>
      <div className="mt-10">
        {ws.isLoading ? (
          <Skel className="h-60" />
        ) : ws.isError ? (
          <ErrorState error={ws.error} onRetry={() => ws.refetch()} />
        ) : (
          <section>
            <DocumentList enabled={ws.isSuccess} searchable />
            <LibraryExports />
          </section>
        )}
      </div>
      {ws.isSuccess && <SavedTemplates />}
    </div>
  );
}
