"use client";

import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";

/**
 * Progressive client-side filter for the server-rendered Help questions. Operates directly on the
 * rendered `<section data-help-group>` and `<details data-testid="faq-N">` elements so the server
 * HTML keeps every question and link intact for non-JS visitors and accessibility checks.
 */
export function HelpFilter({ total }: { total: number }) {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState(total);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && /INPUT|TEXTAREA|SELECT/.test(target.tagName)) return;
      event.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const trimmed = query.trim().toLowerCase();
    const groups = document.querySelectorAll<HTMLElement>("[data-help-group]");
    let visible = 0;
    for (const group of groups) {
      const items = group.querySelectorAll<HTMLDetailsElement>('[data-testid^="faq-"]');
      let groupVisible = 0;
      for (const item of items) {
        const text = (item.textContent ?? "").toLowerCase();
        const show = !trimmed || text.includes(trimmed);
        item.hidden = !show;
        if (show) {
          groupVisible++;
          visible++;
          if (trimmed) item.open = true;
        }
      }
      group.hidden = groupVisible === 0;
    }
    setMatches(visible);
  }, [query]);

  return (
    <div className="mb-8">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-md">
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            ref={inputRef}
            type="search"
            className="field !pl-10"
            aria-label="Filter help questions"
            aria-keyshortcuts="/"
            placeholder="Search questions (press /)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            data-testid="input-help-search"
          />
        </div>
        {query.trim() && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setQuery("")}
            data-testid="button-clear-help-search"
          >
            <X className="h-4 w-4" aria-hidden="true" /> Clear
          </button>
        )}
      </div>
      {query.trim() && (
        <p role="status" className="mt-2 text-sm text-muted-foreground" data-testid="status-help-matches">
          {matches === 0
            ? `No questions match "${query.trim()}". Try another word or use the links above.`
            : `Showing ${matches} of ${total} questions.`}
        </p>
      )}
    </div>
  );
}
