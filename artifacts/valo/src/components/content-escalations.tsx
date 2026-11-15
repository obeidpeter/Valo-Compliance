import {useEffect, useRef, useState} from 'react';
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {useAccountEpoch} from './account-state-boundary';
import {ErrorState} from './states';
import {SupportDraftGuard} from './support-cases';
import {formatDate} from '@/lib/api';
import {
  actOnContentEscalation, listContentEscalations, supportAttempt, supportCaseKeys,
  supportErrorStatus, uncertainSupportResult, type ContentEscalation,
  type ContentEscalationAction, type ContentEscalationInput, type ContentEscalationList,
} from '@/lib/support-case-api';

export function ContentEscalations({onDirtyChange}: {onDirtyChange?: (dirty: boolean) => void}) {
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<ContentEscalation | null>(null);
  const [body, setBody] = useState('');
  const [saved, setSaved] = useState('');
  const attempt = useRef<ReturnType<typeof supportAttempt<Omit<ContentEscalationInput, 'idempotencyKey'>>> | null>(null);
  const accountActive = useAccountEpoch();
  const client = useQueryClient();
  const list = useQuery({queryKey: [...supportCaseKeys.escalations, page], queryFn: ({signal}) => listContentEscalations(page, signal), retry: false});
  const mutation = useMutation({mutationFn: ({id, input}: {id: string; input: ContentEscalationInput}) => actOnContentEscalation(id, input),
    onSuccess: (result, submitted) => {
      if (!accountActive()) return;
      const updated = {...result.escalation, caseVersion: result.caseVersion};
      setSelected(updated); setBody(''); attempt.current = null;
      client.setQueryData<ContentEscalationList>([...supportCaseKeys.escalations, page], previous => previous && ({...previous,
        escalations: previous.escalations.map(item => item.id === updated.id ? updated : item)}));
      setSaved(submitted.input.action === 'hold_and_reassess'
        ? 'The referred version was held and reassessment was queued. No AI work was dispatched and publication was not approved.'
        : submitted.input.action === 'resolve'
          ? 'Content triage was closed. This does not release a hold or establish publication eligibility.'
          : 'The content referral was acknowledged. Its publication state is unchanged.');
      void client.invalidateQueries({queryKey: supportCaseKeys.escalations});
      void client.invalidateQueries({queryKey: supportCaseKeys.list(true)});
      void client.invalidateQueries({queryKey: ['support-case', 'staff', updated.caseId]});
    }});
  const current = list.data?.escalations.find(item => item.id === selected?.id);
  const row = current ?? selected;
  const uncertain = uncertainSupportResult(mutation.error);
  const conflict = supportErrorStatus(mutation.error) === 409;
  const dirty = !!body.trim() || mutation.isPending || uncertain;
  useEffect(() => {onDirtyChange?.(dirty);}, [dirty, onDirtyChange]);
  useEffect(() => () => {onDirtyChange?.(false);}, [onDirtyChange]);
  const denied = [401, 403].includes(supportErrorStatus(list.error) ?? 0);
  const locked = list.isFetching || list.isError || mutation.isPending || conflict || uncertain || !current || row?.status === 'resolved' || body.trim().length < 8;
  function discard() {setBody(''); setSaved(''); mutation.reset(); attempt.current = null;}
  async function reload() {
    const result = await list.refetch();
    if (!accountActive() || result.isError) return;
    const latest = result.data?.escalations.find(item => item.id === selected?.id);
    if (latest) setSelected(latest);
    if (!uncertain) {mutation.reset(); attempt.current = null;}
  }
  function act(action: ContentEscalationAction) {
    if (!row || locked || (action === 'acknowledge' && row.status !== 'queued') || (action === 'hold_and_reassess' && row.sourceImpactId)) return;
    attempt.current = supportAttempt(attempt.current, {expectedVersion: row.caseVersion, action, body: body.trim()});
    setSaved(''); mutation.mutate({id: row.id, input: attempt.current.input});
  }
  return <section className="mt-6 min-w-0 rounded-2xl border border-border p-5 sm:p-6" aria-labelledby="content-escalations-heading" data-testid="content-escalations">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <h2 id="content-escalations-heading" className="font-display text-2xl">Content referrals from support</h2>
      <button type="button" className="btn btn-ghost btn-sm" disabled={list.isFetching || mutation.isPending} onClick={() => void reload()}>Reload latest referrals</button>
    </div>
    <p className="mt-3 text-sm text-muted-foreground">Authorised content staff can inspect the referred version, record triage and explicitly hold that version for reassessment. A referral by itself does not change publication.</p>
    {list.isLoading && <p className="mt-4 text-sm" role="status">Loading content referrals…</p>}
    {list.isError && <div className="mt-4"><ErrorState error={list.error} onRetry={() => void reload()}/></div>}
    {!denied && list.data && <>
      <p className="mt-4 rounded-xl bg-secondary p-3 text-sm">{list.data.notice}</p>
      {!list.data.escalations.length && <p className="mt-4 text-sm">No support referrals on this page.</p>}
      <ul className="mt-5 grid gap-3">{list.data.escalations.map(item => <li key={item.id} className="min-w-0 rounded-xl border border-border p-4">
        <h3 className="break-all font-mono text-sm">{item.reference}</h3>
        <p className="mt-2 text-sm"><strong>{item.status}</strong> · {item.targetKind} version {item.targetVersion} · {formatDate(item.createdAt)}</p>
        <p className="mt-2 break-all font-mono text-xs text-muted-foreground">Target {item.targetId}</p>
        <button type="button" className="btn btn-ghost btn-sm mt-3" aria-pressed={selected?.id === item.id} disabled={dirty && selected?.id !== item.id}
          onClick={() => {if (selected?.id !== item.id) {discard(); setSelected(item);}}}>Review referred version</button>
      </li>)}</ul>
      <div className="mt-4 flex flex-wrap items-center gap-3" role="group" aria-label="Content referral pages">
        <button type="button" className="btn btn-ghost btn-sm" disabled={page === 1 || dirty || list.isFetching} onClick={() => {setPage(page - 1); setSelected(null);}}>Previous</button>
        <span className="text-sm">Page {list.data.page}</span>
        <button type="button" className="btn btn-ghost btn-sm" disabled={!list.data.hasMore || dirty || list.isFetching} onClick={() => {setPage(page + 1); setSelected(null);}}>Next</button>
      </div>
    </>}
    {!denied && row && <section className="mt-6 grid min-w-0 gap-4 border-t border-border pt-5" aria-labelledby="content-referral-detail-heading">
      <h3 id="content-referral-detail-heading" className="font-display break-all text-2xl">Referred {row.targetKind} version {row.targetVersion}</h3>
      <dl className="grid min-w-0 gap-3 text-sm sm:grid-cols-2">
        {([['Case reference', row.reference], ['Target record', row.targetId], ['Exact version hash', row.targetHash],
          ['Triage status', row.status], ['Expected case version', String(row.caseVersion)], ['Reassessment record', row.sourceImpactId ?? 'Not queued']] as const).map(([label, value]) =>
          <div className="min-w-0" key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 [overflow-wrap:anywhere]">{value}</dd></div>)}
      </dl>
      <div><h4 className="text-sm font-semibold">Referral reason</h4><p className="mt-2 whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{row.reason}</p></div>
      {!current && <p className="text-sm" role="status">This referral is no longer present on the current page. Operations are disabled. Discard any unsaved triage reason before choosing another page.</p>}
      {row.status === 'resolved' ? <p className="rounded-xl bg-secondary p-3 text-sm">This triage item is resolved. No further triage operations are available here. Closure does not release content or establish publication eligibility.</p> : <>
        <label className="grid gap-2 text-sm" htmlFor="content-referral-reason">Triage reason and relevant evidence
          <textarea id="content-referral-reason" className="field min-h-28" value={body} onChange={e => {setBody(e.target.value); setSaved('');}}
            disabled={mutation.isPending || uncertain} minLength={8} maxLength={4000} aria-describedby="content-referral-reason-hint"/>
        </label>
        <p id="content-referral-reason-hint" className="text-xs text-muted-foreground">8–4,000 characters. Record the content issue and triage decision. Do not copy personal complaint details into source audit notes.</p>
        <p className="rounded-xl bg-secondary p-3 text-sm">“Hold version and queue reassessment” changes the exact referred version's safety state. Reassessment stays queued; this action does not dispatch AI or approve publication.</p>
        <div className="flex flex-wrap gap-3">
          <button type="button" className="btn btn-ghost btn-sm" disabled={locked || row.status !== 'queued'} onClick={() => act('acknowledge')}>Acknowledge referral</button>
          <button type="button" className="btn btn-primary btn-sm" disabled={locked || !!row.sourceImpactId} onClick={() => act('hold_and_reassess')}>Hold version and queue reassessment</button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={locked} onClick={() => act('resolve')}>Close content triage</button>
        </div>
      </>}
      {!!body && <button type="button" className="btn btn-ghost btn-sm w-fit" disabled={mutation.isPending || uncertain} onClick={discard}>Discard unsaved triage reason</button>}
      {mutation.isPending && <p role="status" className="text-sm">Saving the content triage operation…</p>}
      {mutation.isError && <ErrorState error={mutation.error} title={conflict ? 'This referral changed' : 'Triage operation was not confirmed'}/>}
      {conflict && <p className="text-sm" role="status">Your reason is preserved. Reload the latest referrals, review the case version and triage history, then choose the operation again.</p>}
      {uncertain && <div className="rounded-xl border border-border p-4 text-sm" role="status">
        <p>The result is unknown. Retry the original operation with its existing reference before editing another triage operation.</p>
        <button type="button" className="btn btn-ghost btn-sm mt-3" disabled={mutation.isPending || !attempt.current}
          onClick={() => {if (attempt.current) mutation.mutate({id: row.id, input: attempt.current.input});}}>Retry the same triage operation</button>
      </div>}
      {saved && <p role="status" className="text-sm">{saved}</p>}
    </section>}
    {dirty && <p className="mt-4 text-sm text-muted-foreground">Save or discard the triage reason before changing staff area, referral or page.</p>}
    <SupportDraftGuard dirty={dirty} onDiscard={discard}/>
  </section>;
}
