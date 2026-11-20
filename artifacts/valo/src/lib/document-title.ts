import { useEffect } from "react";

/** What the server titles a page it will not describe: a private or unknown path, or a missing item. */
export const UNAVAILABLE_TITLE = "Page unavailable or private — Valo";

/** "<name> — Valo", as the server titles a released item's page, unless the name already ends
 * with Valo. */
export function pageTitle(name: string) {
  return name.endsWith("Valo") ? name : `${name} — Valo`;
}

/** Sets the document title, which browsers and screen readers announce, when it is known. Moving
 * between pages in the app loads no new document, so each page sets its own title. */
export function useDocumentTitle(title: string | null) {
  useEffect(() => {
    if (title) document.title = title;
  }, [title]);
}
