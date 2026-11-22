"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { BookOpen, Search, X } from "lucide-react";
import {
  useListPublicCatalogue,
  getListPublicCatalogueQueryKey,
  useGetPublicCoverage,
  getListOwnedTemplateEditionsQueryKey,
  useListOwnedTemplateEditions,
  type CataloguePage,
  type PublicCoverage,
} from "@workspace/api-client-react";
import { PublicLink as Link } from "@/components/public-link";
import { PremiumTemplateCardAction } from "@/components/premium-template-card-action";
import { EmptyState, ErrorState, Notice, PageHeader, Skel } from "@/components/states";
import { useIdentity } from "@/islands/identity-store";
import { formatCount, formatNaira } from "@/lib/format";
import { templateDownloadSignInPath } from "@/lib/template-download";
import {
  catalogueParams,
  industryLabel,
  industryName,
  LIBRARY_TYPES as TYPES,
  libraryFilters,
  libraryHref,
  typeName,
} from "@/lib/library-filters";
import { fromServer } from "@/lib/server-data";
import { ANY_DOCUMENT, signUpFor } from "@/lib/start";

/**
 * The documents and guidance search. The server renders the results for the address it was asked
 * for; the browser takes over from there (decision 0011). A filter change moves the address in the
 * page and reads the catalogue from the browser, without asking the server to render the page
 * again, and the results are read again every 15 seconds. DOC-002 asks for the search, the category,
 * industry and free or premium filters, the three sort orders, and all of them kept in the address.
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
  const identity = useIdentity();
  const signedIn = identity.status === "signed-in";
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
  const ownership = useListOwnedTemplateEditions({
    query: {
      queryKey: [...getListOwnedTemplateEditionsQueryKey(), signedIn ? identity.sessionId : null],
      enabled:
        signedIn && !!cat.data?.items.some((item) => item.type === "template" && item.access === "premium"),
      gcTime: 0,
      retry: false,
      refetchInterval: 15000,
      refetchOnWindowFocus: true,
    },
  });
  const owned = new Set(signedIn && ownership.isSuccess ? ownership.data : []);
  const unknownIndustry = !!industry && !coverage.data?.industries.some((i) => i.slug === industry);
  const industryNames = new Map((coverage.data?.industries ?? []).map((i) => [i.slug, i.title] as const));

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
      <PageHeader eyebrow="Documents" title="Documents and guidance">
        Search everything Valo has published: ready-made templates, guidance, industry pages and service
        enquiries. An industry or service page being listed does not mean guidance or a provider is available
        for it.
      </PageHeader>

      <form
        onSubmit={submit}
        className="surface grid gap-3 p-3 sm:grid-cols-[1fr_auto_auto] sm:items-center"
        role="search"
      >
        <label className="relative">
          <span className="sr-only">Search documents and guidance</span>
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
              {industryName(i.title)}
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
            <option value="recently_checked">Most recent</option>
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
          This address asks for an industry that is no longer on the list. Choose a listed industry or clear
          the filters. No other industry is assumed.
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
              {formatCount(d.total)} result{d.total === 1 ? "" : "s"}
              {d.total > pageSize && `, page ${formatCount(d.page)}`}
            </p>
            <ul className="grid gap-3">
              {d.items.map((it) => (
                <li key={it.id} className="surface" data-testid={"card-item-" + it.id}>
                  <Link
                    href={
                      it.href ??
                      (["guidance", "article"].includes(it.type) ? "/resources/" : "/library/") +
                        encodeURIComponent(it.slug)
                    }
                    className="block rounded-[inherit] p-5 transition-colors hover:bg-secondary/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    data-testid={"link-item-" + it.slug}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="pill pill-forest">{typeName(it.type)}</span>
                      {industryLabel(it.industry, industryNames) && (
                        <span className="pill pill-ink">{industryLabel(it.industry, industryNames)}</span>
                      )}
                      {it.access && (
                        <span className="pill pill-ink" data-testid="card-access">
                          {it.access === "premium" ? "Premium" : "Free"}
                          {it.type === "template" &&
                            it.access === "premium" &&
                            it.amountKobo !== undefined &&
                            ` · ${formatNaira(it.amountKobo)}`}
                        </span>
                      )}
                    </div>
                    {/* An industry page is listed under the industry's name, which is in lower case. */}
                    <p className="font-display mt-3 text-xl">{industryName(it.title)}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{it.summary}</p>
                  </Link>
                  {it.type === "template" && it.access === "premium" && (
                    <PremiumTemplateCardAction item={it} owned={owned} />
                  )}
                  {it.type === "template" && it.access === "free" && it.freeDownloadPath && (
                    <div className="px-5 pb-5">
                      <Link
                        href={signedIn ? it.freeDownloadPath : templateDownloadSignInPath(it.id, it.slug)}
                        className="btn btn-ghost btn-sm"
                        data-testid="card-download"
                      >
                        {signedIn ? "Download" : "Sign in to download"}
                        <span className="sr-only"> {it.title}</span>
                      </Link>
                    </div>
                  )}
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
              title={filtered ? "Nothing matches these filters" : "Nothing is published yet"}
              action={
                <>
                  <Link href={signUpFor(ANY_DOCUMENT)} className="btn btn-primary">
                    Create a document
                  </Link>
                  <Link href="/workspace" className="btn btn-ghost">
                    Open your workspace
                  </Link>
                </>
              }
            >
              {filtered
                ? "Try a shorter word, remove a filter, or choose all access levels. Documents that are not published, and your own private documents, never appear in this search."
                : "Nothing is published right now. You can still make your own document and download it from your workspace."}
            </EmptyState>
            <Notice title="Two kinds of download">
              A document you make in your workspace can be downloaded now. A ready-made template's blank file
              is offered only when the template is listed here.
            </Notice>
          </div>
        )}
      </div>
    </div>
  );
}
