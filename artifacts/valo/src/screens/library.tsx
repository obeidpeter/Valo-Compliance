import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import { BookOpen, Search, X } from 'lucide-react';
import { useListPublicCatalogue, getListPublicCatalogueQueryKey, useGetPublicCoverage, ListPublicCatalogueType, type ListPublicCatalogueParams } from '@workspace/api-client-react';
import { EmptyState, ErrorState, Notice, PageHeader, Skel } from '@/components/states';

const TYPES: { v: ListPublicCatalogueType; l: string }[] = [
  { v: 'all', l: 'Everything' }, { v: 'template', l: 'Templates' }, { v: 'guidance', l: 'Guidance' }, { v: 'service', l: 'Services' },
];

export default function Library() {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const sp = new URLSearchParams(search);
  const q = sp.get('q') ?? '';
  const typeRaw = sp.get('type') ?? 'all';
  const type = (TYPES.some((t) => t.v === typeRaw) ? typeRaw : 'all') as ListPublicCatalogueType;
  const industry = sp.get('industry') ?? '';
  const page = Math.max(1, Number(sp.get('page')) || 1);
  const [draft, setDraft] = useState(q);
  useEffect(() => setDraft(q), [q]);

  const params: ListPublicCatalogueParams = { type, page, ...(q ? { q } : {}), ...(industry ? { industry } : {}) };
  const cat = useListPublicCatalogue(params, { query: { enabled: true, queryKey: getListPublicCatalogueQueryKey(params), refetchInterval: 15000, refetchOnWindowFocus: true } });
  const coverage = useGetPublicCoverage({ query:{retry:false,staleTime:60000} });
  const unknownIndustry = !!industry && !coverage.data?.industries.some(i => i.slug === industry);

  function go(next: Record<string, string | number | undefined>) {
    const merged = new URLSearchParams();
    const all = { q, type, industry, page: 1, ...next } as Record<string, string | number | undefined>;
    Object.entries(all).forEach(([k, v]) => {
      if (v === undefined || v === '' || (k === 'type' && v === 'all') || (k === 'page' && v === 1)) return;
      merged.set(k, String(v));
    });
    const s = merged.toString();
    setLocation('/library' + (s ? '?' + s : ''));
  }
  function submit(e: FormEvent) { e.preventDefault(); go({ q: draft.trim().slice(0, 120) }); }
  const filtered = !!(q || industry || type !== 'all');
  const d = cat.data;
  const pageSize = d && d.items.length ? d.items.length : 20;
  const hasMore = d ? d.page * pageSize < d.total : false;

  return (
    <div className="mx-auto max-w-7xl px-5 py-14 lg:px-8">
      <PageHeader eyebrow="Library" title="Released templates and sourced guidance">
        Every item here opens to a safe preview. Business documents are operational drafts, not legal guidance.
      </PageHeader>

      <form onSubmit={submit} className="surface grid gap-3 p-3 sm:grid-cols-[1fr_auto_auto] sm:items-center" role="search">
        <label className="relative">
          <span className="sr-only">Search the library</span>
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input type="search" value={draft} maxLength={120} onChange={(e) => setDraft(e.target.value)} placeholder="Search by name, topic or keyword" className="field !border-transparent !bg-transparent pl-11" data-testid="input-search" />
        </label>
        <select aria-label="Industry" className="field sm:w-56" value={industry} disabled={coverage.isLoading || coverage.isError} onChange={(e) => go({ industry: e.target.value })} data-testid="select-industry">
          <option value="">All industries</option>
          {unknownIndustry && <option value={industry}>Selected filter: {industry}</option>}
          {coverage.data?.industries.map((i) => <option key={i.id} value={i.slug}>{i.title}</option>)}
        </select>
        <button className="btn btn-primary" type="submit" data-testid="button-search">Search</button>
      </form>
      {coverage.isError && <div className="mt-3"><ErrorState error={coverage.error} title="Industry filters unavailable" onRetry={() => coverage.refetch()} /></div>}
      {unknownIndustry && coverage.data && <p className="mt-3 text-sm text-muted-foreground">This saved industry filter is not in the current taxonomy. It is preserved in the URL; choose a listed category or clear filters. No different activity is inferred.</p>}

      <div className="mt-4 flex flex-wrap items-center gap-2" role="tablist" aria-label="Type">
        {TYPES.map((t) => (
          <button key={t.v} role="tab" aria-selected={type === t.v} onClick={() => go({ type: t.v })} className={'rounded-full border px-4 py-1.5 text-sm transition-colors ' + (type === t.v ? 'border-foreground bg-foreground text-background' : 'border-border hover:bg-secondary')} data-testid={'tab-type-' + t.v}>{t.l}</button>
        ))}
        {filtered && <button className="ml-1 inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-2 hover:underline" onClick={() => setLocation('/library')} data-testid="button-clear-filters"><X className="h-3.5 w-3.5" /> Clear</button>}
      </div>

      <div className="mt-10">
        {cat.isLoading ? (
          <div className="grid gap-3">{[0, 1, 2].map((i) => <Skel key={i} className="h-24" />)}</div>
        ) : cat.isError ? (
          <ErrorState error={cat.error} onRetry={() => cat.refetch()} />
        ) : d && d.items.length > 0 ? (
          <>
            <p className="mb-4 text-sm text-muted-foreground" data-testid="text-result-count">{d.total} result{d.total === 1 ? '' : 's'}</p>
            <ul className="grid gap-3">
              {d.items.map((it) => (
                <li key={it.id} data-testid={'card-item-' + it.id}>
                  <Link href={(it.type === 'guidance' ? '/resources/' : '/library/') + encodeURIComponent(it.slug)} className="surface block p-5 transition-colors hover:bg-secondary/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" data-testid={'link-item-' + it.slug}>
                  <div className="flex flex-wrap items-center gap-2"><span className="pill pill-forest">{it.type}</span><span className="pill pill-ink">{it.industry}</span></div>
                  <p className="font-display mt-3 text-xl">{it.title}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{it.summary}</p>
                  </Link>
                </li>
              ))}
            </ul>
            <div className="mt-6 flex justify-between">
              <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => go({ page: page - 1 })} data-testid="button-prev">Previous</button>
              <button className="btn btn-ghost btn-sm" disabled={!hasMore} onClick={() => go({ page: page + 1 })} data-testid="button-next">Next</button>
            </div>
          </>
        ) : (
          <div className="grid gap-4">
            <EmptyState
              mark={<BookOpen className="h-5 w-5 text-muted-foreground" />}
              title={filtered ? 'Nothing released matches this search' : 'No templates have been released yet'}
              action={<><Link href="/sign-up" className="btn btn-primary">Write your own draft</Link><Link href="/workspace" className="btn btn-ghost">Open your workspace</Link></>}
            >
              {filtered ? 'Nothing in the released catalogue matches. Try a broader search, or start a blank private draft instead.' : 'Nothing is in the public catalogue right now. You can still write a private business draft from scratch and export it from your workspace.'}
            </EmptyState>
            <Notice title="Two kinds of download">
              Private drafts you write in your workspace can be exported now. Blank catalogue files are offered only for items actually listed here.
            </Notice>
          </div>
        )}
      </div>
    </div>
  );
}
