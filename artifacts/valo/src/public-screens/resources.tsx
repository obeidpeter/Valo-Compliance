"use client";

import { useEffect, useRef } from "react";
import { ArrowLeft, BookOpen, ExternalLink, FileX, Search, X } from "lucide-react";
import {
  useListReleasedResources,
  useGetReleasedResource,
  getListReleasedResourcesQueryKey,
  getGetReleasedResourceQueryKey,
  type ReleasedResource,
} from "@workspace/api-client-react";
import { GuidanceTabs } from "@/components/guidance-tabs";
import { PublicLink as Link } from "@/components/public-link";
import { EmptyState, ErrorState, Notice, PageHeader, Skel } from "@/components/states";
import {
  KIND_LABEL,
  PlainText,
  ResourceCard,
  resourceCheckLabel,
  liveContent,
} from "@/components/resource-parts";
import { describeError } from "@/lib/describe-error";
import { formatCount, formatDay } from "@/lib/format";
import { industryName } from "@/lib/library-filters";
import { fromServer } from "@/lib/server-data";
import { SEARCH_LENGTH } from "@/lib/page-filters";
import { useAddressFilters } from "@/lib/use-address-filters";
import { ANY_DOCUMENT, signUpFor } from "@/lib/start";
import { updatedLine } from "@/lib/library-change";
import { pageHeadings, relatedTemplatesHint, sourceLine } from "@/lib/guidance-record";

/** The guides page's filter beside its search (WEB-002: both are kept in its address). */
const GUIDE_FILTERS = ["industry"] as const;

/** The released resources, starting from what the server read; the browser reads them itself when
 * the server could not, and every 15 seconds after (decision 0011). */
export function Resources({ initial }: { initial?: ReleasedResource[] | undefined }) {
  const q = useListReleasedResources({
    query: { queryKey: getListReleasedResourcesQueryKey(), ...liveContent, ...fromServer(initial) },
  });
  const items = q.data ?? [];
  const address = useAddressFilters("/resources", GUIDE_FILTERS);
  const selectedIndustry = address.filters.industry,
    searchQuery = address.draft;
  const searchRef = useRef<HTMLInputElement>(null);
  const industries = [...new Set(items.flatMap((r) => r.industrySlugs))].sort();
  const hasGeneral = items.some((r) => r.industrySlugs.length === 0);
  const selected =
    industries.includes(selectedIndustry) || (selectedIndustry === "general" && hasGeneral)
      ? selectedIndustry
      : "";
  const trimmedSearch = searchQuery.trim().toLowerCase();
  const visible = items.filter((r) => {
    if (selected) {
      const industryMatch =
        selected === "general" ? r.industrySlugs.length === 0 : r.industrySlugs.includes(selected);
      if (!industryMatch) return false;
    }
    if (trimmedSearch) {
      const haystack = `${r.title} ${r.summary} ${r.industrySlugs.join(" ")}`.toLowerCase();
      if (!haystack.includes(trimmedSearch)) return false;
    }
    return true;
  });
  useEffect(() => {
    if (items.length === 0) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && /INPUT|TEXTAREA|SELECT/.test(target.tagName)) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items.length]);
  const hasActiveFilter = Boolean(selected || trimmedSearch);
  return (
    <div className="mx-auto max-w-7xl px-5 py-14 lg:px-8">
      <GuidanceTabs current="/resources" />
      <PageHeader eyebrow="Guidance" title="Guides">
        Find practical steps for everyday business tasks and guidance on regulatory topics. Each guide
        explains what it covers and links to any official sources it uses.
      </PageHeader>
      {q.isLoading ? (
        <div className="grid gap-3 md:grid-cols-2" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <Skel key={i} className="h-36" />
          ))}
        </div>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : items.length > 0 ? (
        <>
          <div className="mb-5 flex flex-wrap items-end gap-3">
            <div className="relative min-w-0 flex-1 sm:max-w-md">
              <label htmlFor="guide-search" className="label">
                Search guides
              </label>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <input
                  ref={searchRef}
                  id="guide-search"
                  type="search"
                  className="field !pl-10"
                  aria-keyshortcuts="/"
                  placeholder="Search by topic or keyword (press /)"
                  value={searchQuery}
                  maxLength={SEARCH_LENGTH}
                  onChange={(e) => address.setDraft(e.target.value)}
                  data-testid="input-guide-search"
                />
              </div>
            </div>
            {industries.length > 0 && (
              <div>
                <label htmlFor="guide-industry" className="label">
                  Filter guides by industry
                </label>
                <select
                  className="field min-w-[12rem]"
                  id="guide-industry"
                  value={selected}
                  onChange={(e) => address.go({ industry: e.target.value })}
                >
                  <option value="">All industries</option>
                  {hasGeneral && <option value="general">General business</option>}
                  {industries.map((slug) => (
                    <option key={slug} value={slug}>
                      {industryName(slug.replaceAll("-", " "))}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {hasActiveFilter && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={address.clear}
                data-testid="button-clear-guide-filters"
              >
                <X className="h-4 w-4" aria-hidden="true" /> Clear
              </button>
            )}
          </div>
          <p
            className="mb-4 text-sm text-muted-foreground"
            aria-live="polite"
            data-testid="text-resource-count"
          >
            {formatCount(visible.length)} guide{visible.length === 1 ? "" : "s"}
          </p>
          {visible.length > 0 ? (
            <ul className="grid gap-3 md:grid-cols-2">
              {visible.map((r) => (
                <li key={r.id} data-testid={"card-resource-" + r.id}>
                  <ResourceCard r={r} />
                </li>
              ))}
            </ul>
          ) : (
            <div className="surface p-6 text-sm text-muted-foreground" role="status">
              <p>No guides match your current search or filter.</p>
              <button type="button" className="btn btn-ghost btn-sm mt-3" onClick={address.clear}>
                Show all guides
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="grid gap-4">
          <EmptyState
            mark={<BookOpen className="h-5 w-5 text-muted-foreground" />}
            title="No guides are published yet"
            action={
              <>
                <Link href="/checker" className="btn btn-primary" data-testid="link-empty-checker">
                  Check my requirements
                </Link>
                <Link href="/compliance" className="btn btn-ghost">
                  Official sources
                </Link>
              </>
            }
          >
            Nothing has passed its checks yet, so nothing is shown here. The requirements check still names
            the official source for each result, and the overview lists the authorities to check with
            directly.
          </EmptyState>
          <Notice title="Need a document instead?">
            Documents are made in your own workspace.{" "}
            <Link href={signUpFor(ANY_DOCUMENT)} className="underline underline-offset-2">
              Create a document
            </Link>{" "}
            and download it when you are ready.
          </Notice>
        </div>
      )}
    </div>
  );
}

/** A released resource, starting from what the server read. When the server found none, the page says
 * so at once while the browser checks again. */
export function ResourceDetail({
  slug,
  initial,
}: {
  slug: string;
  initial?: ReleasedResource | "missing" | undefined;
}) {
  const q = useGetReleasedResource(slug, {
    query: {
      queryKey: getGetReleasedResourceQueryKey(slug),
      ...liveContent,
      ...fromServer(initial === "missing" ? undefined : initial),
    },
  });
  const r = q.data;
  const notFound =
    (q.isError && describeError(q.error).kind === "notFound") || (initial === "missing" && q.isLoading);
  // A resource the server found missing is shown unavailable while the browser checks again, in the
  // server's render too, rather than as loading.
  const unavailable = notFound || (!q.isLoading && !q.isError && !r);
  return (
    <div className="mx-auto max-w-6xl px-5 py-14 lg:px-8">
      <Link
        href="/resources"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        data-testid="link-resources"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden /> Guides
      </Link>
      <div className="mt-6">
        {unavailable ? (
          <EmptyState
            mark={<FileX className="h-5 w-5 text-muted-foreground" />}
            title="This guide is not available"
            action={
              <Link href="/resources" className="btn btn-primary">
                Back to guides
              </Link>
            }
          >
            It may have been withdrawn, or the link may be wrong. A withdrawn guide is taken off the site
            straight away.
          </EmptyState>
        ) : q.isLoading ? (
          <div className="grid gap-4" aria-busy="true">
            <Skel className="h-10 w-2/3" />
            <Skel className="h-5 w-1/2" />
            <Skel className="h-64" />
          </div>
        ) : q.isError ? (
          <ErrorState error={q.error} title="This guide could not be loaded" onRetry={() => q.refetch()} />
        ) : r ? (
          <article className="grid gap-10 lg:grid-cols-[1fr_320px]">
            <div className="min-w-0">
              <div className="flex flex-wrap gap-2">
                <span className="pill pill-forest">{KIND_LABEL[r.kind] ?? r.kind}</span>
                <span className="pill pill-ink">
                  {resourceCheckLabel(r)} {formatDay(r.reviewedAt)}
                </span>
              </div>
              <h1
                className="font-display mt-4 text-4xl leading-tight sm:text-5xl"
                data-testid="text-resource-title"
              >
                {r.title}
              </h1>
              {r.publicationMethod !== "manual" && (
                <p className="mt-4 max-w-2xl text-lg leading-relaxed text-muted-foreground">{r.summary}</p>
              )}
              {/* A version released after an earlier one says what changed (CMP-005). */}
              {r.change && (
                <p className="mt-6 max-w-2xl border-l-2 border-border pl-3 text-sm" data-testid="text-change">
                  {updatedLine(r.change)}
                </p>
              )}
              <PlainText
                text={r.body}
                sourceUrls={
                  r.kind === "guidance" && r.publicationMethod === "manual"
                    ? r.sources.map((s) => s.url)
                    : undefined
                }
                className="mt-10 grid max-w-2xl gap-4 font-display text-[1.1rem] leading-relaxed"
              />
              {(r.publicationMethod !== "manual" || r.kind === "guidance") && (
                <section className="mt-10 grid gap-6 border-t border-border pt-8 text-sm leading-relaxed">
                  {/* A guide released with its record says whom it is for, as its owner signed it
                      (docs/architecture/guidance-record.md, slice 2). */}
                  {r.appliesTo ? (
                    <div>
                      <h2 className="eyebrow">{pageHeadings.appliesTo}</h2>
                      <p className="mt-2 whitespace-pre-line" data-testid="text-resource-applies-to">
                        {r.appliesTo}
                      </p>
                    </div>
                  ) : (
                    <div>
                      <h2 className="eyebrow">What it covers</h2>
                      <p className="mt-2 whitespace-pre-line">{r.scope}</p>
                    </div>
                  )}
                  {r.actionEvidence && (
                    <div>
                      <h2 className="eyebrow">{pageHeadings.actionEvidence}</h2>
                      <p className="mt-2 whitespace-pre-line" data-testid="text-resource-action-evidence">
                        {r.actionEvidence}
                      </p>
                    </div>
                  )}
                  <div>
                    <h2 className="eyebrow">Limits you should know</h2>
                    <p className="mt-2 whitespace-pre-line" data-testid="text-resource-limitations">
                      {r.limitations}
                    </p>
                  </div>
                  {r.relatedTemplates && r.relatedTemplates.length > 0 && (
                    <div>
                      <h2 className="eyebrow">{pageHeadings.relatedTemplates}</h2>
                      <p className="mt-2 text-muted-foreground">{relatedTemplatesHint}</p>
                      <ul className="mt-2 grid gap-1" data-testid="list-resource-related-templates">
                        {r.relatedTemplates.map((template) => (
                          <li key={template.number}>
                            <Link href={template.href} className="underline">
                              {template.title}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </section>
              )}
            </div>
            <aside className="grid gap-4 lg:sticky lg:top-24 lg:self-start">
              {(r.sources.length > 0 || (r.publicationMethod !== "manual" && r.kind !== "guide")) && (
                <div className="surface p-5">
                  <p className="eyebrow">Sources</p>
                  {r.sources.length ? (
                    <ul className="mt-3 divide-y divide-border">
                      {r.sources.map((s, i) => (
                        <li key={i} className="py-3">
                          <a
                            href={s.url}
                            target="_blank"
                            rel="noopener noreferrer nofollow"
                            className="group flex items-start justify-between gap-3"
                            data-testid={"link-resource-source-" + i}
                          >
                            <span>
                              <span className="block text-sm font-medium group-hover:underline">
                                {s.title}
                              </span>
                              <span className="block text-xs text-muted-foreground">{s.locator}</span>
                              {sourceLine(s) && (
                                <span
                                  className="block text-xs text-muted-foreground"
                                  data-testid={"text-resource-source-issuer-" + i}
                                >
                                  {sourceLine(s)}
                                </span>
                              )}
                            </span>
                            <ExternalLink
                              className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                              aria-hidden
                            />
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-sm text-muted-foreground">This guide lists no sources.</p>
                  )}
                </div>
              )}
              <Notice
                title={r.publicationMethod === "manual" ? "Publisher" : "How it was written and checked"}
              >
                <p className="whitespace-pre-line">{r.disclosure}</p>
              </Notice>
            </aside>
          </article>
        ) : null}
      </div>
    </div>
  );
}
