import {useEffect, useRef, useState} from 'react';
import {Link} from 'wouter';
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {useAccountEpoch} from './account-state-boundary';
import {ErrorState} from './states';
import {SupportDraftGuard, SupportMessages} from './support-cases';
import {formatDate} from '@/lib/api';
import {
  actOnSupportCase, getSupportCase, listSupportAssignees, listSupportCases,
  supportAttempt, supportCaseKeys, supportErrorStatus, uncertainSupportResult,
  type SupportAction, type SupportCaseDetail, type SupportStaffInput, type SupportStatus,
} from '@/lib/support-case-api';

const statuses: (SupportStatus | 'all')[] = ['all', 'open', 'in_progress', 'awaiting_customer', 'resolved'];
const actionLabels: Record<SupportAction, string> = {
  assign: 'Assign support staff', reply: 'Save a reply', resolve: 'Resolve with a reason',
  reopen: 'Reopen with a reason', escalate_content: 'Queue internal content triage',
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function StaffSupportCases({onDirtyChange}: {onDirtyChange?: (dirty: boolean) => void}) {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<SupportStatus | 'all'>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [messagesPage, setMessagesPage] = useState(1);
  const [action, setAction] = useState<SupportAction>('reply');
  const [body, setBody] = useState('');
  const [assignee, setAssignee] = useState('');
  const [targetKind, setTargetKind] = useState<'content' | 'rule'>('content');
  const [targetId, setTargetId] = useState('');
  const [saved, setSaved] = useState('');
  const attempt = useRef<ReturnType<typeof supportAttempt<Omit<SupportStaffInput, 'idempotencyKey'>>> | null>(null);
  const accountActive = useAccountEpoch();
  const client = useQueryClient();
  const list = useQuery({queryKey: [...supportCaseKeys.list(true), status, page], queryFn: ({signal}) => listSupportCases(true, page, status, signal), retry: false});
  const detail = useQuery({queryKey: supportCaseKeys.detail(true, selected ?? '', messagesPage), queryFn: ({signal}) => getSupportCase(true, selected!, messagesPage, signal), enabled: !!selected, retry: false});
  const assignees = useQuery({queryKey: supportCaseKeys.assignees, queryFn: ({signal}) => listSupportAssignees(signal), enabled: !!selected, retry: false});
  const mutation = useMutation({mutationFn: ({id, input}: {id: string; input: SupportStaffInput}) => actOnSupportCase(id, input),
    onSuccess: (result: SupportCaseDetail, submitted) => {
      if (!accountActive()) return;
      client.setQueryData(supportCaseKeys.detail(true, result.case.id), result);
      setMessagesPage(1);
      setBody(''); setAssignee(''); setTargetId(''); attempt.current = null;
      setSaved(submitted.input.action === 'reply'
        ? result.case.sourceKind === 'access' ? 'Reply saved as an internal record. Nothing was sent to the contact email.' : 'Reply saved in the customer portal. It was not emailed.'
        : submitted.input.action === 'escalate_content' ? 'Content review was queued. No hold or publication change was made.' : 'Case operation saved.');
      void client.invalidateQueries({queryKey: supportCaseKeys.list(true)});
      void client.invalidateQueries({queryKey: ['support-case', 'staff', result.case.id]});
    }});
  const uncertain = uncertainSupportResult(mutation.error);
  const conflict = supportErrorStatus(mutation.error) === 409;
  const dirty = !!body.trim() || !!assignee || !!targetId.trim() || mutation.isPending || uncertain;
  useEffect(() => {onDirtyChange?.(dirty);}, [dirty, onDirtyChange]);
  useEffect(() => () => {onDirtyChange?.(false);}, [onDirtyChange]);
  const denied = [401, 403].includes(supportErrorStatus(list.error) ?? 0);
  const detailDenied = [401, 403, 404].includes(supportErrorStatus(detail.error) ?? 0);
  const row = detail.data?.case;
  const resolved = row?.status === 'resolved';
  const mayEscalate = row?.sourceKind === 'workspace';
  const actionAllowed = !!row && (action === 'reopen' ? resolved : action === 'escalate_content' ? mayEscalate && !resolved : !resolved);
  const fieldsLocked = mutation.isPending || uncertain;
  const operationLocked = fieldsLocked || conflict || detail.isFetching || detail.isError || !row;
  const validInput = action === 'assign'
    ? !assignees.isError && !!assignees.data?.assignees.some(item => item.identityId === assignee)
    : body.trim().length >= 8 && (action !== 'escalate_content' || uuid.test(targetId.trim()));
  function discard() {setBody(''); setAssignee(''); setTargetId(''); setSaved(''); mutation.reset(); attempt.current = null;}
  async function reloadDetail() {
    const result = await detail.refetch();
    if (!accountActive() || result.isError) return;
    if (!uncertain) {mutation.reset(); attempt.current = null;}
  }
  function submit() {
    if (!selected || !row || operationLocked || !actionAllowed || !validInput) return;
    const input: Omit<SupportStaffInput, 'idempotencyKey'> = {expectedVersion: row.version, action,
      ...(action === 'assign' ? {assigneeId: assignee} : {body: body.trim()}),
      ...(action === 'escalate_content' ? {targetKind, targetId: targetId.trim()} : {}),
    };
    attempt.current = supportAttempt(attempt.current, input);
    setSaved(''); mutation.mutate({id: selected, input: attempt.current.input});
  }
  return <section className="mt-6 min-w-0" aria-labelledby="staff-support-heading" data-testid="staff-support-cases">
    <h2 id="staff-support-heading" className="font-display text-3xl">Support case operations</h2>
    <p className="mt-2 max-w-3xl text-sm text-muted-foreground">Assignment, portal replies, resolution and content-review referrals are recorded here. Each operation requires an active support role and recent multi-factor verification.</p>
    <div className="mt-5 flex flex-wrap items-end gap-3">
      <label className="grid gap-2 text-sm" htmlFor="support-status-filter">Case status
        <select id="support-status-filter" className="field" value={status} disabled={dirty || list.isFetching}
          onChange={e => {setStatus(e.target.value as SupportStatus | 'all'); setPage(1); setSelected(null); discard();}}>
          {statuses.map(value => <option key={value} value={value}>{value === 'all' ? 'All cases' : value.replaceAll('_', ' ')}</option>)}
        </select>
      </label>
      <button type="button" className="btn btn-ghost btn-sm" disabled={list.isFetching || mutation.isPending} onClick={() => void list.refetch()}>Refresh support queue</button>
    </div>
    {list.isLoading && <p role="status" className="mt-5">Loading support cases…</p>}
    {list.isError && <div className="mt-5"><ErrorState error={list.error} onRetry={() => void list.refetch()}/>
      {supportErrorStatus(list.error) === 403 && <Link href="/workspace/account" className="mt-3 inline-block text-sm underline">Manage sign-in security</Link>}</div>}
    {!denied && list.data && <>
      <p className="mt-4 rounded-xl bg-secondary p-3 text-sm">{list.data.notice}</p>
      {!list.data.cases.length && <p className="mt-5 text-sm">No cases match this status on this page.</p>}
      <ul className="mt-5 grid gap-3 lg:grid-cols-2">{list.data.cases.map(item => <li key={item.id} className="surface min-w-0 p-5">
        <h3 className="break-all font-mono text-sm">{item.reference}</h3>
        <p className="mt-2 text-sm">{item.sourceKind === 'access' ? 'Account access' : 'Workspace'} · {item.category.replaceAll('_', ' ')} · <strong>{item.status.replaceAll('_', ' ')}</strong></p>
        <p className="mt-2 text-xs text-muted-foreground [overflow-wrap:anywhere]">{item.assignedTo ? `Assigned to ${item.assignedTo}` : 'Unassigned'} · Updated {formatDate(item.updatedAt)}</p>
        <button type="button" className="btn btn-ghost btn-sm mt-4" aria-pressed={selected === item.id} disabled={dirty && selected !== item.id}
          onClick={() => {if (selected !== item.id) {discard(); setAction('reply'); setMessagesPage(1); setSelected(item.id);}}}>Open case operations</button>
      </li>)}</ul>
      <div className="mt-4 flex flex-wrap items-center gap-3" role="group" aria-label="Staff support queue pages">
        <button type="button" className="btn btn-ghost btn-sm" disabled={page === 1 || dirty || list.isFetching} onClick={() => {setPage(page - 1); setSelected(null);}}>Previous</button>
        <span className="text-sm">Page {list.data.page}</span>
        <button type="button" className="btn btn-ghost btn-sm" disabled={!list.data.hasMore || dirty || list.isFetching} onClick={() => {setPage(page + 1); setSelected(null);}}>Next</button>
      </div>
    </>}
    {!denied && selected && <section className="surface mt-7 min-w-0 p-5 sm:p-7" aria-labelledby="staff-support-detail-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3 id="staff-support-detail-heading" className="font-display break-all text-2xl">{!detailDenied && row ? row.reference : 'Support case'}</h3>
        <button type="button" className="btn btn-ghost btn-sm" disabled={detail.isFetching || mutation.isPending} onClick={() => void reloadDetail()}>Reload latest case</button>
      </div>
      {detail.isLoading && <p className="mt-4" role="status">Loading the case before enabling operations…</p>}
      {detail.isError && <div className="mt-4"><ErrorState error={detail.error} onRetry={() => void reloadDetail()}/></div>}
      {!detailDenied && detail.data && row && <div className="mt-5 grid min-w-0 gap-5">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          {([['Status', row.status.replaceAll('_', ' ')], ['Version', String(row.version)], ['Contact email', row.contactEmail ?? 'Not recorded'],
            ['Assigned staff', row.assignedTo ?? 'Unassigned'], ['Outside-adviser sharing consent', row.sharingConsent ? 'Given' : 'Not given'],
            ['Request source', row.sourceKind === 'access' ? 'Anonymous account access' : 'Signed-in workspace']] as const).map(([label, value]) =>
            <div key={label} className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 [overflow-wrap:anywhere]">{value}</dd></div>)}
        </dl>
        <div><h4 className="text-sm font-semibold">Full original request</h4><p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed [overflow-wrap:anywhere]">{row.scope}</p></div>
        <p className="rounded-xl bg-secondary p-3 text-sm">{detail.data.notice}</p>
        <SupportMessages messages={detail.data.messages} staff/>
        <div className="flex flex-wrap items-center gap-3" role="group" aria-label="Staff support conversation pages">
          <button type="button" className="btn btn-ghost btn-sm" disabled={messagesPage === 1 || detail.isFetching || mutation.isPending}
            onClick={() => setMessagesPage(messagesPage - 1)}>Newer messages</button>
          <span className="text-xs text-muted-foreground">Message page {detail.data.messagesPage}{messagesPage === 1 ? ' · newest messages' : ''}</span>
          <button type="button" className="btn btn-ghost btn-sm" disabled={!detail.data.moreMessages || detail.isFetching || mutation.isPending}
            onClick={() => setMessagesPage(messagesPage + 1)}>Older messages</button>
        </div>
        {!!detail.data.escalations?.length && <section aria-label="Content review referrals">
          <h4 className="text-sm font-semibold">Content review referrals</h4>
          <ul className="mt-3 grid gap-3">{detail.data.escalations.map(item => <li key={item.id} className="rounded-xl border border-border p-4 text-sm">
            <p className="[overflow-wrap:anywhere]"><strong>{item.status.replaceAll('_', ' ')}</strong> · {item.targetKind} · {item.targetId}</p>
            <p className="mt-2 whitespace-pre-wrap [overflow-wrap:anywhere]">{item.reason}</p><p className="mt-2 text-xs text-muted-foreground">{formatDate(item.createdAt)}</p>
          </li>)}</ul>
          {detail.data.escalationsTruncated && <p className="mt-3 text-xs text-muted-foreground">Only the most recent referrals are shown. Earlier referral evidence remains in the audit records.</p>}
        </section>}
        {!!detail.data.events?.length && <details className="border-t border-border pt-4">
          <summary className="cursor-pointer text-sm font-medium">Case operation history</summary>
          <ol className="mt-3 grid gap-3 text-sm" aria-label="Support operation history">{detail.data.events.map(item => <li key={item.id}>
            <strong>{item.action.replaceAll('_', ' ')}</strong> · {formatDate(item.createdAt)}
            <p className="mt-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">Recorded actor: {item.actorId}</p>
          </li>)}</ol>
          {detail.data.eventsTruncated && <p className="mt-3 text-xs text-muted-foreground">Only the most recent operation entries are shown. Earlier evidence remains in the audit records.</p>}
        </details>}
        <form className="grid min-w-0 gap-4 border-t border-border pt-5" onSubmit={e => {e.preventDefault(); submit();}}>
          <label className="grid gap-2 text-sm" htmlFor="support-operation">Operation
            <select id="support-operation" className="field" value={action} disabled={fieldsLocked} onChange={e => {setAction(e.target.value as SupportAction); setSaved('');}}>
              {(Object.keys(actionLabels) as SupportAction[]).map(value => <option key={value} value={value}
                disabled={value === 'reopen' ? !resolved : value === 'escalate_content' ? !mayEscalate || resolved : resolved}>{actionLabels[value]}</option>)}
            </select>
          </label>
          {resolved && action !== 'reopen' && <p className="text-sm">This case is resolved. Choose “Reopen with a reason” before further operations.</p>}
          {action === 'assign' ? <div className="grid gap-3">
            <label className="grid gap-2 text-sm" htmlFor="support-assignee">Active support staff identity
              <select id="support-assignee" className="field" value={assignee} disabled={fieldsLocked || assignees.isFetching || assignees.isError}
                onChange={e => setAssignee(e.target.value)} required>
                <option value="">Choose an authorised support identity</option>
                {assignees.data?.assignees.map(item => <option key={item.identityId} value={item.identityId}>{item.identityId}</option>)}
              </select>
            </label>
            {assignees.isLoading && <p role="status" className="text-sm">Loading active support staff…</p>}
            {assignees.isError && <ErrorState error={assignees.error} onRetry={() => void assignees.refetch()}/>}
            {!assignees.isLoading && !assignees.isError && !assignees.data?.assignees.length && <p className="text-sm">No active support identities were returned. Assignment is unavailable.</p>}
            <p className="text-xs text-muted-foreground">Only existing active support identities can be assigned. This does not grant a staff role.</p>
          </div> : <>
            <label className="grid gap-2 text-sm" htmlFor="support-operation-body">{action === 'reply' ? row.sourceKind === 'access' ? 'Reply text to save internally' : 'Reply for the customer portal' : 'Reason and relevant scope'}
              <textarea id="support-operation-body" className="field min-h-32" value={body} onChange={e => setBody(e.target.value)}
                disabled={fieldsLocked} required minLength={8} maxLength={4000} aria-describedby="support-operation-body-hint"/>
            </label>
            <p id="support-operation-body-hint" className="text-xs text-muted-foreground">8–4,000 characters. Do not add passwords, payment credentials or identity documents.
              {action === 'reply' && (row.sourceKind === 'access' ? ' This anonymous case has no customer portal. The reply is stored internally and is not sent to the email address.' : ' This reply appears in the signed-in customer portal. It is not emailed.')}</p>
          </>}
          {action === 'escalate_content' && <>
            <label className="grid gap-2 text-sm" htmlFor="support-target-kind">Review target
              <select id="support-target-kind" className="field" value={targetKind} disabled={fieldsLocked} onChange={e => setTargetKind(e.target.value as 'content' | 'rule')}>
                <option value="content">Content record</option><option value="rule">Rule record</option>
              </select>
            </label>
            <label className="grid gap-2 text-sm" htmlFor="support-target-id">Existing target record UUID
              <input id="support-target-id" className="field font-mono text-sm" value={targetId} onChange={e => setTargetId(e.target.value)} disabled={fieldsLocked} required
                autoComplete="off" maxLength={36} pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"/>
            </label>
            <p className="rounded-xl bg-secondary p-3 text-sm">Internal content triage creates a queue item for authorised content staff. Include only the issue and relevant version details; leave out contact details and private document text. This does not share externally, contact an adviser, place a hold or change publication.</p>
          </>}
          {!mayEscalate && <p className="text-xs text-muted-foreground">Internal content triage is available for workspace cases. Anonymous account-access cases cannot use this path.</p>}
          <div className="flex flex-wrap gap-3">
            <button className="btn btn-primary btn-sm" disabled={operationLocked || !actionAllowed || !validInput}>
              {mutation.isPending ? 'Saving operation…' : action === 'reply' ? row.sourceKind === 'access' ? 'Save internal reply · no delivery' : 'Save reply to customer portal' : actionLabels[action]}</button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={fieldsLocked} onClick={discard}>Discard unsaved details</button>
          </div>
        </form>
      </div>}
      {mutation.isError && <div className="mt-4"><ErrorState error={mutation.error} title={conflict ? 'This case changed' : 'Operation was not confirmed'}/></div>}
      {conflict && <p className="mt-3 text-sm" role="status">Your operation details are preserved. Reload the latest case, review its version and history, then apply the operation again.</p>}
      {uncertain && <div className="mt-3 rounded-xl border border-border p-4 text-sm" role="status">
        <p>The save result is unknown. Retry this same operation safely using its original request reference before editing another operation.</p>
        <button type="button" className="btn btn-ghost btn-sm mt-3" disabled={mutation.isPending || !attempt.current || !selected}
          onClick={() => {if (selected && attempt.current) mutation.mutate({id: selected, input: attempt.current.input});}}>Retry the same operation</button>
      </div>}
      {saved && <p className="mt-4 text-sm" role="status">{saved}</p>}
    </section>}
    {dirty && <p className="mt-4 text-sm text-muted-foreground">Save or discard these details before changing staff areas, cases, filters or pages.</p>}
    <SupportDraftGuard dirty={dirty} onDiscard={discard}/>
  </section>;
}
