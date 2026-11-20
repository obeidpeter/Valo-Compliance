/**
 * The public pages the server renders (decision 0011), each with its own route under app/(public).
 * Every other page renders in the browser app. Moving between the two loads the new page in full: a
 * server-rendered page links to a browser page with a plain link, the browser app links to a
 * server-rendered page with a plain link, and the browser app hands any other way it reaches one to
 * the server with a reload (components/server-page.tsx).
 */
export const SERVER_PAGES: readonly string[] = [
  "/terms",
  "/about",
  "/help",
  "/contact",
  "/privacy",
  "/pricing",
];

/** Whether the server renders the page at this address, ignoring its query and fragment. */
export function isServerPage(href: string) {
  return SERVER_PAGES.includes(href.split(/[?#]/)[0] ?? "");
}
