"use client";

import { ArrowLeft, ArrowRight, FileText, Scale } from "lucide-react";
import {
  useGetPublicCoverage,
  useListReleasedResources,
  useListPublicCatalogue,
  getListReleasedResourcesQueryKey,
  getListPublicCatalogueQueryKey,
  type CataloguePage,
  type PublicCoverage,
  type ReleasedResource,
} from "@workspace/api-client-react";
import { GuidanceTabs } from "@/components/guidance-tabs";
import { PublicLink as Link } from "@/components/public-link";
import { EmptyState, ErrorState, Notice, PageHeader, Skel } from "@/components/states";
import { ResourceCard, liveContent } from "@/components/resource-parts";
import { industryTemplatesParams } from "@/lib/catalogue-requests";
import { formatCount } from "@/lib/format";
import { industryName } from "@/lib/library-filters";
import { fromServer } from "@/lib/server-data";

/** What an industry page starts from: the reads the server made, each missing if it failed. */
export type IndustryReads = {
  coverage?: PublicCoverage | undefined;
  resources?: ReleasedResource[] | undefined;
};

/** The industries and how much released guidance each has, starting from what the server read; the
 * browser reads what the server could not (decision 0011). */
export function Industries({ initial }: { initial: IndustryReads }) {
  const coverage = useGetPublicCoverage({
    query: { retry: false, staleTime: 60000, ...(initial.coverage ? { initialData: initial.coverage } : {}) },
  });
  const res = useListReleasedResources({
    query: { queryKey: getListReleasedResourcesQueryKey(), ...liveContent, ...fromServer(initial.resources) },
  });
  const counts = new Map<string, number>();
  (res.data ?? []).forEach((r) => r.industrySlugs.forEach((s) => counts.set(s, (counts.get(s) ?? 0) + 1)));
  return (
    <div className="mx-auto max-w-7xl px-5 py-14 lg:px-8">
      <GuidanceTabs current="/industries" />
      <PageHeader eyebrow="Guidance" title="Guidance by industry">
        Each industry page brings together published guidance and any matching templates. Where nothing has
        been checked, the page says so.
      </PageHeader>
      {coverage.isLoading ? (
        <Skel className="h-64" />
      ) : coverage.isError ? (
        <ErrorState error={coverage.error} onRetry={() => coverage.refetch()} />
      ) : (
        <ul className="grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
          {coverage.data?.industries.map((ind) => {
            const n = counts.get(ind.slug) ?? 0;
            return (
              <li key={ind.slug} data-testid={"row-industry-" + ind.slug}>
                <Link
                  href={"/industries/" + encodeURIComponent(ind.slug)}
                  className="group flex h-full items-center justify-between gap-4 bg-card p-5 transition-colors hover:bg-secondary/60 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
                >
                  <div className="min-w-0">
                    <p className="break-words font-medium">{industryName(ind.title)}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {n > 0 ? `${formatCount(n)} guide${n === 1 ? "" : "s"}` : "No guides yet"}
                    </p>
                  </div>
                  <ArrowRight
                    className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                    aria-hidden
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {coverage.data?.ngoNotice && (
        <Notice className="mt-6" title="Nonprofits">
          {coverage.data.ngoNotice}
        </Notice>
      )}
    </div>
  );
}

/** An industry's released guidance and templates, starting from what the server read; the browser
 * reads what the server could not (decision 0011). */
export function IndustryDetail({
  slug,
  initial,
}: {
  slug: string;
  initial: IndustryReads & { templates?: CataloguePage | undefined };
}) {
  const coverage = useGetPublicCoverage({
    query: { retry: false, staleTime: 60000, ...(initial.coverage ? { initialData: initial.coverage } : {}) },
  });
  const res = useListReleasedResources({
    query: { queryKey: getListReleasedResourcesQueryKey(), ...liveContent, ...fromServer(initial.resources) },
  });
  const params = industryTemplatesParams(slug);
  const tpl = useListPublicCatalogue(params, {
    query: {
      queryKey: getListPublicCatalogueQueryKey(params),
      ...liveContent,
      ...fromServer(initial.templates),
    },
  });
  const ind = coverage.data?.industries.find((i) => i.slug === slug);
  const resources = (res.data ?? []).filter((r) => r.industrySlugs.includes(slug));
  const templates = tpl.data?.items ?? [];

  return (
    <div className="mx-auto max-w-6xl px-5 py-14 lg:px-8">
      <Link
        href="/industries"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        data-testid="link-industries"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden /> Industries
      </Link>
      <div className="mt-6">
        {coverage.isLoading ? (
          <Skel className="h-12 w-1/2" />
        ) : (
          <PageHeader eyebrow="Industry" title={industryName(ind?.title ?? slug.replace(/-/g, " "))}>
            {coverage.data && !ind
              ? "This industry is not on the current list. Choose another from the list of industries."
              : "Published guidance and matching templates for this industry."}
          </PageHeader>
        )}
      </div>

      <section aria-labelledby="ind-guidance" className="mt-2">
        <h2 id="ind-guidance" className="flex items-center gap-2 font-display text-2xl">
          <Scale className="h-5 w-5 text-primary" aria-hidden /> Guidance
        </h2>
        <div className="mt-4">
          {res.isLoading ? (
            <Skel className="h-32" />
          ) : res.isError ? (
            <ErrorState error={res.error} onRetry={() => res.refetch()} />
          ) : resources.length ? (
            <ul className="grid gap-3 md:grid-cols-2">
              {resources.map((r) => (
                <li key={r.id}>
                  <ResourceCard r={r} />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              title="No guidance is published for this industry"
              action={
                <Link href="/checker" className="btn btn-primary">
                  Check my requirements
                </Link>
              }
            >
              Valo has not published guidance for this industry. The requirements check can still point you to
              the official authority for your answers. Please confirm what applies with the relevant
              authority.
            </EmptyState>
          )}
        </div>
      </section>

      <section aria-labelledby="ind-templates" className="mt-12">
        <h2 id="ind-templates" className="flex items-center gap-2 font-display text-2xl">
          <FileText className="h-5 w-5 text-primary" aria-hidden /> Templates
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Templates are everyday business documents. They do not tell you what the law requires.
        </p>
        <div className="mt-4">
          {tpl.isLoading ? (
            <Skel className="h-32" />
          ) : tpl.isError ? (
            <ErrorState error={tpl.error} onRetry={() => tpl.refetch()} />
          ) : templates.length ? (
            <ul className="grid gap-3 md:grid-cols-2">
              {templates.map((t) => (
                <li key={t.id}>
                  <Link
                    href={"/library/" + encodeURIComponent(t.slug)}
                    className="surface block p-5 transition-colors hover:bg-secondary/60"
                    data-testid={"link-industry-template-" + t.slug}
                  >
                    <span className="pill pill-ink">Template</span>
                    <p className="font-display mt-3 text-xl">{t.title}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{t.summary}</p>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              title="No templates for this industry yet"
              action={
                <>
                  <Link href="/workspace" className="btn btn-primary">
                    Create a document
                  </Link>
                  <Link href="/workspace/ai" className="btn btn-ghost">
                    Use the drafting assistant
                  </Link>
                </>
              }
            >
              You can still make your own invoice, quotation or letter in your workspace and download it.
            </EmptyState>
          )}
        </div>
      </section>
    </div>
  );
}
