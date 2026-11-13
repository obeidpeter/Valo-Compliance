import { useMemo, useState } from 'react';
import { CheckCircle2, CircleDashed } from 'lucide-react';
import { useGetBuildStatus, useHealthCheck, useGetRequirementsRegister, useGetContentRegister } from '@workspace/api-client-react';
import { ErrorState, PageHeader, Skel } from '@/components/states';

export default function Development() {
  const s = useGetBuildStatus();
  const h = useHealthCheck();
  const register = useGetRequirementsRegister({ query: { retry: false } });
  const content = useGetContentRegister({ query: { retry: false } });
  const [search, setSearch] = useState('');
  const [contentSearch, setContentSearch] = useState('');
  const rows = useMemo(() => register.data?.requirements.filter(r =>
    `${r.id} ${r.title} ${r.exactText} ${r.acceptance}`.toLowerCase().includes(search.toLowerCase())) ?? [], [register.data, search]);
  const contentRows = useMemo(() => content.data?.rows.filter(r =>
    `${r.id} ${r.title} ${r.kind} ${r.relatedIds.join(' ')}`.toLowerCase().includes(contentSearch.toLowerCase())) ?? [], [content.data, contentSearch]);
  const d = s.data;
  const pct = d && d.expectedRequirements > 0 ? Math.round((d.receivedRequirements / d.expectedRequirements) * 1000) / 10 : 0;
  return (
    <div className="mx-auto max-w-5xl px-5 py-14 lg:px-8">
      <PageHeader eyebrow="Build status" title="Where Valo actually stands.">Figures below are read live from the service, not written by hand.</PageHeader>
      {s.isLoading ? <Skel className="h-64" /> : s.isError ? <ErrorState error={s.error} onRetry={() => s.refetch()} /> : d && (
        <div className="grid gap-4">
          <div className="surface p-7">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div><p className="eyebrow">Requirements received</p><p className="font-display mt-2 text-5xl" data-testid="text-requirements">{d.receivedRequirements}<span className="text-muted-foreground"> / {d.expectedRequirements}</span></p></div>
              <span className="font-mono text-sm text-muted-foreground">{pct}%</span>
            </div>
            <div className="mt-5 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full origin-left rounded-full bg-primary transition-transform duration-700" style={{ transform: 'scaleX(' + pct / 100 + ')' }} /></div>
            <p className="mt-5 text-sm text-muted-foreground" data-testid="text-notice">{d.notice}</p>
          </div>
          <ul className="grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2">
            <Gate label="Published templates" value={String(d.publishedTemplates)} ok={d.publishedTemplates > 0} />
            <Gate label="P0 release gate passed" value={d.p0Passed ? 'Yes' : 'No'} ok={d.p0Passed} />
            <Gate label="Release 2 unlocked" value={d.r2Unlocked ? 'Yes' : 'No'} ok={d.r2Unlocked} />
            <Gate label="Live payments" value={d.livePaymentsEnabled ? 'On' : 'Off'} ok={d.livePaymentsEnabled} />
            <Gate label="Document export" value="Unavailable" ok={false} />
            <Gate label="API health" value={h.isLoading ? 'Checking' : h.data?.status ?? 'Unreachable'} ok={h.data?.status === 'ok'} />
          </ul>
        </div>
      )}
      <section className="mt-10" aria-labelledby="requirements-title">
        <h2 id="requirements-title" className="font-display text-3xl">Live requirements register</h2>
        <p className="mt-3 text-sm text-muted-foreground">Receipt and implementation links are not acceptance. Partial work stays blocked until the complete criterion has evidence. This detailed register is available only in development.</p>
        <label className="mt-5 block text-sm" htmlFor="requirement-search">Find a requirement</label>
        <input id="requirement-search" className="mt-2 w-full rounded-lg border border-border bg-card p-3" value={search} onChange={e => setSearch(e.target.value)} placeholder="ID, title or exact criterion" />
        {register.isLoading ? <Skel className="mt-4 h-32" /> : register.isError ? <ErrorState error={register.error} onRetry={() => register.refetch()} /> : (
          <div className="mt-5 space-y-3">
            <p className="font-mono text-xs text-muted-foreground">{rows.length} requirements shown</p>
            {rows.map(r => <details key={r.id} className="surface p-5">
              <summary className="cursor-pointer"><span className="font-mono text-xs">{r.id}</span> <span className="ml-2 font-medium">{r.title}</span> <span className="ml-2 text-xs text-muted-foreground">{r.release} · {r.priority} · {r.status}</span></summary>
              <p className="mt-4 text-sm">{r.exactText}</p>
              <p className="mt-3 text-sm"><strong>Accept:</strong> {r.acceptance}</p>
              {r.sourceLocator && <p className="mt-3 break-all font-mono text-xs">Source: {r.sourceLocator}</p>}
              {r.owner && <p className="mt-3 text-xs text-muted-foreground">Suggested accountable role, not recorded approval: {r.owner}</p>}
              {r.dependencies && r.dependencies.length > 0 && <p className="mt-2 text-xs text-muted-foreground">Dependencies: {r.dependencies.join(' · ')}</p>}
              <p className="mt-3 text-sm text-muted-foreground">{r.blockers.join(' · ') || 'No recorded blocker; evidence must still be evaluated.'}</p>
              {r.implementationPaths.length > 0 && <div className="mt-3 break-all text-xs"><strong>Partial implementation links:</strong>{r.implementationPaths.map(path => <p key={path} className="mt-1 font-mono">{path}</p>)}</div>}
            </details>)}
            {rows.length === 0 && <p>No matching requirement. Clear the search or try an ID.</p>}
          </div>
        )}
      </section>
      <section className="mt-10" aria-labelledby="content-register-title">
        <h2 id="content-register-title" className="font-display text-3xl">Content traceability</h2>
        <p className="mt-3 text-sm text-muted-foreground">{content.data?.notice ?? 'Held research inventory; not released content.'}</p>
        {content.data && <p className="mt-3 font-mono text-xs">{content.data.identifiedTemplates} identified template types including proposals · {content.data.regulatoryRows} source rows · {content.data.publishedTemplates} published templates</p>}
        <label className="mt-5 block text-sm" htmlFor="content-search">Find an inventory ID, mapping or title</label>
        <input id="content-search" className="mt-2 w-full rounded-lg border border-border bg-card p-3" value={contentSearch} onChange={e => setContentSearch(e.target.value)} placeholder="TPL-01, EBD-B01, SCUML…" />
        {content.isLoading ? <Skel className="mt-4 h-32" /> : content.isError ? <ErrorState error={content.error} onRetry={() => content.refetch()} /> : (
          <div className="mt-5 space-y-3">{contentRows.map(r => <details key={`${r.kind}-${r.id}`} className="surface p-5">
            <summary className="cursor-pointer"><span className="font-mono text-xs">{r.id}</span> <span className="ml-2 font-medium">{r.title}</span> <span className="ml-2 text-xs text-muted-foreground">{r.status.replaceAll('_', ' ')}</span></summary>
            <p className="mt-4 text-sm">{r.kind}</p><p className="mt-3 text-sm text-muted-foreground">{r.limitation}</p>
            {r.relatedIds.length > 0 && <p className="mt-3 font-mono text-xs">Linked inventory IDs: {r.relatedIds.join(', ')}</p>}
          </details>)}
          {contentRows.length === 0 && <p>No matching inventory row. Try an ID or clear the search.</p>}
          </div>
        )}
        {content.data && <details className="surface mt-5 p-5"><summary className="cursor-pointer">Industry taxonomy and deeper-pack targets</summary>
          <p className="mt-4 text-sm">These are coverage targets, not published guidance.</p>
          <p className="mt-3 text-sm"><strong>20 industries:</strong> {content.data.industries.join('; ')}</p>
          <p className="mt-3 text-sm"><strong>Six deeper-pack targets:</strong> {content.data.deeperPacks.join('; ')}</p>
        </details>}
      </section>
      <section className="mt-10" aria-labelledby="conflict-title">
        <h2 id="conflict-title" className="font-display text-3xl">Compatibility and conflict register</h2>
        <div className="mt-5 space-y-3">{register.data?.conflicts.map(c => <details key={c.id} className="surface p-5">
          <summary className="cursor-pointer"><span className="font-mono text-xs">{c.id}</span> <span className="ml-2 font-medium">{c.topic}</span> <span className="ml-2 text-xs text-muted-foreground">{c.status.replaceAll('_', ' ')}</span></summary>
          <p className="mt-4 text-sm">{c.issue}</p>
          <p className="mt-3 text-sm">{c.resolution ?? 'Unresolved; no successful outcome is claimed.'}</p>
          {c.blocks.length > 0 && <p className="mt-3 text-sm text-muted-foreground">Blocks: {c.blocks.join(' · ')}</p>}
        </details>)}</div>
      </section>
    </div>
  );
}

function Gate({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <li className="flex items-center justify-between gap-4 bg-card p-5">
      <span className="flex items-center gap-3">{ok ? <CheckCircle2 className="h-4 w-4 text-primary" /> : <CircleDashed className="h-4 w-4 text-muted-foreground" />}{label}</span>
      <span className="font-mono text-sm">{value}</span>
    </li>
  );
}
