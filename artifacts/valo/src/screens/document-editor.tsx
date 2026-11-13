import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowLeft, ArrowUp, Check, CloudOff, Download, History, List, Loader2, Pilcrow, Plus, RotateCcw, Table2, Trash2, Undo2 } from 'lucide-react';
import {
  useGetDocument, useListDocumentRevisions, useSaveDocument,
  getGetDocumentQueryKey, getListDocumentRevisionsQueryKey, getListDocumentsQueryKey,
  type BusinessDocument, type CanonicalDocument, type DocumentBlock, type DocumentBlockType,
} from '@workspace/api-client-react';
import { ErrorState, Notice, Skel } from '@/components/states';
import { FIELD_LABELS, describeError, formatDate, missingFields, newBlockId } from '@/lib/api';
import { cn } from '@/lib/utils';
import { DocumentExports } from '@/components/document-exports';
import { FinancialFields, FINANCIAL_BLOCK_IDS } from '@/components/financial-fields';
import { synchronizeFinancialBlocks } from '@workspace/valo-core/money';
import type { FinancialInput } from '@workspace/api-client-react';

type Snapshot = { title: string; content: CanonicalDocument };
type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'conflict' | 'blocked';

const AUTOSAVE_MS = 1400;
const ser = (s: Snapshot) => JSON.stringify(s);

export default function DocumentEditor({ id }: { id: string }) {
  const qc = useQueryClient();
  const doc = useGetDocument(id, { query: { enabled: !!id, queryKey: getGetDocumentQueryKey(id) } });
  const revs = useListDocumentRevisions(id, { query: { enabled: !!id && doc.isSuccess, queryKey: getListDocumentRevisionsQueryKey(id) } });
  const saveMut = useSaveDocument();
  const mutateRef = useRef(saveMut.mutate);
  mutateRef.current = saveMut.mutate;

  const [title, setTitle] = useState('');
  const [content, setContent] = useState<CanonicalDocument | null>(null);
  const [tab, setTab] = useState<'edit' | 'preview'>('edit');
  const [state, setState] = useState<SaveState>('idle');
  const [errMsg, setErrMsg] = useState('');
  const [conflictRev, setConflictRev] = useState<number | null>(null);
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [restoring, setRestoring] = useState<number | null>(null);
  const [finDraft, setFinDraft] = useState<FinancialInput | null>(null);
  const [finKey, setFinKey] = useState(0);

  const initFor = useRef<string | null>(null);
  const baseRev = useRef(0);
  const lastSaved = useRef('');
  const latest = useRef<Snapshot | null>(null);
  const lastPush = useRef(0);
  const inFlight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const adopt = useCallback((d: BusinessDocument) => {
    baseRev.current = d.revision;
    const snap = { title: d.title, content: d.content };
    lastSaved.current = ser(snap);
    latest.current = snap;
    setTitle(d.title);
    setContent(d.content);
    setHistory([]);
    setConflictRev(null);
    setState('saved');
  }, []);

  useEffect(() => {
    if (doc.data && initFor.current !== id) {
      initFor.current = id;
      adopt(doc.data);
    }
  }, [doc.data, id, adopt]);

  const doSave = useCallback(() => {
    const snap = latest.current;
    if (!snap || inFlight.current) return;
    if (ser(snap) === lastSaved.current) { setState('saved'); return; }
    if (!snap.title.trim()) { setState('blocked'); return; }
    inFlight.current = true;
    setState('saving');
    const sent = ser(snap);
    mutateRef.current(
      { id, data: { expectedRevision: baseRev.current, title: snap.title.trim(), content: snap.content } },
      {
        onSuccess: (d) => {
          inFlight.current = false;
          baseRev.current = d.revision;
          lastSaved.current = sent;
          qc.setQueryData(getGetDocumentQueryKey(id), d);
          qc.invalidateQueries({ queryKey: getListDocumentRevisionsQueryKey(id) });
          qc.invalidateQueries({ queryKey: getListDocumentsQueryKey() });
          if (latest.current && ser(latest.current) !== sent) {
            setState('dirty');
            timer.current = setTimeout(doSaveRef.current, AUTOSAVE_MS);
          } else setState('saved');
        },
        onError: (e) => {
          inFlight.current = false;
          const de = describeError(e);
          if (de.kind === 'conflict') { setConflictRev(de.currentRevision ?? null); setState('conflict'); }
          else { setErrMsg(de.message); setState('error'); }
        },
      },
    );
  }, [id, qc]);
  const doSaveRef = useRef(doSave);
  doSaveRef.current = doSave;

  function update(next: Snapshot) {
    const prev = latest.current;
    latest.current = next;
    setTitle(next.title);
    setContent(next.content);
    const now = Date.now();
    if (prev && now - lastPush.current > 800) {
      setHistory((h) => [...h.slice(-49), prev]);
      lastPush.current = now;
    }
    if (state === 'conflict') return;
    setState(ser(next) === lastSaved.current ? 'saved' : 'dirty');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => doSaveRef.current(), AUTOSAVE_MS);
  }

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (latest.current && ser(latest.current) !== lastSaved.current) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  function undo() {
    setHistory((h) => {
      if (!h.length) return h;
      const prev = h[h.length - 1];
      latest.current = prev;
      setTitle(prev.title);
      setContent(prev.content);
      lastPush.current = 0;
      if (state !== 'conflict') {
        setState(ser(prev) === lastSaved.current ? 'saved' : 'dirty');
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => doSaveRef.current(), AUTOSAVE_MS);
      }
      return h.slice(0, -1);
    });
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); if (timer.current) clearTimeout(timer.current); doSaveRef.current(); }
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey && !(target && /INPUT|TEXTAREA/.test(target.tagName))) { e.preventDefault(); undoRef.current(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const undoRef = useRef(undo);
  undoRef.current = undo;

  async function keepMine() {
    const r = await doc.refetch();
    if (r.data) baseRev.current = r.data.revision;
    else if (conflictRev) baseRev.current = conflictRev;
    setConflictRev(null);
    setState('dirty');
    doSaveRef.current();
  }
  async function takeTheirs() {
    const r = await doc.refetch();
    if (r.data) adopt(r.data);
    revs.refetch();
  }

  function restore(r: BusinessDocument) {
    if (!latest.current) return;
    if (ser(latest.current) !== lastSaved.current && !window.confirm('You have unsaved changes. Restoring will replace them in the editor. Continue?')) return;
    if (timer.current) clearTimeout(timer.current);
    setRestoring(r.revision);
    inFlight.current = true;
    setState('saving');
    mutateRef.current(
      { id, data: { expectedRevision: baseRev.current, title: r.title, content: r.content } },
      {
        onSuccess: (d) => {
          inFlight.current = false;
          setRestoring(null);
          qc.setQueryData(getGetDocumentQueryKey(id), d);
          qc.invalidateQueries({ queryKey: getListDocumentRevisionsQueryKey(id) });
          qc.invalidateQueries({ queryKey: getListDocumentsQueryKey() });
          adopt(d);
        },
        onError: (e) => {
          inFlight.current = false;
          setRestoring(null);
          const de = describeError(e);
          if (de.kind === 'conflict') { setConflictRev(de.currentRevision ?? null); setState('conflict'); }
          else { setErrMsg(de.message); setState('error'); }
        },
      },
    );
  }

  if (doc.isLoading || (doc.isSuccess && !content)) {
    return <div className="mx-auto grid max-w-7xl gap-6 px-5 py-10 lg:grid-cols-[1fr_20rem] lg:px-8"><Skel className="h-[36rem]" /><Skel className="h-80" /></div>;
  }
  if (doc.isError || !content || !doc.data) {
    return <div className="mx-auto max-w-3xl px-5 py-12"><ErrorState error={doc.error} onRetry={() => doc.refetch()} /><Link href="/workspace" className="btn btn-ghost btn-sm mt-4">Back to workspace</Link></div>;
  }

  const missing = missingFields(content);
  const setFields = (k: keyof CanonicalDocument['fields'], v: string) => update({ title, content: { ...content, fields: { ...content.fields, [k]: v } } });
  const setBlocks = (blocks: DocumentBlock[]) => update({ title, content: { ...content, blocks } });
  const addBlock = (type: DocumentBlockType) => setBlocks([...content.blocks, { id: newBlockId(), type, text: '', rows: type === 'table' ? [['', ''], ['', '']] : [] }]);
  const saved = doc.data;

  return (
    <div className="mx-auto max-w-7xl px-5 py-8 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/workspace" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground" data-testid="link-back"><ArrowLeft className="h-4 w-4" /> Workspace</Link>
        <SaveIndicator state={state} rev={baseRev.current} onRetry={() => doSaveRef.current()} />
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <span className="pill pill-ink" data-testid="status-doc">Business draft</span>
        <span className="pill pill-ink">Not a released template</span>
        <span className="pill pill-ink">Not reviewed</span>
      </div>
      <label className="sr-only" htmlFor="doc-title">Title</label>
      <input id="doc-title" value={title} maxLength={160} onChange={(e) => update({ title: e.target.value, content })} placeholder="Name this draft" aria-invalid={!title.trim()} className="font-display mt-3 w-full bg-transparent text-4xl leading-tight outline-none placeholder:text-muted-foreground/60 sm:text-5xl" data-testid="input-title" />
      {!title.trim() && <p className="hint !text-destructive">A title is needed before this draft can be saved.</p>}

      {state === 'conflict' && (
        <Notice className="mt-5" title={'Saved elsewhere' + (conflictRev ? ' — now at revision ' + conflictRev : '')}>
          Another tab or device saved this draft after you opened it. Your unsaved text is still on screen and has not been discarded.
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="btn btn-primary btn-sm" onClick={keepMine} data-testid="button-keep-mine">Save mine as a new revision</button>
            <button className="btn btn-ghost btn-sm" onClick={() => { if (window.confirm('Discard your unsaved text and load the latest saved version?')) takeTheirs(); }} data-testid="button-load-theirs">Discard mine, load latest</button>
          </div>
        </Notice>
      )}
      {state === 'error' && <p role="alert" className="mt-4 rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">{errMsg} Your text is still here.</p>}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex rounded-full border border-border p-1" role="tablist">
              {(['edit', 'preview'] as const).map((t) => (
                <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cn('rounded-full px-4 py-1.5 text-sm capitalize transition-colors', tab === t ? 'bg-foreground text-background' : 'hover:bg-secondary')} data-testid={'tab-' + t}>{t === 'preview' ? 'Saved preview' : 'Edit'}</button>
              ))}
            </div>
            <div className="flex gap-2">
              <button className="btn btn-ghost btn-sm" onClick={undo} disabled={!history.length} data-testid="button-undo"><Undo2 className="h-4 w-4" /> Undo</button>
              <a href="#private-exports" className="btn btn-ghost btn-sm" data-testid="button-export"><Download className="h-4 w-4" /> Private draft exports</a>
            </div>
          </div>

          {tab === 'preview' ? (
            <div>
              {state !== 'saved' && <p className="mb-3 text-sm text-muted-foreground">Showing the last saved revision. Unsaved edits are not included.</p>}
              {saved && <DocPreview title={saved.title} content={saved.content} revision={saved.revision} />}
            </div>
          ) : (
            <div className="surface p-5 sm:p-8">
              <p className="eyebrow mb-4">Key details</p>
              <div className="grid gap-4 sm:grid-cols-2">
                {(['issuerName', 'recipientName', 'documentNumber'] as const).map((k) => (
                  <div key={k}><label className="label" htmlFor={'f-' + k}>{FIELD_LABELS[k]}</label><input id={'f-' + k} className="field" maxLength={k === 'documentNumber' ? 80 : 160} value={content.fields[k]} onChange={(e) => setFields(k, e.target.value)} data-testid={'input-field-' + k} /></div>
                ))}
                <div className="grid grid-cols-2 gap-3">
                  {(['issueDate', 'dueDate'] as const).map((k) => (
                    <div key={k}><label className="label" htmlFor={'f-' + k}>{FIELD_LABELS[k]}</label><input id={'f-' + k} type="date" className="field" value={content.fields[k]} onChange={(e) => setFields(k, e.target.value)} data-testid={'input-field-' + k} /></div>
                  ))}
                </div>
              </div>

              {content.financialInput && (
                <div className="mt-10 rounded-2xl border border-border bg-sidebar/50 p-4 sm:p-5" data-testid="panel-financial">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><p className="eyebrow">Financial details</p><span className="text-xs text-muted-foreground">Totals in whole kobo; tables update when applied</span></div>
                  <FinancialFields key={'fin-' + finKey} idPrefix="doc" value={content.financialInput} onChange={setFinDraft} />
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button type="button" className="btn btn-primary btn-sm" disabled={!finDraft || JSON.stringify(finDraft) === JSON.stringify(content.financialInput)} onClick={() => { if (finDraft) update({ title, content: synchronizeFinancialBlocks({ ...content, financialInput: finDraft }) as CanonicalDocument }); }} data-testid="button-apply-financial">Apply financial changes</button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFinKey((k) => k + 1)} data-testid="button-reset-financial">Reset</button>
                  </div>
                </div>
              )}

              <p className="eyebrow mb-4 mt-10">Body</p>
              <ol className="grid gap-3">
                {content.blocks.map((b, i) => (
                  <BlockEditor key={b.id} block={b} index={i} count={content.blocks.length}
                    onChange={(nb) => setBlocks(content.blocks.map((x) => (x.id === b.id ? nb : x)))}
                    onMove={(dir) => { const a = [...content.blocks]; const j = i + dir; [a[i], a[j]] = [a[j], a[i]]; setBlocks(a); }}
                    onDelete={() => setBlocks(content.blocks.filter((x) => x.id !== b.id))} />
                ))}
              </ol>
              {content.blocks.length < 100 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  <button className="btn btn-ghost btn-sm" onClick={() => addBlock('paragraph')} data-testid="button-add-paragraph"><Pilcrow className="h-4 w-4" /> Paragraph</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => addBlock('list')} data-testid="button-add-list"><List className="h-4 w-4" /> List</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => addBlock('table')} data-testid="button-add-table"><Table2 className="h-4 w-4" /> Table</button>
                </div>
              )}

              <div className="mt-10"><label className="label" htmlFor="f-notes">{FIELD_LABELS.notes}</label><textarea id="f-notes" className="field min-h-24" maxLength={5000} value={content.fields.notes} onChange={(e) => setFields('notes', e.target.value)} data-testid="input-field-notes" /></div>

              <div className="mt-8 grid gap-4 border-t border-border pt-6 sm:grid-cols-2">
                <div><label className="label" htmlFor="fmt-font">Typeface</label><select id="fmt-font" className="field" value={content.formatting.font} onChange={(e) => update({ title, content: { ...content, formatting: { ...content.formatting, font: e.target.value as 'sans' | 'serif' } } })} data-testid="select-font"><option value="serif">Serif</option><option value="sans">Sans</option></select></div>
                <div><label className="label" htmlFor="fmt-accent">Accent</label><select id="fmt-accent" className="field" value={content.formatting.accent} onChange={(e) => update({ title, content: { ...content, formatting: { ...content.formatting, accent: e.target.value as 'forest' | 'charcoal' } } })} data-testid="select-accent"><option value="forest">Forest</option><option value="charcoal">Charcoal</option></select></div>
              </div>
            </div>
          )}
        </div>

        <aside className="grid h-fit gap-4 lg:sticky lg:top-24">
          <div className="surface p-5" data-testid="card-missing">
            <p className="eyebrow">Missing details</p>
            {missing.length ? (
              <ul className="mt-3 grid gap-1.5 text-sm">{missing.map((m) => <li key={m} className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--ochre))]" />{m}</li>)}</ul>
            ) : <p className="mt-3 flex items-center gap-2 text-sm"><Check className="h-4 w-4 text-primary" /> All details filled in</p>}
            <p className="hint mt-3">Incomplete drafts save normally. Nothing is filled in for you.</p>
          </div>
          <div className="surface p-5" data-testid="card-revisions">
            <p className="eyebrow flex items-center gap-2"><History className="h-3.5 w-3.5" /> Revisions</p>
            {revs.isLoading ? <Skel className="mt-3 h-24" /> : revs.isError ? <div className="mt-3"><ErrorState error={revs.error} onRetry={() => revs.refetch()} /></div> : (
              <ol className="mt-3 grid max-h-80 gap-1 overflow-auto pr-1">
                {[...(revs.data ?? [])].sort((a, b) => b.revision - a.revision).map((r) => {
                  const current = r.revision === baseRev.current;
                  return (
                    <li key={r.revision} className={cn('flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-sm', current && 'bg-accent')} data-testid={'row-revision-' + r.revision}>
                      <span><span className="font-mono">rev {r.revision}</span><span className="block text-xs text-muted-foreground">{formatDate(r.updatedAt)}</span></span>
                      {current ? <span className="text-xs text-primary">Current</span> : (
                        <button className="btn btn-ghost btn-sm !min-h-7 !px-2.5 text-xs" disabled={restoring !== null || state === 'saving'} onClick={() => restore(r)} data-testid={'button-restore-' + r.revision}>
                          {restoring === r.revision ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />} Restore
                        </button>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
            <p className="hint mt-3">Restoring saves that content as a new revision. Older history stays intact.</p>
          </div>
          <DocumentExports documentId={id} revisionId={doc.data.revisionId} revisionNumber={doc.data.revision}
            disabled={!['idle','saved'].includes(state)} />
        </aside>
      </div>
    </div>
  );
}

function SaveIndicator({ state, rev, onRetry }: { state: SaveState; rev: number; onRetry: () => void }) {
  const map: Record<SaveState, [string, string]> = {
    idle: ['', ''], dirty: ['Unsaved changes', 'pill-ochre'], saving: ['Saving', 'pill-ink'], saved: ['Saved · rev ' + rev, 'pill-forest'],
    error: ['Not saved', 'pill-ochre'], conflict: ['Conflict — not saved', 'pill-ochre'], blocked: ['Needs a title to save', 'pill-ochre'],
  };
  const [text, cls] = map[state];
  if (!text) return null;
  return (
    <div className="flex items-center gap-2" aria-live="polite">
      <span className={'pill ' + cls} data-testid="status-save">
        {state === 'saving' ? <Loader2 className="h-3 w-3 animate-spin" /> : state === 'saved' ? <Check className="h-3 w-3" /> : state === 'error' ? <CloudOff className="h-3 w-3" /> : <span className="dot" />}
        {text}
      </span>
      {state === 'error' && <button className="text-sm underline" onClick={onRetry} data-testid="button-retry-save">Retry</button>}
    </div>
  );
}

function BlockEditor({ block, index, count, onChange, onMove, onDelete }: { block: DocumentBlock; index: number; count: number; onChange: (b: DocumentBlock) => void; onMove: (d: -1 | 1) => void; onDelete: () => void }) {
  const Icon = block.type === 'list' ? List : block.type === 'table' ? Table2 : Pilcrow;
  const locked = FINANCIAL_BLOCK_IDS.includes(block.id);
  if (locked) {
    return (
      <li className="rounded-xl border border-dashed border-border p-3" data-testid={'block-' + index}>
        <p className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground"><Table2 className="h-3.5 w-3.5" />{block.text || 'Financial table'} · edit with Financial details above</p>
        <div className="overflow-x-auto"><table className="w-full border-collapse text-sm"><tbody>{block.rows.map((r, i) => <tr key={i} className={i === 0 ? 'font-medium' : ''}>{r.map((c, j) => <td key={j} className="border border-border px-2.5 py-1.5 tabular-nums">{c}</td>)}</tr>)}</tbody></table></div>
      </li>
    );
  }
  return (
    <li className="group relative rounded-xl border border-transparent p-1 transition-colors focus-within:border-border hover:border-border" data-testid={'block-' + index}>
      <div className="mb-1 flex items-center justify-between px-2 pt-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><Icon className="h-3.5 w-3.5" /> {block.type}</span>
        <span className="flex gap-0.5 opacity-60 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
          <IconBtn label="Move up" disabled={index === 0} onClick={() => onMove(-1)}><ArrowUp className="h-3.5 w-3.5" /></IconBtn>
          <IconBtn label="Move down" disabled={index === count - 1} onClick={() => onMove(1)}><ArrowDown className="h-3.5 w-3.5" /></IconBtn>
          <IconBtn label="Delete section" disabled={count === 1} onClick={onDelete}><Trash2 className="h-3.5 w-3.5" /></IconBtn>
        </span>
      </div>
      {block.type === 'table' ? (
        <div className="overflow-x-auto px-1 pb-1">
          <table className="w-full border-collapse text-sm">
            <tbody>
              {block.rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td key={ci} className="border border-border p-0">
                      <input aria-label={'Row ' + (ri + 1) + ' column ' + (ci + 1)} className="w-full bg-transparent px-2.5 py-2 outline-none focus:bg-accent/50" maxLength={1000} value={cell} onChange={(e) => onChange({ ...block, rows: block.rows.map((r, x) => (x === ri ? r.map((c, y) => (y === ci ? e.target.value : c)) : r)) })} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 flex gap-2">
            <button className="text-xs text-muted-foreground underline-offset-2 hover:underline disabled:opacity-40" disabled={block.rows.length >= 100} onClick={() => onChange({ ...block, rows: [...block.rows, block.rows[0]?.map(() => '') ?? ['']] })}><Plus className="mr-0.5 inline h-3 w-3" />Row</button>
            <button className="text-xs text-muted-foreground underline-offset-2 hover:underline disabled:opacity-40" disabled={(block.rows[0]?.length ?? 0) >= 10} onClick={() => onChange({ ...block, rows: block.rows.map((r) => [...r, '']) })}><Plus className="mr-0.5 inline h-3 w-3" />Column</button>
          </div>
        </div>
      ) : (
        <textarea aria-label={block.type === 'list' ? 'List items, one per line' : 'Paragraph'} className="min-h-24 w-full resize-y rounded-lg bg-transparent px-2.5 py-2 leading-relaxed outline-none focus:bg-background" maxLength={8000} value={block.text}
          placeholder={block.type === 'list' ? 'One item per line' : 'Write in your own words'} onChange={(e) => onChange({ ...block, text: e.target.value })} data-testid={'input-block-' + index} />
      )}
    </li>
  );
}

function IconBtn({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick} className="grid h-7 w-7 place-items-center rounded-md hover:bg-secondary disabled:opacity-30">{children}</button>;
}

function DocPreview({ title, content, revision }: { title: string; content: CanonicalDocument; revision: number }) {
  const accent = content.formatting.accent === 'forest' ? 'hsl(155 42% 21%)' : 'hsl(30 8% 14%)';
  const f = content.fields;
  return (
    <article className={cn('surface mx-auto max-w-[46rem] px-7 py-10 shadow-[var(--shadow-lg)] sm:px-14 sm:py-14', content.formatting.font === 'serif' ? 'font-display' : 'font-sans')} data-testid="preview-doc">
      <div className="h-1 w-16 rounded-full" style={{ background: accent }} />
      <h2 className="mt-6 text-3xl leading-tight" style={{ color: accent }}>{title}</h2>
      <dl className="mt-6 grid gap-x-8 gap-y-2 font-sans text-sm sm:grid-cols-2">
        {(['issuerName', 'recipientName', 'documentNumber', 'issueDate', 'dueDate'] as const).map((k) => (
          <div key={k} className="flex justify-between gap-3 border-b border-border py-1.5"><dt className="text-muted-foreground">{FIELD_LABELS[k]}</dt><dd className={f[k] ? '' : 'italic text-[hsl(38_60%_35%)]'}>{f[k] || 'Missing'}</dd></div>
        ))}
      </dl>
      <div className="mt-8 grid gap-4 text-[1.05rem] leading-relaxed">
        {content.blocks.map((b) => b.type === 'list' ? (
          <ul key={b.id} className="list-disc pl-6">{b.text.split('\n').filter((l) => l.trim()).map((l, i) => <li key={i}>{l}</li>)}</ul>
        ) : b.type === 'table' ? (
          <table key={b.id} className="w-full border-collapse font-sans text-sm"><tbody>{b.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className="border border-border px-2.5 py-1.5">{c}</td>)}</tr>)}</tbody></table>
        ) : b.text.trim() ? <p key={b.id} className="whitespace-pre-wrap">{b.text}</p> : <p key={b.id} className="font-sans text-sm italic text-muted-foreground">Empty paragraph</p>)}
      </div>
      {f.notes && <p className="mt-8 whitespace-pre-wrap border-t border-border pt-4 font-sans text-sm text-muted-foreground">{f.notes}</p>}
      <p className="mt-10 font-mono text-[0.7rem] uppercase tracking-wider text-muted-foreground">Business draft · revision {revision} · not reviewed · not a released template</p>
    </article>
  );
}
