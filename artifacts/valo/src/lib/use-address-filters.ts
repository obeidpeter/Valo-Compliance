"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { clippedSearch, filteredHref, pickedFilter, typedSearch } from "./page-filters";

/** A page's view: what is searched for, and each of its other filters by name. */
type View<K extends string> = { q: string } & Record<K, string>;

/** A page with a search alone: one list for every render, as a page's own list of filters is. */
const NONE: readonly never[] = [];

/**
 * WEB-002: "search/filter URLs must be shareable." A page's search and its other filters, kept in
 * the page's address as the library keeps its own. The address a visitor copies opens the view they
 * see, and the browser's Back button undoes a change.
 *
 * `draft` is what is in the search box. It filters the page at once, and the address follows a
 * moment after the visitor stops typing. `others` names the page's other filters: pass the same
 * list each time.
 */
export function useAddressFilters<K extends string = never>(path: string, others: readonly K[] = NONE) {
  // The server renders a page with its request's address, so its HTML holds the view asked for.
  const search = useSearchParams()?.toString() ?? "";
  const filters = useMemo(() => {
    const sp = new URLSearchParams(search);
    return {
      q: typedSearch(sp),
      ...Object.fromEntries(others.map((key) => [key, pickedFilter(sp, key)])),
    } as View<K>;
  }, [search, others]);
  const [draft, setDraft] = useState(filters.q);
  // The search this page itself last put in the address. Any other change to it, such as the Back
  // button's, is not the visitor's typing, and refills the box.
  const own = useRef(filters.q);
  useEffect(() => {
    if (filters.q === own.current) return;
    own.current = filters.q;
    setDraft(filters.q);
  }, [filters.q]);

  /** Opens the view with these filters changed, keeping what is typed in the search box. */
  function go(next: Partial<View<K>>, typed = draft) {
    const view = { ...filters, q: typed, ...next };
    own.current = clippedSearch(view.q);
    window.history.pushState(null, "", filteredHref(path, view));
  }
  useEffect(() => {
    if (clippedSearch(draft) === filters.q) return;
    const handle = window.setTimeout(() => go({}), 300);
    return () => window.clearTimeout(handle);
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- `go` is made again on every render, and reads only the draft and the filters
  }, [draft, filters]);

  return {
    filters,
    draft,
    setDraft,
    go,
    /** The page with nothing searched for and no filter chosen. */
    clear: () => {
      setDraft("");
      go(Object.fromEntries(others.map((key) => [key, ""])) as Partial<View<K>>, "");
    },
  };
}
