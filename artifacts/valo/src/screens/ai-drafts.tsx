import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Check, FileCheck2, FilePenLine, Gauge, Loader2, Plus, RefreshCw, ShieldCheck, Sparkles, X } from 'lucide-react';
import {
  useCreateCustomerAIDraft, useGetCustomerAIDraft, useAcceptCustomerAIDraft, useGetCustomerAIUsage, useCreateDocument,
  getGetCustomerAIDraftQueryKey, getGetCustomerAIUsageQueryKey, getListDocumentsQueryKey, getGetWorkspaceQueryKey,
  CustomerAITask, CustomerAIInputTone,
  type CustomerAIInput, type CustomerAIPreview, type CustomerAIUsage, type CanonicalDocument, type FinancialInput,
} from '@workspace/api-client-react';
import { buildBusinessDraft } from '@workspace/valo-core/customer-document';
import { synchronizeFinancialBlocks } from '@workspace/valo-core/money';
import { WorkspaceNav } from '@/components/workspace-nav';
import { FinancialFields, FINANCIAL_BLOCK_IDS, emptyFinancial } from '@/components/financial-fields';
import { ErrorState, Notice, Skel } from '@/components/states';
import { describeError } from '@/lib/api';
import { live } from '@/lib/checker';
import { cn } from '@/lib/utils';

const TASKS: { id: CustomerAITask; label: string; blurb: string }[] = [
  { id: 'invoice', label: 'Invoice', blurb: 'Bill for goods or work already supplied.' },
  { id: 'quotation', label: 'Quotation', blurb: 'Price offer before work starts.' },
  { id: 'payment_reminder', label: 'Payment reminder', blurb: 'Follow up an amount you recorded as due.' },
  { id: 'business_proposal', label: 'Business proposal', blurb: 'Organise your scope and terms.' },
];
const TASK_LABEL = Object.fromEntries(TASKS.map((t) => [t.id, t.label])) as Record<CustomerAITask, string>;

const STATUS: Record<CustomerAIPreview['status'], { label: string; tone: string; text: string }> = {
  ready: { label: 'Ready to review', tone: 'pill-forest', text: 'The provider organised your notes. Review every line before saving.' },
  needs_information: { label: 'Needs information', tone: 'pill-ochre', text: 'Some details are missing. Fill them in below or save and complete later.' },
  manual_fallback: { label: 'Manual fallback', tone: 'pill-ochre', text: 'The AI provider did not produce a usable result. This preview was assembled from your own entries only, without AI.' },
  unsupported: { label: 'Unsupported', tone: 'pill-ink', text: 'This request cannot be drafted by Valo. Nothing was generated.' },
  running: { label: 'Running', tone: 'pill-ink', text: 'Still working. This page checks again automatically.' },
};

const uuid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 3) | 8).toString(16); }));

/* ------------------------------ Compose ------------------------------ */

export function AIDraftCompose() {
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const usage = useGetCustomerAIUsage({ query: { queryKey: getGetCustomerAIUsageQueryKey(), ...live } });
  const create = useCreateCustomerAIDraft();
  const manual = useCreateDocument();

  const [task, setTask] = useState<CustomerAITask>('invoice');
  const [tone, setTone] = useState<CustomerAIInputTone>('neutral');
  const [fields, setFields] = useState({ issuerName: '', recipientName: '', documentNumber: '', issueDate: '', dueDate: '' });
  const [lines, setLines] = useState<{ text: string; send: boolean }[]>([{ text: '', send: true }]);
  const [fin, setFin] = useState<FinancialInput | null>(emptyFinancial('invoice'));
  const [finKey, setFinKey] = useState(0);
  const [consent, setConsent] = useState(false);
  const [key, setKey] = useState(uuid);
  const [touched, setTouched] = useState(false);
  const [manualErr, setManualErr] = useState<string | null>(null);

  function pickTask(t: CustomerAITask) {
    if (t === task) return;
    setTask(t); setFin(emptyFinancial(t)); setFinKey((k) => k + 1); setKey(uuid());
  }

  const selected = lines.map((l) => l.text.trim()).filter((s, i) => s && lines[i].send);
  const lineTooLong = lines.some((l) => l.text.length > 1000);
  const problems: string[] = [];
  if (!fin) problems.push('Fix the amounts in Financial details.');
  if (lineTooLong) problems.push('Each note must be under 1,000 characters.');

  function build(): CustomerAIInput | null {
    if (!fin) return null;
    return { task, tone, ...fields, issuerName: fields.issuerName.trim(), recipientName: fields.recipientName.trim(), documentNumber: fields.documentNumber.trim(), contextLines: selected.slice(0, 20), financialInput: { ...fin, kind: task }, processingConsent: consent, idempotencyKey: key };
  }

  function submitAI(e: FormEvent) {
    e.preventDefault(); setTouched(true);
    const input = build();
    if (!input || problems.length || !consent) return;
    create.mutate({ data: input }, {
      onSuccess: (p) => {
        qc.setQueryData(getGetCustomerAIDraftQueryKey(p.id), p);
        qc.invalidateQueries({ queryKey: getGetCustomerAIUsageQueryKey() });
        setKey(uuid());
        setLocation('/workspace/ai/' + p.id);
      },
      onSettled: () => qc.invalidateQueries({ queryKey: getGetCustomerAIUsageQueryKey() }),
    });
  }

  function submitManual() {
    setTouched(true); setManualErr(null);
    const input = build();
    if (!input || problems.length) return;
    let draft: ReturnType<typeof buildBusinessDraft>;
    try { draft = buildBusinessDraft({ ...input }, null); } catch (er) { setManualErr('These details could not be assembled: ' + (er as Error).message); return; }
    manual.mutate({ data: { title: draft.title || TASK_LABEL[task], content: draft.content as CanonicalDocument } }, {
      onSuccess: (doc) => {
        qc.invalidateQueries({ queryKey: getListDocumentsQueryKey() });
        qc.invalidateQueries({ queryKey: getGetWorkspaceQueryKey() });
        setLocation('/workspace/documents/' + doc.id);
      },
    });
  }

  const u = usage.data;
  const aiBlocked = !!u && (!u.enabled || !u.globalAvailable || u.workspaceUsed >= u.workspaceDailyLimit);
  const aiErr = create.error ? describeError(create.error) : null;
  const manErr = manual.error ? describeError(manual.error) : null;

  return (
    <div className="mx-auto max-w-6xl px-5 py-12 lg:px-8">
      <WorkspaceNav />
      <header className="reveal max-w-3xl">
        <p className="eyebrow">Drafting assistant</p>
        <h1 className="font-display mt-2 text-4xl leading-[1.08] sm:text-5xl">Your facts, arranged. Nothing invented.</h1>
        <p className="mt-4 text-lg leading-relaxed text-muted-foreground">The assistant only sorts the notes you give it and picks short connecting phrases. Names and amounts are placed exactly as you typed them, and totals are calculated in whole kobo.</p>
      </header>

      <form onSubmit={submitAI} noValidate className="mt-10 grid gap-8 lg:grid-cols-[1fr_20rem]">
        <div className="grid min-w-0 gap-6">
          <Section n="1" title="What are you preparing?">
            <div role="radiogroup" aria-label="Document type" className="grid gap-2 sm:grid-cols-2">
              {TASKS.map((t) => (
                <label key={t.id} className={cn('cursor-pointer rounded-xl border p-4 transition-all has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring', task === t.id ? 'border-primary bg-accent/60 shadow-[var(--shadow-sm)]' : 'border-border hover:bg-secondary')}>
                  <input type="radio" name="task" className="sr-only" checked={task === t.id} onChange={() => pickTask(t.id)} data-testid={'radio-task-' + t.id} />
                  <span className="flex items-center justify-between font-medium">{t.label}{task === t.id && <Check className="h-4 w-4 text-primary" />}</span>
                  <span className="mt-1 block text-sm text-muted-foreground">{t.blurb}</span>
                </label>
              ))}
            </div>
            <fieldset className="mt-5">
              <legend className="label">Tone</legend>
              <div className="inline-flex rounded-full border border-border bg-card p-1">
                {Object.values(CustomerAIInputTone).map((t) => (
                  <label key={t} className={cn('cursor-pointer rounded-full px-4 py-1.5 text-sm capitalize has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring', tone === t ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground')}>
                    <input type="radio" name="tone" className="sr-only" checked={tone === t} onChange={() => setTone(t)} data-testid={'radio-tone-' + t} />{t}
                  </label>
                ))}
              </div>
            </fieldset>
          </Section>

          <Section n="2" title="Key details" hint="Inserted verbatim by the server. Not sent to the AI provider.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Text id="issuerName" label="From (your business)" max={160} v={fields.issuerName} on={(v) => setFields({ ...fields, issuerName: v })} />
              <Text id="recipientName" label="To (customer)" max={160} v={fields.recipientName} on={(v) => setFields({ ...fields, recipientName: v })} />
              <Text id="documentNumber" label="Reference number" max={80} v={fields.documentNumber} on={(v) => setFields({ ...fields, documentNumber: v })} />
              <div className="grid grid-cols-2 gap-3">
                <Text id="issueDate" type="date" label="Issue date" v={fields.issueDate} on={(v) => setFields({ ...fields, issueDate: v })} />
                <Text id="dueDate" type="date" label="Due date" v={fields.dueDate} on={(v) => setFields({ ...fields, dueDate: v })} />
              </div>
            </div>
          </Section>

          <Section n="3" title="Notes to organise" hint="One fact per note. Untick a note to keep it out of the AI request; it still goes into a manual draft.">
            <ul className="grid gap-2">
              {lines.map((l, i) => (
                <li key={i} className="flex gap-2">
                  <label className="mt-3 flex shrink-0 items-center" title="Send this note to the AI provider">
                    <input type="checkbox" className="h-4 w-4 accent-[hsl(155_42%_21%)]" checked={l.send} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, send: e.target.checked } : x)))} aria-label={'Send note ' + (i + 1) + ' to AI'} data-testid={'checkbox-note-' + i} />
                  </label>
                  <textarea rows={2} className="field" aria-label={'Note ' + (i + 1)} aria-invalid={l.text.length > 1000} value={l.text} placeholder={i === 0 ? 'e.g. Delivered 40 cartons on 3 March' : ''} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} data-testid={'input-note-' + i} />
                  {lines.length > 1 && <button type="button" className="btn btn-ghost !px-2.5" aria-label={'Remove note ' + (i + 1)} onClick={() => setLines(lines.filter((_, j) => j !== i))}><X className="h-4 w-4" /></button>}
                </li>
              ))}
            </ul>
            {lines.length < 20 && <button type="button" className="btn btn-ghost btn-sm mt-3" onClick={() => setLines([...lines, { text: '', send: true }])} data-testid="button-add-note"><Plus className="h-4 w-4" />Add note</button>}
            <p className="hint">{selected.length} of 20 notes selected for the AI request.</p>
          </Section>

          <Section n="4" title="Financial details" hint="Calculated by Valo in whole kobo, never by the AI provider.">
            <FinancialFields key={task + finKey} idPrefix="ai" value={emptyFinancial(task)} onChange={setFin} />
          </Section>

          {touched && problems.length > 0 && <ul role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
        </div>

        <aside className="grid h-fit gap-4 lg:sticky lg:top-24">
          <UsageCard usage={usage} />
          <div className="surface p-5" data-testid="panel-ai-submit">
            <p className="eyebrow">What leaves Valo</p>
            <p className="mt-2 text-sm leading-relaxed">Only the document type, tone and the notes you ticked, with obvious identifiers such as phone numbers and emails redacted first. Your profile, workspace and history are not sent.</p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Automatic redaction is incomplete. Read your notes and do not enter confidential or real customer data in this development build.</p>
            <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-sidebar p-3 text-sm">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[hsl(155_42%_21%)]" checked={consent} onChange={(e) => setConsent(e.target.checked)} data-testid="checkbox-ai-consent" />
              <span>I agree to these selected notes being processed by the AI provider.</span>
            </label>
            {touched && !consent && <p className="hint !text-destructive">Consent is needed for the AI draft only. A manual draft does not need it.</p>}
            {aiErr && (
              <p role="alert" className="mt-3 rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive" data-testid="status-ai-error">
                {aiErr.kind === 'unauthenticated' ? 'Please sign in again.' : aiErr.message} Your entries are unchanged{aiErr.kind === 'offline' || aiErr.kind === 'server' ? '; retrying reuses the same request key' : ''}.
              </p>
            )}
            <button type="submit" className="btn btn-primary mt-4 w-full" disabled={create.isPending || aiBlocked || manual.isPending} data-testid="button-ai-draft">
              {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}{create.isPending ? 'Organising your notes' : 'Draft with AI'}
            </button>
            {aiBlocked && <p className="hint">AI drafting is not available right now. Use the manual draft below.</p>}
            <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border" />or<span className="h-px flex-1 bg-border" /></div>
            <button type="button" className="btn btn-ghost w-full" onClick={submitManual} disabled={manual.isPending || create.isPending} data-testid="button-manual-draft">
              {manual.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FilePenLine className="h-4 w-4" />}Build manually, no AI
            </button>
            <p className="hint">Places all your notes in order as a private business draft. Nothing is sent to an AI provider.</p>
            {(manualErr || manErr) && <p role="alert" className="mt-2 text-sm text-destructive" data-testid="status-manual-error">{manualErr ?? manErr?.message}</p>}
          </div>
        </aside>
      </form>
    </div>
  );
}

function UsageCard({ usage }: { usage: { isLoading: boolean; isError: boolean; error: unknown; data?: CustomerAIUsage; refetch: () => unknown } }) {
  if (usage.isLoading) return <Skel className="h-36" />;
  if (usage.isError || !usage.data) return <ErrorState error={usage.error} onRetry={() => usage.refetch()} title="Usage unavailable" />;
  const u = usage.data;
  const pct = u.workspaceDailyLimit > 0 ? Math.min(100, (u.workspaceUsed / u.workspaceDailyLimit) * 100) : 100;
  return (
    <div className="surface p-5" data-testid="card-ai-usage">
      <div className="flex items-center justify-between"><p className="eyebrow">Development quota</p><Gauge className="h-4 w-4 text-muted-foreground" /></div>
      <p className="mt-3 font-mono text-2xl tabular-nums" data-testid="text-ai-usage">{u.workspaceUsed}<span className="text-base text-muted-foreground"> / {u.workspaceDailyLimit} today</span></p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full origin-left rounded-full bg-primary transition-transform duration-500" style={{ transform: `scaleX(${pct / 100})` }} /></div>
      <ul className="mt-3 grid gap-1 text-xs text-muted-foreground">
        <li>Up to {u.minuteLimit} per minute</li>
        <li>AI drafting {u.enabled && u.globalAvailable ? 'available' : 'unavailable'}{!u.globalAvailable ? ' (provider capacity paused)' : ''}</li>
        <li>Manual drafting {u.manualFallbackAvailable ? 'available' : 'unavailable'}</li>
      </ul>
      {u.policyNotice && <p className="mt-3 border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">{u.policyNotice}</p>}
      <p className="mt-2 text-xs text-muted-foreground">Technical development limits, not a plan or purchase.</p>
    </div>
  );
}

/* ------------------------------ Preview ------------------------------ */

export function AIDraftPreview({ id }: { id: string }) {
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const q = useGetCustomerAIDraft(id, {
    query: {
      enabled: !!id, queryKey: getGetCustomerAIDraftQueryKey(id), ...live,
      refetchInterval: (query) => (query.state.data?.status === 'running' ? 2500 : false),
    },
  });
  const accept = useAcceptCustomerAIDraft();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState<CanonicalDocument | null>(null);
  const [finValid, setFinValid] = useState(true);
  const [confirm, setConfirm] = useState(false);
  const [initFor, setInitFor] = useState<string | null>(null);

  const p = q.data;
  // Initialise editable copy once per preview hash; refetch/polling never replaces edits.
  useEffect(() => {
    if (p && p.status !== 'running' && initFor !== p.previewHash) {
      setInitFor(p.previewHash); setTitle(p.title); setContent(p.content);
    }
  }, [p, initFor]);

  const narrative = useMemo(() => content?.blocks.filter((b) => !FINANCIAL_BLOCK_IDS.includes(b.id)) ?? [], [content]);

  if (q.isLoading) return <Shell><Skel className="h-10 w-72" /><Skel className="mt-6 h-96" /></Shell>;
  if (q.isError || !p) return <Shell><ErrorState error={q.error} onRetry={() => q.refetch()} /></Shell>;

  const s = STATUS[p.status];
  const canAccept = p.status !== 'running' && p.status !== 'unsupported' && !p.acceptedDocumentId;
  const accErr = accept.error ? describeError(accept.error) : null;

  function setFin(fi: FinancialInput | null) {
    setFinValid(!!fi);
    if (fi) setContent((c) => (c ? (synchronizeFinancialBlocks({ ...c, financialInput: fi }) as CanonicalDocument) : c));
  }

  function save() {
    if (!content || !confirm || !title.trim() || !finValid) return;
    accept.mutate({ id, data: { title: title.trim().slice(0, 160), content, confirmBusinessDraft: true } }, {
      onSuccess: (doc) => {
        qc.invalidateQueries({ queryKey: getGetCustomerAIDraftQueryKey(id) });
        qc.invalidateQueries({ queryKey: getListDocumentsQueryKey() });
        qc.invalidateQueries({ queryKey: getGetWorkspaceQueryKey() });
        setLocation('/workspace/documents/' + doc.id);
      },
    });
  }

  return (
    <Shell>
      <div className="flex flex-wrap items-center gap-2">
        <span className={'pill ' + s.tone} data-testid="status-ai-preview">{p.status === 'running' && <Loader2 className="h-3 w-3 animate-spin" />}<span className="dot" />{s.label}</span>
        <span className="pill pill-ink">{TASK_LABEL[p.task]}</span>
        <span className="pill pill-ink">Private preview</span>
      </div>
      <p className="mt-3 max-w-2xl text-muted-foreground" data-testid="text-ai-status">{s.text}</p>

      {p.status === 'manual_fallback' && <Notice className="mt-4" title="AI did not complete">No AI result is being shown. You can still review and save this manual draft.</Notice>}

      {p.acceptedDocumentId && (
        <Notice className="mt-4" tone="forest" title="Already saved as a business draft">
          <Link href={'/workspace/documents/' + p.acceptedDocumentId} className="btn btn-primary btn-sm mt-2" data-testid="link-accepted-document"><FileCheck2 className="h-4 w-4" />Open draft and exports</Link>
        </Notice>
      )}

      {p.status === 'running' ? (
        <div className="mt-8 grid gap-3" aria-live="polite"><Skel className="h-12 w-2/3" /><Skel className="h-32" /><Skel className="h-32" /></div>
      ) : (
        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_19rem]">
          <div className="grid min-w-0 gap-6">
            {p.missingFields.length > 0 && (
              <div className="rounded-2xl border border-[hsl(38_50%_80%)] bg-[hsl(var(--ochre-soft))] p-5" data-testid="list-missing">
                <p className="flex items-center gap-2 text-sm font-semibold"><AlertTriangle className="h-4 w-4" />Still needed from you</p>
                <ul className="mt-2 grid gap-1 text-sm">{p.missingFields.map((m) => <li key={m}>{m}</li>)}</ul>
              </div>
            )}
            {content && (
              <>
                <div>
                  <label className="label" htmlFor="ai-title">Title</label>
                  <input id="ai-title" className="field font-display !text-xl" maxLength={160} value={title} aria-invalid={!title.trim()} disabled={!canAccept} onChange={(e) => setTitle(e.target.value)} data-testid="input-ai-title" />
                </div>
                <div className="surface grid gap-4 p-5 sm:p-7">
                  <p className="eyebrow">Key details (inserted as you typed them)</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {(['issuerName', 'recipientName', 'documentNumber', 'issueDate', 'dueDate'] as const).map((k) => (
                      <div key={k}><label className="label !text-xs" htmlFor={'ai-f-' + k}>{{ issuerName: 'From', recipientName: 'To', documentNumber: 'Reference', issueDate: 'Issue date', dueDate: 'Due date' }[k]}</label>
                        <input id={'ai-f-' + k} type={k.endsWith('Date') ? 'date' : 'text'} className="field" disabled={!canAccept} value={content.fields[k]} onChange={(e) => setContent({ ...content, fields: { ...content.fields, [k]: e.target.value } })} data-testid={'input-ai-field-' + k} /></div>
                    ))}
                  </div>
                </div>
                <div className="surface grid gap-3 p-5 sm:p-7">
                  <p className="eyebrow">Narrative</p>
                  {narrative.map((b, i) => (
                    <textarea key={b.id} aria-label={'Section ' + (i + 1)} rows={Math.min(10, Math.max(3, b.text.split('\n').length + 1))} className="field" maxLength={8000} disabled={!canAccept} value={b.text}
                      onChange={(e) => setContent({ ...content, blocks: content.blocks.map((x) => (x.id === b.id ? { ...x, text: e.target.value } : x)) })} data-testid={'input-ai-block-' + i} />
                  ))}
                </div>
                {content.financialInput && (
                  <div className="surface p-5 sm:p-7">
                    <p className="eyebrow mb-4">Financial details</p>
                    {canAccept
                      ? <FinancialFields key={p.previewHash} idPrefix="preview" value={content.financialInput} onChange={setFin} />
                      : <p className="text-sm text-muted-foreground">Edit financial details in the saved draft.</p>}
                  </div>
                )}
              </>
            )}
          </div>

          <aside className="grid h-fit gap-4 lg:sticky lg:top-24">
            {canAccept && (
              <div className="surface p-5" data-testid="panel-accept">
                <p className="eyebrow">Save to your drafts</p>
                <label className="mt-3 flex cursor-pointer items-start gap-3 text-sm">
                  <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[hsl(155_42%_21%)]" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} data-testid="checkbox-confirm-draft" />
                  <span>I reviewed this. It is my business draft, not legal, tax or accounting advice, and not approved by anyone.</span>
                </label>
                {!finValid && <p className="hint !text-destructive">Fix the financial details first.</p>}
                {accErr && <p role="alert" className="mt-3 rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive" data-testid="status-accept-error">{accErr.message} Your edits are still here.</p>}
                <button type="button" className="btn btn-primary mt-4 w-full" disabled={!confirm || !title.trim() || !finValid || accept.isPending} onClick={save} data-testid="button-accept-draft">
                  {accept.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileCheck2 className="h-4 w-4" />}Save as business draft
                </button>
              </div>
            )}
            {p.status === 'unsupported' && <Link href="/workspace/ai" className="btn btn-ghost w-full" data-testid="link-new-request">Start a new request</Link>}
            {p.limitations.length > 0 && (
              <div className="surface p-5"><p className="eyebrow">Limitations</p><ul className="mt-2 grid gap-2 text-sm leading-relaxed">{p.limitations.map((l) => <li key={l} className="border-l-2 border-border pl-3">{l}</li>)}</ul></div>
            )}
            <div className="surface p-5 text-xs" data-testid="card-ai-meta">
              <p className="eyebrow">Run record</p>
              <dl className="mt-2 grid gap-1.5">
                <Meta k="Recorded model" v={p.modelUsed ?? 'No model completion recorded'} />
                <Meta k="Outbound attempts" v={p.providerCalls === null ? 'Unconfirmed after interruption' : String(p.providerCalls)} />
                <Meta k="Input hash" v={p.inputHash.slice(0, 16)} />
                <Meta k="Preview hash" v={p.previewHash.slice(0, 16)} />
              </dl>
              <button type="button" className="mt-3 inline-flex items-center gap-1 text-muted-foreground hover:text-foreground" onClick={() => q.refetch()} data-testid="button-refresh-preview"><RefreshCw className={cn('h-3 w-3', q.isFetching && 'animate-spin')} />Refresh status</button>
            </div>
            <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />Valo does not publish templates or legal guidance, prove payments, or decide tax rates or obligations.</p>
          </aside>
        </div>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl px-5 py-12 lg:px-8">
      <WorkspaceNav />
      <Link href="/workspace/ai" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground" data-testid="link-back-ai"><ArrowLeft className="h-4 w-4" />Drafting assistant</Link>
      {children}
    </div>
  );
}

function Meta({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{k}</dt><dd className="truncate font-mono">{v}</dd></div>;
}

function Section({ n, title, hint, children }: { n: string; title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="surface p-5 sm:p-7">
      <div className="mb-5 flex items-baseline gap-3"><span className="font-mono text-xs text-muted-foreground">{n}</span><div><h2 className="font-display text-2xl">{title}</h2>{hint && <p className="mt-1 text-sm text-muted-foreground">{hint}</p>}</div></div>
      {children}
    </section>
  );
}

function Text({ id, label, v, on, max, type = 'text' }: { id: string; label: string; v: string; on: (v: string) => void; max?: number; type?: string }) {
  return <div className="min-w-0"><label className="label" htmlFor={'ai-' + id}>{label}</label><input id={'ai-' + id} type={type} className="field" maxLength={max} value={v} onChange={(e) => on(e.target.value)} data-testid={'input-ai-' + id} /></div>;
}
