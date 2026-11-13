import { useMemo, useState } from 'react';
import { CheckCircle2, CircleDashed } from 'lucide-react';
import { useGetBuildStatus, useHealthCheck, useGetRequirementsRegister, useGetContentRegister, useGetProofRegister } from '@workspace/api-client-react';
import { ErrorState, PageHeader, Skel } from '@/components/states';
import { SourceEvidence } from '@/components/source-evidence';
import { useSearch } from 'wouter';

export default function Development() {
  const sourceView=new URLSearchParams(useSearch()).get('view')==='sources';
  const s = useGetBuildStatus();
  const h = useHealthCheck();
  const register = useGetRequirementsRegister({ query: { retry: false } });
  const content = useGetContentRegister({ query: { retry: false } });
  const proof = useGetProofRegister({ query: { retry: false } });
  const [search, setSearch] = useState('');
  const [contentSearch, setContentSearch] = useState('');
  const [inventoryType, setInventoryType] = useState('all');
  const [contentPage, setContentPage] = useState(1);
  const rows = useMemo(() => register.data?.requirements.filter(r =>
    `${r.id} ${r.title} ${r.exactText} ${r.acceptance}`.toLowerCase().includes(search.toLowerCase())) ?? [], [register.data, search]);
  const contentRows = useMemo(() => content.data?.rows.filter(r =>
    (inventoryType === 'all' || (inventoryType === 'regulatory' ? r.id.startsWith('REG-') : r.id.startsWith('EBD-'))) &&
    `${r.id} ${r.title} ${r.kind} ${r.relatedIds.join(' ')} ${r.overlapIds.join(' ')}`.toLowerCase().includes(contentSearch.toLowerCase())) ?? [], [content.data, contentSearch, inventoryType]);
  const contentPages = Math.max(1, Math.ceil(contentRows.length / 20));
  const visibleContentPage = Math.min(contentPage, contentPages);
  const visibleContentRows = contentRows.slice((visibleContentPage - 1) * 20, visibleContentPage * 20);
  const d = s.data;
  const pct = d && d.expectedRequirements > 0 ? Math.round((d.receivedRequirements / d.expectedRequirements) * 1000) / 10 : 0;
  return (
    <div className="mx-auto max-w-5xl px-5 py-14 lg:px-8">
      <PageHeader eyebrow="Build status" title="Where Valo actually stands.">Figures below are read live from the service, not written by hand.</PageHeader>
      <a className="mb-6 inline-block text-sm underline" href={sourceView?'/development':'/development?view=sources'}>{sourceView?'Back to requirements and release gates':'Inspect source retrieval, retention proposals and roadmap'}</a>
      {sourceView?<SourceEvidence/>:<>
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
            <Gate label="P0 export acceptance" value={d.p0Passed ? 'Accepted' : 'Not accepted'} ok={d.p0Passed} />
            <Gate label="API health" value={h.isLoading ? 'Checking' : h.data?.status ?? 'Unreachable'} ok={h.data?.status === 'ok'} />
          </ul>
        </div>
      )}
      <section className="mt-10" aria-labelledby="proof-title">
        <h2 id="proof-title" className="font-display text-3xl">Release proof and UAT</h2>
        <p className="mt-3 text-sm text-muted-foreground">These are acceptance contracts, not completed tests. Original planning windows do not automatically clear gates. Partial checks do not complete a journey or replace independent security/privacy and usability review.</p>
        {proof.isLoading ? <Skel className="mt-4 h-32" /> : proof.isError ? <ErrorState error={proof.error} onRetry={() => proof.refetch()} /> : proof.data && <div className="mt-5 space-y-4">
          <div className="surface p-5">
            <h3 className="font-medium">Required separate evaluation suites</h3>
            {proof.data.suites.map(suite => <p key={suite.id} className="mt-3 text-sm"><span className="font-mono">{suite.id}</span>: {suite.executedCases} / {suite.requiredCases} executed · {suite.accepted ? 'accepted' : 'not accepted'}</p>)}
            <p className="mt-4 text-xs text-muted-foreground">Foundation and security-counter tests are not cases in these suites.</p>
          </div>
          {proof.data.gates.map(g => <details key={g.id} className="surface p-5">
            <summary className="cursor-pointer"><span className="font-mono">{g.id}</span> · {g.phaseId} · {g.status.replaceAll('_', ' ')}</summary>
            <p className="mt-4 text-sm"><strong>Required evidence:</strong> {g.requiredEvidence}</p>
            <p className="mt-3 text-sm"><strong>Required approvers, not recorded approval:</strong> {g.approvers}</p>
            <p className="mt-3 text-xs text-muted-foreground">Original planning window: {g.plannedWindow}. {g.reason}</p>
          </details>)}
          {proof.data.uatPackages.map(p => <details key={p.id} className="surface p-5">
            <summary className="cursor-pointer"><span className="font-mono">{p.id}</span> · {p.title} · {p.status}</summary>
            <p className="mt-4 text-sm">{p.requirements}</p>
            <p className="mt-3 text-sm"><strong>Required release evidence:</strong> {p.requiredEvidence}</p>
            <p className="mt-3 text-sm text-muted-foreground">{p.reason}</p>
          </details>)}
          <details className="surface p-5"><summary className="cursor-pointer font-medium">Non-waivable blockers, ownership and meaning of done</summary>
            {proof.data.releaseControls.map(c => <div key={c.id} className="mt-5"><h3 className="text-sm font-semibold">{c.title}</h3><p className="mt-2 text-sm text-muted-foreground">{c.text}</p><p className="mt-2 font-mono text-xs">Source: {c.source}</p></div>)}
          </details>
        </div>}
      </section>
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
        <input id="content-search" className="mt-2 w-full rounded-lg border border-border bg-card p-3" value={contentSearch} onChange={e => {setContentSearch(e.target.value);setContentPage(1);}} placeholder="TPL-01, EBD-B01, SCUML, OVL-02…" />
        <label className="mt-4 block text-sm" htmlFor="inventory-type">Inventory row type</label>
        <select id="inventory-type" className="field mt-2" value={inventoryType} onChange={e => {setInventoryType(e.target.value);setContentPage(1);}}>
          <option value="all">All records and proposals</option><option value="documents">27 supplied document mappings</option><option value="regulatory">79 regulatory research rows</option>
        </select>
        {content.isLoading ? <Skel className="mt-4 h-32" /> : content.isError ? <ErrorState error={content.error} onRetry={() => content.refetch()} /> : (
          <div className="mt-5 space-y-3"><p className="font-mono text-xs">{contentRows.length} matching rows · page {visibleContentPage}/{contentPages}</p>{visibleContentRows.map(r => <details key={`${r.kind}-${r.id}`} className="surface p-5">
            <summary className="cursor-pointer"><span className="font-mono text-xs">{r.id}</span> <span className="ml-2 font-medium">{r.title}</span> <span className="ml-2 text-xs text-muted-foreground">{r.status.replaceAll('_', ' ')}</span></summary>
            <p className="mt-4 text-sm">{r.kind}</p><p className="mt-3 text-sm text-muted-foreground">{r.limitation}</p>
            {r.relatedIds.length > 0 && <p className="mt-3 font-mono text-xs">Linked inventory IDs: {r.relatedIds.join(', ')}</p>}
            <p className="mt-3 text-xs">Mapping: {r.mappingType} · Canonical key: {r.canonicalId ?? 'Composite; no separate template'}</p>
            <p className="mt-2 text-xs">Evidence: {r.evidenceState} · Coverage: {r.coverageState} · Publication eligible: {r.publicationEligible ? 'Yes' : 'No'}</p>
            <p className="mt-2 break-all font-mono text-xs">Source inventory: {r.sourceLocator}</p>
            <p className="mt-2 text-xs">Authoritative source-check date: {r.sourceCheckedAt ?? 'None recorded'}</p>
            {r.overlapIds.length > 0 && <p className="mt-2 font-mono text-xs">Overlap notes: {r.overlapIds.join(', ')}</p>}
          </details>)}
          {contentRows.length === 0 && <p>No matching inventory row. Try an ID or clear the search.</p>}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button className="btn btn-ghost btn-sm" disabled={visibleContentPage <= 1} onClick={() => setContentPage(visibleContentPage - 1)}>Previous inventory page</button>
            <button className="btn btn-ghost btn-sm" disabled={visibleContentPage >= contentPages} onClick={() => setContentPage(visibleContentPage + 1)}>Next inventory page</button>
          </div>
          </div>
        )}
        {content.data && <details className="surface mt-5 p-5"><summary className="cursor-pointer">Industry taxonomy and deeper-pack targets</summary>
          <p className="mt-4 text-sm">These are coverage targets, not published guidance.</p>
          <p className="mt-3 text-sm"><strong>20 industries:</strong> {content.data.industries.join('; ')}</p>
          <p className="mt-3 text-sm"><strong>Six deeper-pack targets:</strong> {content.data.deeperPacks.join('; ')}</p>
        </details>}
        {content.data && <div className="mt-5 space-y-4">
          <details className="surface p-5"><summary className="cursor-pointer">Aliases and sector/facility overlaps</summary>
            <p className="mt-4 text-sm">{content.data.ngoCaution} This is a supplied inventory caution, not an independently sourced legal finding.</p>
            {content.data.overlaps.map(o => <div key={o.id} className="mt-5 text-sm"><p className="font-mono text-xs">{o.id} · {o.source_ids.join(', ')}</p><p className="mt-2">{o.note}</p></div>)}
          </details>
          <details className="surface p-5"><summary className="cursor-pointer">Exact coverage commitments, not completed coverage</summary>
            {content.data.coverageLayers.map(l => <div key={l.id} className="mt-5 text-sm"><h3 className="font-semibold">{l.title}</h3><p className="mt-2">{l.commitment}</p><p className="mt-2 text-muted-foreground">{l.representation}</p></div>)}
          </details>
          <details className="surface p-5"><summary className="cursor-pointer">R2 locked; R3 excluded</summary>
            <p className="mt-4 text-sm">{content.data.provisionalTargets}</p>
            <p className="mt-3 text-sm">R2 targets: approximately {content.data.r2Targets.templates} templates, {content.data.r2Targets.guided} guided editors, {content.data.r2Targets.guidance} guidance entries, {content.data.r2Targets.deeperPacks} deeper packs and up to {content.data.r2Targets.locationsUpTo} checked state/FCT packs. These are not completed counts.</p>
            {content.data.expansionBoundaries.map(e => <div key={e.id} className="mt-5 text-sm"><h3 className="font-semibold">{e.horizon} · {e.status.replaceAll('_',' ')}</h3><p className="mt-2">{e.priority}</p><p className="mt-2 text-muted-foreground">Required condition: {e.condition}</p></div>)}
          </details>
          <details className="surface p-5"><summary className="cursor-pointer">Four suggested management filing categories</summary>
            <p className="mt-4 text-sm">Organisation suggestions, not four additional templates, generated downloads or enabled evidence-upload folders.</p>
            {content.data.managementFiles.map(f => <div key={f.id} className="mt-4 text-sm"><h3 className="font-semibold">{f.title}</h3><p>{f.description}</p></div>)}
          </details>
        </div>}
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
      </>}
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
