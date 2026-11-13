import { Link } from 'wouter';
import { useGetPublicCoverage } from '@workspace/api-client-react';
import { ErrorState, Notice, PageHeader, Skel } from '@/components/states';

export default function Industries() {
  const coverage = useGetPublicCoverage({ query: { retry:false, staleTime:60000 } });
  return (
    <div className="mx-auto max-w-7xl px-5 py-14 lg:px-8">
      <PageHeader eyebrow="Industries" title="Coverage by industry">
        All 20 planned categories, including six deeper-pack targets. Targets are not reviewed guidance or proof of compliance.
      </PageHeader>
      {coverage.isLoading ? <Skel className="h-64" /> : coverage.isError ? <ErrorState error={coverage.error} onRetry={() => coverage.refetch()} /> : (
        <ul className="grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2">
          {coverage.data?.industries.map((ind) => {
            const n = ind.publishedItems;
            return (
              <li key={ind.slug} className="flex flex-col items-start justify-between gap-4 bg-card p-5 sm:flex-row sm:items-center" data-testid={'row-industry-' + ind.slug}>
                <div className="min-w-0 flex-1">
                  <p className="break-words font-medium capitalize">{ind.title}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{n} released item{n === 1 ? '' : 's'} · {ind.deeperPackTarget ? 'Deeper-pack target' : 'Category target'}</p>
                  <p className="mt-1 text-xs text-muted-foreground">No source-check date or AI review recorded.</p>
                  {ind.enhancedEvidenceRequired && <p className="mt-2 text-xs">Activity-specific evidence and enhanced checks required; no specialist availability implied.</p>}
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
      {coverage.data && <>
        <Notice className="mt-6" title="Source and location gaps">
          <p>{coverage.data.notice}</p>
          <p className="mt-2">Source-check priority: {coverage.data.priorityLocations.join(', ')}. Checked location packs: {coverage.data.checkedLocationPacks}. All 36 states and FCT remain selectable in the business profile.</p>
          <p className="mt-2">Guidance: {coverage.data.publishedGuidance}/{coverage.data.guidanceTarget} target. Practical guides: {coverage.data.publishedGuides}/{coverage.data.guidesTarget} target. Deeper packs: {coverage.data.publishedDeeperPacks}/{coverage.data.deeperPackTarget} target.</p>
        </Notice>
        <Notice className="mt-4" title="Nonprofit applicability">{coverage.data.ngoNotice}</Notice>
      </>}
      <Notice className="mt-6" title="Need to clarify your activity?">Sector approvals vary widely. <Link href="/services" className="underline">Send us a scoped enquiry</Link> for staff review. This is not a confirmed booking or an assurance that a specialist is available.</Notice>
    </div>
  );
}
