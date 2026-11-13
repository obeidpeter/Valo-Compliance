import { Link } from 'wouter';
import { ExternalLink, Scale } from 'lucide-react';
import { useGetBuildStatus, useListPublicCatalogue, getListPublicCatalogueQueryKey } from '@workspace/api-client-react';
import { EmptyState, ErrorState, Notice, PageHeader, Skel } from '@/components/states';

export const OFFICIAL_SOURCES = [
  { name: 'Corporate Affairs Commission', topic: 'Business names, companies and annual returns', url: 'https://www.cac.gov.ng' },
  { name: 'Federal Inland Revenue Service', topic: 'Federal taxes and TIN', url: 'https://www.firs.gov.ng' },
  { name: 'Nigeria Data Protection Commission', topic: 'Handling personal data', url: 'https://ndpc.gov.ng' },
  { name: 'SMEDAN', topic: 'Small business support programmes', url: 'https://smedan.gov.ng' },
  { name: 'Standards Organisation of Nigeria', topic: 'Product standards and certification', url: 'https://son.gov.ng' },
  { name: 'NAFDAC', topic: 'Food, drugs and regulated products', url: 'https://www.nafdac.gov.ng' },
];

export default function Compliance() {
  const status = useGetBuildStatus();
  const params = { type: 'guidance' as const };
  const guidance = useListPublicCatalogue(params, { query: { enabled: true, queryKey: getListPublicCatalogueQueryKey(params) } });

  return (
    <div className="mx-auto max-w-7xl px-5 py-14 lg:px-8">
      <PageHeader eyebrow="Compliance guidance" title="No rule is shown until it can name its source.">
        Guidance coverage is currently held. This page tells you what that means and where to check the official position today.
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <section>
          {guidance.isLoading ? <Skel className="h-56" /> : guidance.isError ? <ErrorState error={guidance.error} onRetry={() => guidance.refetch()} /> : guidance.data && guidance.data.items.length > 0 ? (
            <ul className="grid gap-3">
              {guidance.data.items.map((g) => (
                <li key={g.id} className="surface p-5"><p className="font-display text-xl">{g.title}</p><p className="mt-1 text-sm text-muted-foreground">{g.summary}</p></li>
              ))}
            </ul>
          ) : (
            <EmptyState mark={<Scale className="h-5 w-5 text-muted-foreground" />} title="Coverage held: zero rules published" action={<Link href="/services" className="btn btn-ink">Ask about a specific obligation</Link>}>
              Each rule must link to its official source and pass review before it is shown. None have been released, so none are shown. Nothing here is a summary of the law.
            </EmptyState>
          )}
          <Notice className="mt-4" title="What this means for you">
            Valo cannot yet tell you which rules apply to your business. Please confirm your obligations directly with the relevant authority or a qualified professional.
          </Notice>
        </section>

        <aside className="surface p-6 sm:p-7">
          <p className="eyebrow">Official sources</p>
          <p className="mt-2 text-sm text-muted-foreground">Go straight to the authority. These are links, not endorsements, and none of these bodies has reviewed Valo.</p>
          <ul className="mt-5 divide-y divide-border">
            {OFFICIAL_SOURCES.map((s) => (
              <li key={s.url}>
                <a href={s.url} target="_blank" rel="noopener noreferrer" className="group flex items-start justify-between gap-4 py-3.5" data-testid={'link-source-' + s.name.split(' ')[0].toLowerCase()}>
                  <span><span className="block font-medium group-hover:underline">{s.name}</span><span className="block text-sm text-muted-foreground">{s.topic}</span></span>
                  <ExternalLink className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
                </a>
              </li>
            ))}
          </ul>
          <div className="mt-5 border-t border-border pt-4 text-xs text-muted-foreground">
            {status.isLoading ? <Skel className="h-4 w-40" /> : status.data ? <>Published templates: <span className="font-mono">{status.data.publishedTemplates}</span> · Release gate passed: <span className="font-mono">{status.data.p0Passed ? 'yes' : 'no'}</span></> : 'Build status unavailable.'}
          </div>
        </aside>
      </div>
    </div>
  );
}
