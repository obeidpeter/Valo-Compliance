import { Link } from "wouter";
import { pageTitle, UNAVAILABLE_TITLE, useDocumentTitle } from "@/lib/document-title";
import { ArrowLeft, BookOpen, ExternalLink, FileX } from "lucide-react";
import {
  useListReleasedResources,
  useGetReleasedResource,
  getListReleasedResourcesQueryKey,
  getGetReleasedResourceQueryKey,
} from "@workspace/api-client-react";
import { EmptyState, ErrorState, Notice, PageHeader, Skel } from "@/components/states";
import { KIND_LABEL, PlainText, ResourceCard, fmtDay, liveContent } from "@/components/resource-parts";
import { describeError } from "@/lib/api";

export default function Resources() {
  const q = useListReleasedResources({
    query: { queryKey: getListReleasedResourcesQueryKey(), ...liveContent },
  });
  const items = q.data ?? [];
  return (
    <div className="mx-auto max-w-7xl px-5 py-14 lg:px-8">
      <PageHeader eyebrow="Resources" title="Guidance that names its sources.">
        Plain-language explainers appear here only once released with their official sources, scope and
        limitations.
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
          <p className="mb-4 text-sm text-muted-foreground" data-testid="text-resource-count">
            {items.length} released resource{items.length === 1 ? "" : "s"}
          </p>
          <ul className="grid gap-3 md:grid-cols-2">
            {items.map((r) => (
              <li key={r.id} data-testid={"card-resource-" + r.id}>
                <ResourceCard r={r} />
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div className="grid gap-4">
          <EmptyState
            mark={<BookOpen className="h-5 w-5 text-muted-foreground" />}
            title="No checked guidance is published yet"
            action={
              <>
                <Link href="/checker" className="btn btn-primary" data-testid="link-empty-checker">
                  Run the requirements checker
                </Link>
                <Link href="/compliance" className="btn btn-ghost">
                  Official sources
                </Link>
              </>
            }
          >
            Nothing has met the bar for publication, so nothing is shown here. The checker still links each
            result to its official source, and the compliance page lists the authorities to check directly.
          </EmptyState>
          <Notice title="Need a document instead?">
            Business documents live in your private workspace.{" "}
            <Link href="/workspace" className="underline underline-offset-2">
              Start a blank draft
            </Link>{" "}
            and export it when you are ready.
          </Notice>
        </div>
      )}
    </div>
  );
}

export function ResourceDetail({ slug }: { slug: string }) {
  const q = useGetReleasedResource(slug, {
    query: { queryKey: getGetReleasedResourceQueryKey(slug), ...liveContent },
  });
  const r = q.data;
  const notFound = q.isError && describeError(q.error).kind === "notFound";
  useDocumentTitle(r ? pageTitle(r.title) : notFound ? UNAVAILABLE_TITLE : null);
  return (
    <div className="mx-auto max-w-6xl px-5 py-14 lg:px-8">
      <Link
        href="/resources"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        data-testid="link-resources"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden /> Resources
      </Link>
      <div className="mt-6">
        {q.isLoading ? (
          <div className="grid gap-4" aria-busy="true">
            <Skel className="h-10 w-2/3" />
            <Skel className="h-5 w-1/2" />
            <Skel className="h-64" />
          </div>
        ) : notFound || (!q.isError && !r) ? (
          <EmptyState
            mark={<FileX className="h-5 w-5 text-muted-foreground" />}
            title="This resource is not available"
            action={
              <Link href="/resources" className="btn btn-primary">
                Back to resources
              </Link>
            }
          >
            It may have been withdrawn, or the link is wrong. Withdrawn guidance is removed from public view
            straight away.
          </EmptyState>
        ) : q.isError ? (
          <ErrorState error={q.error} title="Resource could not be loaded" onRetry={() => q.refetch()} />
        ) : r ? (
          <article className="grid gap-10 lg:grid-cols-[1fr_320px]">
            <div className="min-w-0">
              <div className="flex flex-wrap gap-2">
                <span className="pill pill-forest">{KIND_LABEL[r.kind] ?? r.kind}</span>
                <span className="pill pill-ink">Reviewed {fmtDay(r.reviewedAt)}</span>
              </div>
              <h1
                className="font-display mt-4 text-4xl leading-tight sm:text-5xl"
                data-testid="text-resource-title"
              >
                {r.title}
              </h1>
              <p className="mt-4 max-w-2xl text-lg leading-relaxed text-muted-foreground">{r.summary}</p>
              <PlainText
                text={r.body}
                className="mt-10 grid max-w-2xl gap-4 font-display text-[1.1rem] leading-relaxed"
              />
              <section className="mt-10 grid gap-6 border-t border-border pt-8 text-sm leading-relaxed">
                <div>
                  <h2 className="eyebrow">Scope</h2>
                  <p className="mt-2 whitespace-pre-line">{r.scope}</p>
                </div>
                <div>
                  <h2 className="eyebrow">Limitations</h2>
                  <p className="mt-2 whitespace-pre-line" data-testid="text-resource-limitations">
                    {r.limitations}
                  </p>
                </div>
              </section>
            </div>
            <aside className="grid gap-4 lg:sticky lg:top-24 lg:self-start">
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
                            <span className="block text-sm font-medium group-hover:underline">{s.title}</span>
                            <span className="block text-xs text-muted-foreground">{s.locator}</span>
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
                  <p className="mt-2 text-sm text-muted-foreground">No sources listed.</p>
                )}
              </div>
              <Notice title="Disclosure">
                <p className="whitespace-pre-line">{r.disclosure}</p>
              </Notice>
            </aside>
          </article>
        ) : null}
      </div>
    </div>
  );
}
