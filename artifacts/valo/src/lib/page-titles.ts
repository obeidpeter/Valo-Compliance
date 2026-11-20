/** What the server titles a page it will not describe: a private or unknown path, or a missing item. */
export const UNAVAILABLE_TITLE = "Page unavailable or private — Valo";

/** "<name> — Valo", as the server titles a page, unless the name already starts or ends with
 * Valo, as the home page's and "About Valo" do. */
export function pageTitle(name: string) {
  return name.startsWith("Valo ") || name.endsWith("Valo") ? name : `${name} — Valo`;
}
