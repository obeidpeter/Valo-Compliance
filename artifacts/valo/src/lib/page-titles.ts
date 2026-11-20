/** What the server titles a page it will not describe: a private or unknown path, or a missing item. */
export const UNAVAILABLE_TITLE = "Page unavailable or private — Valo";

/** "<name> — Valo", as the server titles a released item's page, unless the name already ends
 * with Valo. */
export function pageTitle(name: string) {
  return name.endsWith("Valo") ? name : `${name} — Valo`;
}
