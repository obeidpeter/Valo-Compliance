import {
  getListDocumentEditionsQueryKey,
  useListDocumentEditions,
  type DocumentEdition,
} from "@workspace/api-client-react";
import { Notice } from "./page-parts";
import { basePath } from "@/lib/env";
import { formatDay } from "@/lib/format";

/**
 * What the editor says of a document whose template edition was replaced or withdrawn
 * (docs/architecture/editions.md, section 1). The document itself never changes, and it says so.
 */
export function editionNotice(edition: DocumentEdition) {
  const on = edition.since ? " on " + formatDay(edition.since) : "";
  if (edition.state === "replaced")
    return {
      title: "A newer version of this template was released" + on,
      body: `Your document is unchanged and keeps the wording of version ${edition.version}.`,
    };
  const reason = edition.reason?.trim();
  return {
    title: "This template was withdrawn" + on,
    body:
      (reason ? `The reason given: ${reason}${/[.!?]$/.test(reason) ? "" : "."} ` : "") +
      "Your document stays yours: you can still open, edit and download it. Check its wording before you use it.",
  };
}

/** The documents list's mark for such a document. */
export const editionMark = (edition: DocumentEdition) =>
  edition.state === "replaced" ? "Newer template version" : "Template withdrawn";

/** The workspace's documents whose template edition changed, by document. */
export function useDocumentEditions(enabled = true) {
  const editions = useListDocumentEditions({
    query: { enabled, queryKey: getListDocumentEditionsQueryKey() },
  });
  return new Map((editions.data?.items ?? []).map((item) => [item.documentId, item]));
}

/** The editor's notice for one document, when its template edition was replaced or withdrawn. */
export function DocumentEditionNotice({ edition }: { edition: DocumentEdition | undefined }) {
  if (!edition) return null;
  const { title, body } = editionNotice(edition);
  return (
    <Notice className="no-print mt-4" title={title}>
      <span data-testid="text-edition-notice">{body}</span>
      {edition.current && (
        // The template's page is a public page, which loads in full (decision 0011).
        <>
          {" "}
          <a className="underline" href={basePath + edition.current.href} data-testid="link-edition-current">
            See version {edition.current.version}
          </a>
        </>
      )}
    </Notice>
  );
}
