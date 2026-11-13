import { Link } from 'wouter';
import { useListPublicCatalogue, getListPublicCatalogueQueryKey } from '@workspace/api-client-react';
import { ErrorState, PageHeader, Skel } from '@/components/states';

const TOPICS = ['Registering a business name or company', 'Tax identification and filing', 'Hiring and staff records', 'Handling customer personal data', 'Premises and local permits', 'Importing goods'];

export default function Resources() {
  const params = { type: 'guidance' as const };
  const cat = useListPublicCatalogue(params, { query: { enabled: true, queryKey: getListPublicCatalogueQueryKey(params) } });
  const n = cat.data?.total ?? 0;
  return (
    <div className="mx-auto max-w-7xl px-5 py-14 lg:px-8">
      <PageHeader eyebrow="Resources" title="Guidance topics and their status">
        Plain-language explainers will live here once each is sourced and reviewed.
      </PageHeader>
      <div className="surface mb-8 flex flex-wrap items-center justify-between gap-4 p-6">
        {cat.isLoading ? <Skel className="h-6 w-48" /> : cat.isError ? <ErrorState error={cat.error} onRetry={() => cat.refetch()} /> : (
          <p className="font-display text-2xl" data-testid="text-guidance-count">{n} guidance article{n === 1 ? '' : 's'} published</p>
        )}
        <Link href="/compliance" className="btn btn-ink btn-sm">Find official sources</Link>
      </div>
      <ul className="grid gap-3 md:grid-cols-2">
        {TOPICS.map((t, i) => (
          <li key={t} className="flex items-center justify-between gap-4 rounded-2xl border border-border p-5">
            <span className="flex items-baseline gap-4"><span className="font-mono text-xs text-muted-foreground">{String(i + 1).padStart(2, '0')}</span><span>{t}</span></span>
            <span className="pill pill-ochre shrink-0"><span className="dot" /> Not yet written</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
