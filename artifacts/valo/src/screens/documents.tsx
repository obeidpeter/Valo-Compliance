import { Link } from "wouter";
import { FilePlus2, Loader2, Sparkles } from "lucide-react";
import { useGetWorkspace, getGetWorkspaceQueryKey } from "@workspace/api-client-react";
import { DocumentList } from "@/components/document-list";
import { LibraryExports } from "@/components/library-exports";
import { SavedTemplates } from "@/components/saved-templates";
import { ErrorState, Notice, Skel } from "@/components/states";
import { WorkspaceNav } from "@/components/workspace-nav";
import { describeError } from "@/lib/api";
import { useNewDocument } from "@/lib/use-new-document";

/**
 * The workspace's documents section: every document the business has saved, the files ready to
 * download from them, and the templates it has saved from the library. A new document starts here
 * or on the home screen.
 */
export default function DocumentsPage() {
  const ws = useGetWorkspace({ query: { enabled: true, queryKey: getGetWorkspaceQueryKey() } });
  const create = useNewDocument();

  return (
    <div className="mx-auto max-w-7xl px-5 py-12 lg:px-8">
      <WorkspaceNav />
      <header className="reveal flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="eyebrow">Documents</p>
          <h1 className="font-display mt-2 text-4xl sm:text-5xl">Your documents</h1>
          <p className="mt-3 text-sm text-muted-foreground" data-testid="text-document-count">
            {ws.data?.documentCount ?? 0} saved
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/workspace/ai" className="btn btn-ink" data-testid="link-documents-assistant">
            <Sparkles className="h-4 w-4" /> Prepare invoice or quotation
          </Link>
          <button
            className="btn btn-primary"
            onClick={create.start}
            disabled={create.pending || !ws.isSuccess}
            data-testid="button-new-document"
          >
            {create.pending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FilePlus2 className="h-4 w-4" />
            )}{" "}
            New blank draft
          </button>
        </div>
      </header>
      {create.error && (
        <p role="alert" className="mt-4 rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {describeError(create.error).message}
        </p>
      )}
      <div className="mt-10">
        {ws.isLoading ? (
          <Skel className="h-60" />
        ) : ws.isError ? (
          <ErrorState error={ws.error} onRetry={() => ws.refetch()} />
        ) : (
          <section>
            <DocumentList enabled={ws.isSuccess} onNew={create.start} creating={create.pending} />
            <LibraryExports />
            <Notice className="mt-4" tone="ink" title="Development workspace">
              Use synthetic test details only. Open a saved draft to request private, visibly marked DOCX or
              PDF exports. Production recovery and release approval remain unproved.
            </Notice>
          </section>
        )}
      </div>
      {ws.isSuccess && <SavedTemplates />}
    </div>
  );
}
