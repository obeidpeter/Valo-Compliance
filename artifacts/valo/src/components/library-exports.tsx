import { Link } from "wouter";
import { Download } from "lucide-react";
import { useListWorkspaceExports, getListWorkspaceExportsQueryKey } from "@workspace/api-client-react";
import { formatDate } from "@/lib/api";
import { ErrorState, Skel } from "./states";

/** The business library's files (DOC-005): each ready export with the saved revision it was made
 * from and the template version its document came from. */
export function LibraryExports() {
  const files = useListWorkspaceExports({ query: { queryKey: getListWorkspaceExportsQueryKey() } });
  return (
    <section className="mt-6" aria-labelledby="library-exports-heading" data-testid="library-exports">
      <div className="mb-4 flex items-center justify-between">
        <h2 id="library-exports-heading" className="eyebrow">
          Ready exports
        </h2>
        {files.data && <span className="text-sm text-muted-foreground">{files.data.length} ready</span>}
      </div>
      {files.isLoading ? (
        <Skel className="h-20" />
      ) : files.isError ? (
        <ErrorState title="Exports unavailable" error={files.error} onRetry={() => files.refetch()} />
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
                  {file.format.toUpperCase()} · revision {file.revision} · ready {formatDate(file.readyAt)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {file.template
                    ? `Made from template ${file.template.templateId}, version ${file.template.version}`
                    : "Not made from a template"}
                </p>
              </div>
              <a href={file.downloadUrl} className="btn btn-ghost btn-sm">
                <Download className="h-4 w-4" />
                Download {file.format.toUpperCase()}
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          No ready exports yet. Open a saved draft to create a DOCX or PDF.
        </p>
      )}
    </section>
  );
}
