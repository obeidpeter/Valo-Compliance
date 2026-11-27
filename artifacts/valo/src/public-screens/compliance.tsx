"use client";

import { ExternalLink, Scale } from "lucide-react";
import {
  useListPublicCatalogue,
  getListPublicCatalogueQueryKey,
  type CataloguePage,
} from "@workspace/api-client-react";
import { GuidanceTabs } from "@/components/guidance-tabs";
import { PublicLink as Link } from "@/components/public-link";
import { EmptyState, ErrorState, Notice, PageHeader, Skel } from "@/components/states";
import { guidanceParams } from "@/lib/catalogue-requests";
import { fromServer } from "@/lib/server-data";

export const OFFICIAL_SOURCES: { name: string; topic: string; note?: string; url: string }[] = [
  {
    name: "Corporate Affairs Commission",
    topic: "Business names, companies and annual returns",
    url: "https://www.cac.gov.ng",
  },
  // The specification's 2026 update (docs/specification/essential-business-documents.txt): "The
  // Nigeria Revenue Service has replaced the former FIRS framework, and the new Tax ID replaces the
  // previous TIN identifier." The address is the host of its source S02.
  {
    name: "Nigeria Revenue Service",
    topic: "Federal taxes and the Tax ID",
    note: "It has replaced the Federal Inland Revenue Service (FIRS), and the Tax ID replaces the TIN.",
    url: "https://www.nrs.gov.ng",
  },
  { name: "Nigeria Data Protection Commission", topic: "Handling personal data", url: "https://ndpc.gov.ng" },
  { name: "SMEDAN", topic: "Small business support programmes", url: "https://smedan.gov.ng" },
  {
    name: "Standards Organisation of Nigeria",
    topic: "Product standards and certification",
    url: "https://son.gov.ng",
  },
  { name: "NAFDAC", topic: "Food, drugs and regulated products", url: "https://www.nafdac.gov.ng" },
];

/** A source's name for a test: the first part of its address, "nrs" for www.nrs.gov.ng. Two of the
 * sources' names begin with the same word. */
const sourceId = (url: string) => new URL(url).hostname.replace(/^www\./, "").split(".")[0]!;

/** Released guidance and the official sources, starting from what the server read; the browser
 * reads the guidance itself when the server could not (decision 0011). */
export function Compliance({ initial }: { initial?: CataloguePage | undefined }) {
  const guidance = useListPublicCatalogue(guidanceParams, {
    query: {
      enabled: true,
      queryKey: getListPublicCatalogueQueryKey(guidanceParams),
      ...fromServer(initial),
    },
  });

  return (
    <div className="mx-auto max-w-7xl px-5 py-14 lg:px-8">
      <GuidanceTabs current="/compliance" />
      <PageHeader eyebrow="Guidance" title="Guidance, and where it comes from">
        Valo shows a rule only when it can name the official text it comes from. This page has what is
        published today, and the authorities you can check with directly.
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <section>
          {guidance.isLoading ? (
            <Skel className="h-56" />
          ) : guidance.isError ? (
            <ErrorState error={guidance.error} onRetry={() => guidance.refetch()} />
          ) : guidance.data && guidance.data.items.length > 0 ? (
            <ul className="grid gap-3">
              {guidance.data.items.map((g) => (
                <li key={g.id}>
                  <Link
                    href={"/resources/" + encodeURIComponent(g.slug)}
                    className="surface block p-5 hover:bg-secondary/60"
                  >
                    <p className="font-display text-xl">{g.title}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{g.summary}</p>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              mark={<Scale className="h-5 w-5 text-muted-foreground" />}
              title="No guidance is published yet"
              action={
                <>
                  <Link href="/checker" className="btn btn-primary">
                    Check my requirements
                  </Link>
                  <Link href="/resources" className="btn btn-ghost">
                    Browse guides
                  </Link>
                </>
              }
            >
              Nothing has passed its checks yet, so nothing is shown. You can still check your requirements:
              your answers point you to the official authority to ask.
            </EmptyState>
          )}
          <Notice className="mt-4" title="What this means for you">
            Valo cannot yet tell you which rules apply to your business. Please confirm what applies directly
            with the relevant authority.
          </Notice>
        </section>

        <aside className="surface p-6 sm:p-7">
          <p className="eyebrow">Official sources</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Go straight to the authority. These are links, not endorsements, and none of these bodies has
            reviewed Valo.
          </p>
          <ul className="mt-5 divide-y divide-border">
            {OFFICIAL_SOURCES.map((s) => (
              <li key={s.url}>
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-start justify-between gap-4 py-3.5"
                  data-testid={"link-source-" + sourceId(s.url)}
                >
                  <span>
                    <span className="block font-medium group-hover:underline">{s.name}</span>
                    <span className="block text-sm text-muted-foreground">{s.topic}</span>
                    {s.note && <span className="block text-sm text-muted-foreground">{s.note}</span>}
                  </span>
                  <ExternalLink className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
                </a>
              </li>
            ))}
          </ul>
          <div className="mt-5 border-t border-border pt-4 text-xs text-muted-foreground">
            Valo does not provide legal, tax or accounting advice.
          </div>
        </aside>
      </div>
    </div>
  );
}
