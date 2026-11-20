"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { BookOpen, Search, X } from "lucide-react";
import {
  useListPublicCatalogue,
  getListPublicCatalogueQueryKey,
  useGetPublicCoverage,
  type CataloguePage,
  type PublicCoverage,
} from "@workspace/api-client-react";
import { PublicLink as Link } from "@/components/public-link";
import { EmptyState, ErrorState, Notice, PageHeader, Skel } from "@/components/states";
import { catalogueParams, LIBRARY_TYPES as TYPES, libraryFilters, libraryHref } from "@/lib/library-filters";
import { fromServer } from "@/lib/server-data";

/**
 * The library. The server renders the results for the address it was asked for; the browser takes
 * over from there (decision 0011). A filter change moves the address in the page and reads the
 * catalogue from the browser, without asking the server to render the page again, and the results
 * are read again every 15 seconds.
 */
export function Library({
  initialSearch,
  initialCatalogue,
  initialCoverage,
}: {
  initialSearch: string;
  initialCatalogue?: CataloguePage | undefined;
  initialCoverage?: PublicCoverage | undefined;
}) {
  const search = useSearchParams()?.toString() ?? initialSearch;
  const setLocation = (href: string) => window.history.pushState(null, "", href);
  const filters = libraryFilters(new URLSearchParams(search));
  const { q, type, industry, page, category, access, sort } = filters;
  // The server's results are for the address the page was first opened at.
  const serverResults = search === initialSearch ? initialCatalogue : undefined;
  const [draft, setDraft] = useState(q);
  useEffect(() => setDraft(q), [q]);

  const params = catalogueParams(filters);
  const cat = useListPublicCatalogue(params, {
    query: {
      enabled: true,
      queryKey: getListPublicCatalogueQueryKey(params),
      refetchInterval: 15000,
      refetchOnWindowFocus: true,
      ...fromServer(serverResults),
    },
  });
  const coverage = useGetPublicCoverage({
    query: { retry: false, staleTime: 60000, ...(initialCoverage ? { initialData: initialCoverage } : {}) },
  });
  const unknownIndustry = !!industry && !coverage.data?.industries.some((i) => i.slug === industry);

  function go(next: Record<string, string | number | undefined>) {
    setLocation(libraryHref(filters, next));
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    go({ q: draft.trim().slice(0, 120) });
  }
  const filtered = !!(
    q ||
    industry ||
    category ||
    type !== "all" ||
    access !== "all" ||
    sort !== "relevance"
  );
  const d = cat.data;
  // Catalogue API has a fixed 20-row page, including a short final page.
  const pageSize = 20;
  const hasMore = d ? d.page * pageSize < d.total : false;

  return (
    <div className="mx-auto max-w-7xl px-5 py-14 lg:px-8">
      <PageHeader eyebrow="Library" title="Find the right starting point">
        Search released templates and guidance, industry coverage pages, and service enquiry categories.
        Directory pages do not mean guidance or providers are available.
      </PageHeader>

      <form
        onSubmit={submit}
        className="surface grid gap-3 p-3 sm:grid-cols-[1fr_auto_auto] sm:items-center"
        role="search"
      >
        <label className="relative">
          <span className="sr-only">Search the library</span>
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={draft}
            maxLength={120}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Search by name, topic or keyword"
            className="field !border-transparent !bg-transparent pl-11"
            data-testid="input-search"
          />
        </label>
        <select
          aria-label="Industry"
          className="field sm:w-56"
          value={industry}
          disabled={coverage.isLoading || coverage.isError}
          onChange={(e) => go({ industry: e.target.value })}
          data-testid="select-industry"
        >
          <option value="">All industries</option>
          {unknownIndustry && <option value={industry}>Selected filter: {industry}</option>}
          {coverage.data?.industries.map((i) => (
            <option key={i.id} value={i.slug}>
              {i.title}
            </option>
          ))}
        </select>
        <button className="btn btn-primary" type="submit" data-testid="button-search">
          Search
        </button>
      </form>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <label className="text-sm">
          Category
          <select
            className="field mt-1"
            value={category}
            onChange={(e) => go({ category: e.target.value })}
            data-testid="select-category"
          >
            <option value="">All categories</option>
            {[
              "Finance and operations",
              "People",
              "Agreements and sales",
              "Privacy and data",
              "Business management",
              "Business guidance",
              "Industry guidance",
              "Location guidance",
              "Industry directory",
              "Service enquiries",
            ].map((v) => (
              <option key={v}>{v}</option>
            ))}
            {category &&
              ![
                "Finance and operations",
                "People",
                "Agreements and sales",
                "Privacy and data",
                "Business management",
                "Business guidance",
                "Industry guidance",
                "Location guidance",
                "Industry directory",
                "Service enquiries",
              ].includes(category) && <option value={category}>{category}</option>}
          </select>
        </label>
        <label className="text-sm">
          Access
          <select
            className="field mt-1"
            value={access}
            onChange={(e) => go({ access: e.target.value })}
            data-testid="select-access"
          >
            <option value="all">All access levels</option>
            <option value="free">Free</option>
            <option value="premium">Premium templates</option>
          </select>
        </label>
        <label className="text-sm">
          Sort by
          <select
            className="field mt-1"
            value={sort}
            onChange={(e) => go({ sort: e.target.value })}
            data-testid="select-sort"
          >
            <option value="relevance">Relevance</option>
            <option value="name">Name</option>
            <option value="recently_checked">Recently checked</option>
          </select>
        </label>
      </div>
      {coverage.isError && (
        <div className="mt-3">
          <ErrorState
            error={coverage.error}
            title="Industry filters unavailable"
            onRetry={() => coverage.refetch()}
          />
        </div>
      )}
      {unknownIndustry && coverage.data && (
        <p className="mt-3 text-sm text-muted-foreground">
          This saved industry filter is not in the current taxonomy. It is preserved in the URL; choose a
          listed category or clear filters. No different activity is inferred.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2" role="group" aria-label="Content type filters">
        {TYPES.map((t) => (
          <button
            key={t.v}
            type="button"
            aria-pressed={type === t.v}
            onClick={() => go({ type: t.v })}
            className={
              "rounded-full border px-4 py-1.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring " +
              (type === t.v
                ? "border-foreground bg-foreground text-background"
                : "border-border hover:bg-secondary")
            }
            data-testid={"tab-type-" + t.v}
          >
            {t.l}
          </button>
        ))}
        {filtered && (
          <button
            className="ml-1 inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-2 hover:underline"
            onClick={() => setLocation("/library")}
            data-testid="button-clear-filters"
          >
            <X className="h-3.5 w-3.5" /> Clear
          </button>
        )}
      </div>

      <div className="mt-10">
        {cat.isLoading ? (
          <div className="grid gap-3">
            {[0, 1, 2].map((i) => (
              <Skel key={i} className="h-24" />
            ))}
          </div>
        ) : cat.isError ? (
          <ErrorState error={cat.error} onRetry={() => cat.refetch()} />
        ) : d && d.items.length > 0 ? (
          <>
            <p className="mb-4 text-sm text-muted-foreground" data-testid="text-result-count">
              {d.total} result{d.total === 1 ? "" : "s"}
            </p>
            <ul className="grid gap-3">
              {d.items.map((it) => (
                <li key={it.id} data-testid={"card-item-" + it.id}>
                  <Link
                    href={
                      it.href ??
                      (["guidance", "article"].includes(it.type) ? "/resources/" : "/library/") +
                        encodeURIComponent(it.slug)
                    }
                    className="surface block p-5 transition-colors hover:bg-secondary/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    data-testid={"link-item-" + it.slug}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="pill pill-forest">{it.type}</span>
                      <span className="pill pill-ink">{it.industry}</span>
                      {it.access && <span className="pill pill-ink">{it.access}</span>}
                    </div>
                    <p className="font-display mt-3 text-xl">{it.title}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{it.summary}</p>
                  </Link>
                </li>
              ))}
            </ul>
            <div className="mt-6 flex justify-between">
              <button
                className="btn btn-ghost btn-sm"
                disabled={page <= 1}
                onClick={() => go({ page: page - 1 })}
                data-testid="button-prev"
              >
                Previous
              </button>
              <button
                className="btn btn-ghost btn-sm"
                disabled={!hasMore}
                onClick={() => go({ page: page + 1 })}
                data-testid="button-next"
              >
                Next
              </button>
            </div>
          </>
        ) : (
          <div className="grid gap-4">
            <EmptyState
              mark={<BookOpen className="h-5 w-5 text-muted-foreground" />}
              title={filtered ? "Nothing matches these filters" : "No public items are available"}
              action={
                <>
                  <Link href="/sign-up" className="btn btn-primary">
                    Write your own draft
                  </Link>
                  <Link href="/workspace" className="btn btn-ghost">
                    Open your workspace
                  </Link>
                </>
              }
            >
              {filtered
                ? "Try a shorter keyword, remove an industry or category filter, or choose all access levels. Unreleased documents and private drafts never appear in search."
                : "Nothing is in the public catalogue right now. You can still write a private business draft from scratch and export it from your workspace."}
            </EmptyState>
            <Notice title="Two kinds of download">
              Private drafts you write in your workspace can be exported now. Blank catalogue files are
              offered only for items actually listed here.
            </Notice>
          </div>
        )}
      </div>
    </div>
  );
}
