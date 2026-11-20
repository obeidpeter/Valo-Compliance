import { useEffect } from "react";
export { pageTitle, UNAVAILABLE_TITLE } from "./page-titles";

/** Sets the document title, which browsers and screen readers announce, when it is known. Moving
 * between pages in the app loads no new document, so each page sets its own title. */
export function useDocumentTitle(title: string | null) {
  useEffect(() => {
    if (title) document.title = title;
  }, [title]);
}
