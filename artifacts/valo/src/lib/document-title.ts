import { useEffect } from "react";
export { pageTitle, UNAVAILABLE_TITLE } from "./page-titles";

/** The titles screens hold, the newest last; only the newest is shown. */
const held: string[] = [];
let keeper: MutationObserver | undefined;

function showHeldTitle() {
  const title = held.at(-1);
  if (title !== undefined && document.title !== title) document.title = title;
}

/**
 * Sets the document title, which browsers and screen readers announce, and keeps it until released.
 * On a full load the server's title is in the page's head, and Next puts it back as the page
 * hydrates, which can be after a screen of the browser app has set its own; so while a title is
 * held, it is set again whenever the head changes. Only the newest holder's title is shown, so two
 * holders never undo each other. With `restore`, releasing the last held title puts back the title
 * found when it was taken.
 */
export function holdDocumentTitle(title: string, { restore = false }: { restore?: boolean } = {}) {
  const found = document.title;
  held.push(title);
  showHeldTitle();
  if (!keeper) {
    keeper = new MutationObserver(showHeldTitle);
    keeper.observe(document.head, { childList: true, subtree: true, characterData: true });
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    held.splice(held.lastIndexOf(title), 1);
    if (held.length) showHeldTitle();
    else {
      keeper?.disconnect();
      keeper = undefined;
      if (restore) document.title = found;
    }
  };
}

/** Holds the document title while the screen is shown, once it is known. Moving between pages in
 * the app loads no new document, so each page sets its own title. */
export function useDocumentTitle(title: string | null) {
  useEffect(() => (title ? holdDocumentTitle(title) : undefined), [title]);
}
