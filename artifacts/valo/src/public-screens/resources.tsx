"use client";

import { ArrowLeft, BookOpen, ExternalLink, FileX } from "lucide-react";
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
import { KIND_LABEL, PlainText, ResourceCard, liveContent } from "@/components/resource-parts";
import { describeError } from "@/lib/describe-error";
import { formatCount, formatDay } from "@/lib/format";
import { fromServer } from "@/lib/server-data";

/** The released resources, starting from what the server read; the browser reads them itself when
 * the server could not, and every 15 seconds after (decision 0011). */
export function Resources({ initial }: { initial?: ReleasedResource[] | undefined }) {
  const q = useListReleasedResources({
    query: { queryKey: getListReleasedResourcesQueryKey(), ...liveContent, ...fromServer(initial) },
  });
  const items = q.data ?? [];
  return (
    <div className="mx-auto max-w-7xl px-5 py-14 lg:px-8">
      <GuidanceTabs current="/resources" />
      <PageHeader eyebrow="Guidance" title="Guides">
        A guide explains one topic in plain language. It appears here once it is published with its official
        sources, what it covers and its limits.
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
            {formatCount(items.length)} guide{items.length === 1 ? "" : "s"}
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
            <Link href="/workspace" className="underline underline-offset-2">
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
                <span className="pill pill-ink">Sources checked {formatDay(r.reviewedAt)}</span>
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
                  <h2 className="eyebrow">What it covers</h2>
                  <p className="mt-2 whitespace-pre-line">{r.scope}</p>
                </div>
                <div>
                  <h2 className="eyebrow">Limits you should know</h2>
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
                  <p className="mt-2 text-sm text-muted-foreground">This guide lists no sources.</p>
                )}
              </div>
              <Notice title="How it was written and checked">
                <p className="whitespace-pre-line">{r.disclosure}</p>
              </Notice>
            </aside>
          </article>
        ) : null}
      </div>
    </div>
  );
}
