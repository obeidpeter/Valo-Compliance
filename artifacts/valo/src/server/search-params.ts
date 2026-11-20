/** A page's search parameters as Next gives them, as the query string the browser has: a key that
 * appears more than once keeps every value, in order. */
export function searchString(params: Record<string, string | string[] | undefined>) {
  const out = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    for (const one of Array.isArray(value) ? value : value === undefined ? [] : [value]) out.append(key, one);
  return out.toString();
}
