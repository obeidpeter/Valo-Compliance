import { Link } from "wouter";
import { Download } from "lucide-react";
import { useListWorkspaceExports, getListWorkspaceExportsQueryKey } from "@workspace/api-client-react";
import { FILE_FORMAT_NAMES } from "@/lib/file-formats";
import { formatDateTime } from "@/lib/format";
import { ErrorState, Skel } from "./states";

/** The business library's files (DOC-005): each ready file with the saved version it was made from
 * and the template version its document came from. */
export function LibraryExports() {
  const files = useListWorkspaceExports({ query: { queryKey: getListWorkspaceExportsQueryKey() } });
  return (
    <section className="mt-6" aria-labelledby="library-exports-heading" data-testid="library-exports">
      <div className="mb-4 flex items-center justify-between">
        <h2 id="library-exports-heading" className="eyebrow">
          Files ready to download
        </h2>
        {files.data && <span className="text-sm text-muted-foreground">{files.data.length} ready</span>}
      </div>
      {files.isLoading ? (
        <Skel className="h-20" />
      ) : files.isError ? (
        <ErrorState
          title="Your files could not be loaded"
          error={files.error}
          onRetry={() => files.refetch()}
        />
      ) : files.data && files.data.length > 0 ? (
        <ul className="grid gap-3">
          {files.data.map((file) => (
            <li
              key={file.id}
              className="surface flex flex-wrap items-center justify-between gap-3 p-4"
              data-testid={"library-export-" + file.id}
            >
              <div className="min-w-0">
                <Link href={"/workspace/documents/" + file.documentId} className="block truncate font-medium">
                  {file.documentTitle}
                </Link>
                <p className="mt-1 text-xs text-muted-foreground">
                  {FILE_FORMAT_NAMES[file.format]} · version {file.revision} · ready{" "}
                  {formatDateTime(file.readyAt)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {file.template
                    ? `Made from template ${file.template.templateId}, version ${file.template.version}`
                    : "Not made from a template"}
                </p>
              </div>
              <a href={file.downloadUrl} className="btn btn-ghost btn-sm">
                <Download className="h-4 w-4" aria-hidden="true" />
                Download the {FILE_FORMAT_NAMES[file.format]} file
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          No files yet. Open a document to make a Word file or a PDF from it.
        </p>
      )}
    </section>
  );
}
