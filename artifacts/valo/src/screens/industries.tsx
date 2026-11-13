import { Link } from 'wouter';
import { useListPublicCatalogue, getListPublicCatalogueQueryKey } from '@workspace/api-client-react';
import { ErrorState, Notice, PageHeader, Skel } from '@/components/states';

export const INDUSTRIES = [
  { slug: 'retail', name: 'Retail and trading' },
  { slug: 'food', name: 'Food and hospitality' },
  { slug: 'manufacturing', name: 'Light manufacturing' },
  { slug: 'professional-services', name: 'Professional services' },
  { slug: 'technology', name: 'Technology and digital' },
  { slug: 'logistics', name: 'Logistics and transport' },
  { slug: 'agriculture', name: 'Agriculture and agro-processing' },
  { slug: 'beauty', name: 'Beauty and personal care' },
  { slug: 'construction', name: 'Construction and trades' },
  { slug: 'education', name: 'Education and training' },
];

export default function Industries() {
  const cat = useListPublicCatalogue(undefined, { query: { enabled: true, queryKey: getListPublicCatalogueQueryKey() } });
  return (
    <div className="mx-auto max-w-7xl px-5 py-14 lg:px-8">
      <PageHeader eyebrow="Industries" title="Coverage by industry">
        The sectors we plan to cover, with their honest status today. Each count comes from the live catalogue.
      </PageHeader>
      {cat.isError ? <ErrorState error={cat.error} onRetry={() => cat.refetch()} /> : (
        <ul className="grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2">
          {INDUSTRIES.map((ind) => {
            const n = cat.data ? cat.data.items.filter((i) => i.industry === ind.slug).length : 0;
            return (
              <li key={ind.slug} className="flex items-center justify-between gap-4 bg-card p-5" data-testid={'row-industry-' + ind.slug}>
                <div>
                  <p className="font-medium">{ind.name}</p>
                  {cat.isLoading ? <Skel className="mt-2 h-4 w-32" /> : <p className="mt-1 text-sm text-muted-foreground">{n} released item{n === 1 ? '' : 's'}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <span className={'pill ' + (n > 0 ? 'pill-forest' : 'pill-ochre')}><span className="dot" />{n > 0 ? 'Partial' : 'Held'}</span>
                  <Link href={'/library?industry=' + ind.slug} className="btn btn-ghost btn-sm">Browse</Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <Notice className="mt-6" title="Your sector is not listed?">Sector approvals vary widely. <Link href="/services" className="underline">Send us a scoped enquiry</Link> and it is saved for staff to review.</Notice>
    </div>
  );
}
