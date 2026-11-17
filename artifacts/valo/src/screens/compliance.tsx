import { Link } from "wouter";
import { ExternalLink, Scale } from "lucide-react";
import { useListPublicCatalogue, getListPublicCatalogueQueryKey } from "@workspace/api-client-react";
import { EmptyState, ErrorState, Notice, PageHeader, Skel } from "@/components/states";

export const OFFICIAL_SOURCES = [
  {
    name: "Corporate Affairs Commission",
    topic: "Business names, companies and annual returns",
    url: "https://www.cac.gov.ng",
  },
  { name: "Federal Inland Revenue Service", topic: "Federal taxes and TIN", url: "https://www.firs.gov.ng" },
  { name: "Nigeria Data Protection Commission", topic: "Handling personal data", url: "https://ndpc.gov.ng" },
  { name: "SMEDAN", topic: "Small business support programmes", url: "https://smedan.gov.ng" },
  {
    name: "Standards Organisation of Nigeria",
    topic: "Product standards and certification",
    url: "https://son.gov.ng",
  },
  { name: "NAFDAC", topic: "Food, drugs and regulated products", url: "https://www.nafdac.gov.ng" },
];

export default function Compliance() {
  const params = { type: "guidance" as const };
  const guidance = useListPublicCatalogue(params, {
    query: { enabled: true, queryKey: getListPublicCatalogueQueryKey(params) },
  });

  return (
    <div className="mx-auto max-w-7xl px-5 py-14 lg:px-8">
      <PageHeader eyebrow="Compliance guidance" title="No rule is shown until it can name its source.">
        Valo shows a rule only when it links to the official text it came from. Below is what is released
        today, and where to check the official position directly.
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
              title="No checked regulatory guidance is published yet"
              action={
                <>
                  <Link href="/checker" className="btn btn-primary">
                    Run the requirements checker
                  </Link>
                  <Link href="/resources" className="btn btn-ghost">
                    Browse resources
                  </Link>
                </>
              }
            >
              Nothing has met the bar for publication yet, so nothing is shown. The checker can still point
              you to official routes based on your answers.
            </EmptyState>
          )}
          <Notice className="mt-4" title="What this means for you">
            Valo cannot yet tell you which rules apply to your business. Please confirm your obligations
            directly with the relevant authority.
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
                  data-testid={"link-source-" + s.name.split(" ")[0].toLowerCase()}
                >
                  <span>
                    <span className="block font-medium group-hover:underline">{s.name}</span>
                    <span className="block text-sm text-muted-foreground">{s.topic}</span>
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
