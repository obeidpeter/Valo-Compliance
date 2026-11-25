import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { useQueries } from "@tanstack/react-query";
import { listPublicCatalogue, type PublicItem } from "@workspace/api-client-react";
import { numberGroups } from "@/lib/result-documents";

/** The released documents with these numbers, every page of them: a number can name more than one. */
async function releasedWithNumbers(templateIds: string): Promise<PublicItem[]> {
  const found: PublicItem[] = [];
  for (let page = 1; page <= 5; page++) {
    const next = await listPublicCatalogue({ templateIds, page });
    found.push(...next.items);
    if (next.items.length === 0 || found.length >= next.total) break;
  }
  return found;
}

/** Where the released documents with a group of numbers are kept while the page is open. */
export const resultDocumentsKey = (templateIds: string) => ["result-documents", templateIds] as const;

/**
 * The released documents a result relates, read from the released list by their numbers
 * (docs/architecture/results.md). Only released documents are listed, so a held one is never named.
 */
export function useResultDocuments(numbers: readonly string[]) {
  const groups = useQueries({
    queries: numberGroups(numbers).map((templateIds) => ({
      queryKey: resultDocumentsKey(templateIds),
      queryFn: () => releasedWithNumbers(templateIds),
      staleTime: 60_000,
      retry: 1,
    })),
  });
  return {
    released: groups.flatMap((group) => group.data ?? []),
    failed: groups.some((group) => group.isError),
    retrying: groups.some((group) => group.isFetching),
    retry: () => {
      for (const group of groups) if (group.isError) void group.refetch();
    },
  };
}

const libraryPath = (document: PublicItem) => "/library/" + encodeURIComponent(document.slug);

/** Under a requirement: the released documents its rule relates. */
export function RequirementDocuments({ ruleId, documents }: { ruleId: string; documents: PublicItem[] }) {
  if (documents.length === 0) return null;
  return (
    <div className="mt-3 text-sm" data-testid={"documents-" + ruleId}>
      <p className="font-medium">Documents for this requirement</p>
      <ul className="mt-1 grid gap-1">
        {documents.map((document) => (
          <li key={document.id} className="min-w-0">
            <Link
              href={libraryPath(document)}
              className="font-medium text-primary underline underline-offset-2"
              data-testid={`link-document-${ruleId}-${document.slug}`}
            >
              {document.title}
            </Link>
            {document.access === "premium" && <span className="text-muted-foreground"> · Premium</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Under a result: the released documents of its likely relevant requirements, together. */
export function RecommendedDocuments({ documents }: { documents: PublicItem[] }) {
  if (documents.length === 0) return null;
  return (
    <section
      className="surface p-5"
      aria-labelledby="recommended-documents-heading"
      data-testid="section-recommended-documents"
    >
      <h3 id="recommended-documents-heading" className="font-display text-lg">
        Recommended documents
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        These are the documents for the requirements above that are likely relevant. Using one does not by
        itself meet a requirement.
      </p>
      <ul className="mt-4 grid gap-2">
        {documents.map((document) => (
          <li key={document.id} className="min-w-0">
            <Link
              href={libraryPath(document)}
              className="group flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-3 text-sm transition-colors hover:bg-secondary"
              data-testid={"link-recommended-" + document.slug}
            >
              <span className="min-w-0">
                <span className="block font-medium">
                  {document.title}
                  {document.access === "premium" && (
                    <span className="font-normal text-muted-foreground"> · Premium</span>
                  )}
                </span>
                <span className="block truncate text-muted-foreground">{document.summary}</span>
              </span>
              <ArrowRight
                className="h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5"
                aria-hidden
              />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** When the documents could not be read: what happened, what it does not change, and a way on. */
export function ResultDocumentsUnavailable({
  retrying,
  onRetry,
}: {
  retrying: boolean;
  onRetry: () => void;
}) {
  return (
    <div
      role="status"
      className="surface flex flex-wrap items-center justify-between gap-3 p-4 text-sm"
      data-testid="status-result-documents-error"
    >
      <p className="min-w-0 text-muted-foreground">
        The documents for these requirements could not be loaded. Your results above are not affected.
      </p>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        disabled={retrying}
        onClick={onRetry}
        data-testid="button-retry-result-documents"
      >
        {retrying ? "Trying again…" : "Try again"}
      </button>
    </div>
  );
}
