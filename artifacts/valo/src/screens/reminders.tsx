import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BellOff, BellRing, Clock, Loader2 } from 'lucide-react';
import {
  useGetReminderPreferences, useSaveReminderPreferences, useListReminders, useListTasks,
  getGetReminderPreferencesQueryKey, getListRemindersQueryKey, getListTasksQueryKey,
  ReminderPreferencesInputOffsetsItem, type ReminderPreferencesInputOffsetsItem as Offset, type ReminderRecordStatus,
} from '@workspace/api-client-react';
import { WorkspaceNav } from '@/components/workspace-nav';
import { EmptyState, ErrorState, Notice, Skel } from '@/components/states';
import { describeError, formatDate } from '@/lib/api';
import { live } from '@/lib/checker';
import { cn } from '@/lib/utils';

const OFFSETS = Object.values(ReminderPreferencesInputOffsetsItem) as Offset[];
const offsetLabel = (n: number) => (n === 0 ? 'On the due date' : n === 1 ? '1 day before' : n + ' days before');
const STATUS: Record<ReminderRecordStatus, { label: string; tone: string; desc: string }> = {
  held: { label: 'Held', tone: 'pill-ochre', desc: 'Not sent: delivery is not available.' },
  pending: { label: 'Pending', tone: 'pill-ink', desc: 'Scheduled, not yet sent.' },
  sent: { label: 'Accepted by provider', tone: 'pill-forest', desc: 'The email provider accepted this message. Delivery to your inbox has not been confirmed.' },
  cancelled: { label: 'Cancelled', tone: 'pill-ink', desc: 'Will not be sent.' },
  failed: { label: 'Not confirmed', tone: 'pill-ochre', desc: 'Provider acceptance was not confirmed. A retry uses the same message reference, not a new message.' },
};
const REASONS:Record<string,string>={
  EMAIL_PROVIDER_NOT_CONFIGURED:'New delivery attempts are paused. Your preference and task are saved; no inbox delivery has been confirmed.',
  EMAIL_REPLAY_WINDOW_EXPIRED:'The previous outcome is unconfirmed and its safe retry window has ended. Delivery is paused to avoid a duplicate. Your task is saved.',
  EMAIL_FIRST_ATTEMPT_UNKNOWN:'The first attempt time could not be verified. Delivery is paused to avoid a duplicate. Contact support; your task is saved.',
  TASK_REVIEW_REQUIRED:'Review this task before reminders can resume.',
  EMAIL_DISPATCH_IN_PROGRESS:'An email attempt is in progress. Inbox delivery has not been confirmed.',
  REMINDERS_OPTED_OUT:'Reminders were turned off before dispatch.',
  TASK_NO_LONGER_SCHEDULED:'This task no longer has an active confirmed reminder date.',
  SCHEDULE_CHANGED:'The confirmed date or selected timing changed.',
  SOURCE_NO_LONGER_ELIGIBLE:'The supporting guidance needs review. No statutory reminder will be sent from it.',
  PREFERENCES_CHANGED:'Your reminder preferences changed.',
  TASK_CHANGED:'The task changed; this earlier reminder was cancelled.',
};

export default function RemindersPage() {
  const qc = useQueryClient();
  const prefs = useGetReminderPreferences({ query: { queryKey: getGetReminderPreferencesQueryKey(), ...live } });
  const log = useListReminders({ query: { queryKey: getListRemindersQueryKey(), ...live } });
  const tasks = useListTasks({ query: { queryKey: getListTasksQueryKey(), ...live } });
  const save = useSaveReminderPreferences();

  const [enabled, setEnabled] = useState(false);
  const [offsets, setOffsets] = useState<Offset[]>([1]);
  const [rev, setRev] = useState(0);
  const [conflict, setConflict] = useState(false);
  const [savedNote, setSavedNote] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const init = useRef(false);

  useEffect(() => {
    if (prefs.data && !init.current) {
      init.current = true;
      setEnabled(prefs.data.enabled);
      setOffsets((prefs.data.offsets.filter((o) => (OFFSETS as number[]).includes(o)) as Offset[]).slice(0, 4).length ? (prefs.data.offsets as Offset[]).slice(0, 4) : [1]);
      setRev(prefs.data.revision);
    }
  }, [prefs.data]);

  const taskTitle = useMemo(() => new Map((tasks.data ?? []).map((t) => [t.id, t.title])), [tasks.data]);
  const records = useMemo(() => [...(log.data ?? [])].sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt)), [log.data]);

  function toggle(o: Offset) {
    setSavedNote(false);
    setOffsets((cur) => (cur.includes(o) ? cur.filter((x) => x !== o) : cur.length >= 4 ? cur : [...cur, o].sort((a, b) => a - b)));
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null); setSavedNote(false);
    if (offsets.length < 1) { setErr('Choose at least one timing.'); return; }
    save.mutate({ data: { enabled, offsets, expectedRevision: rev } }, {
      onSuccess: (p) => {
        setRev(p.revision); setConflict(false); setSavedNote(true);
        qc.setQueryData(getGetReminderPreferencesQueryKey(), p);
        qc.invalidateQueries({ queryKey: getListRemindersQueryKey() });
      },
      onError: (er) => {
        const d = describeError(er);
        if (d.kind === 'conflict') { setConflict(true); qc.invalidateQueries({ queryKey: getGetReminderPreferencesQueryKey() }); }
        else setErr(d.message);
      },
    });
  }

  async function loadLatest() {
    const r = await prefs.refetch();
    if (r.data) { setEnabled(r.data.enabled); setOffsets((r.data.offsets as Offset[]).slice(0, 4)); setRev(r.data.revision); }
    setConflict(false); save.reset();
  }

  const p = prefs.data;

  return (
    <div className="mx-auto max-w-5xl px-5 py-12 lg:px-8">
      <WorkspaceNav />
      <div className="reveal"><p className="eyebrow">Due-date reminders</p><h1 className="font-display mt-2 text-4xl">Reminders</h1></div>
      <p className="mt-3 max-w-2xl text-muted-foreground">Off unless you turn them on. Reminders only apply to tasks with a due date you confirmed.</p>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_1.15fr]">
        <section aria-labelledby="pref-h">
          {prefs.isLoading ? <Skel className="h-80" /> : prefs.isError || !p ? <ErrorState error={prefs.error} onRetry={() => prefs.refetch()} /> : (
            <form onSubmit={submit} noValidate className="surface grid gap-6 p-5 sm:p-7">
              <div className="flex items-center justify-between"><h2 id="pref-h" className="font-display text-2xl">Preferences</h2><span className="font-mono text-xs text-muted-foreground">rev {rev}</span></div>

              <div className={cn('rounded-xl border p-4 text-sm', p.deliveryAvailable ? 'border-[hsl(150_25%_80%)] bg-accent' : 'border-[hsl(38_50%_80%)] bg-[hsl(var(--ochre-soft))]')} data-testid="status-delivery">
                <p className="flex items-center gap-2 font-medium">{p.deliveryAvailable ? <BellRing className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}{p.deliveryAvailable ? 'Delivery available' : 'Delivery not available'}</p>
                {!p.deliveryAvailable && <p className="mt-1 text-foreground/80">{p.deliveryBlocker ?? 'No reminder channel is configured.'} Your choices are stored, but nothing will be sent and scheduled reminders stay held.</p>}
              </div>

              <label className="flex cursor-pointer items-center justify-between gap-4">
                <span><span className="block font-medium">Remind me about due tasks</span><span className="text-sm text-muted-foreground">Opt-in. You can turn this off at any time.</span></span>
                <span className="relative inline-flex">
                  <input type="checkbox" role="switch" className="peer sr-only" checked={enabled} onChange={(e) => { setEnabled(e.target.checked); setSavedNote(false); }} data-testid="switch-enabled" />
                  <span className="h-7 w-12 rounded-full bg-input transition-colors peer-checked:bg-primary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring" />
                  <span className="pointer-events-none absolute left-1 top-1 h-5 w-5 rounded-full bg-card shadow transition-transform peer-checked:translate-x-5" />
                </span>
              </label>

              <fieldset disabled={!enabled} className="disabled:opacity-50">
                <legend className="label">When (choose 1 to 4)</legend>
                <div className="flex flex-wrap gap-2">
                  {OFFSETS.map((o) => {
                    const on = offsets.includes(o);
                    const blocked = !on && offsets.length >= 4;
                    return (
                      <label key={o} className={cn('cursor-pointer rounded-full border px-3.5 py-2 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring', on ? 'border-primary bg-primary text-primary-foreground' : 'border-input hover:bg-secondary', blocked && 'cursor-not-allowed opacity-50')}>
                        <input type="checkbox" className="sr-only" checked={on} disabled={blocked} onChange={() => toggle(o)} data-testid={'checkbox-offset-' + o} />
                        {offsetLabel(o)}
                      </label>
                    );
                  })}
                </div>
                <p className="hint">Times use {p.timezone}.</p>
              </fieldset>

              {conflict && (
                <Notice title="Preferences changed in another tab">Your selections above are kept. Load the latest saved preferences to continue; this replaces your selections.
                  <button type="button" className="btn btn-ink btn-sm mt-3" onClick={loadLatest} data-testid="button-reload-prefs">Load latest</button>
                </Notice>
              )}
              {err && <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">{err}</p>}
              {savedNote && (
                <p role="status" className="rounded-xl bg-secondary px-4 py-3 text-sm" data-testid="status-saved">
                  Preferences saved. This does not send anything{p.deliveryAvailable ? '' : ', and delivery is currently unavailable'}. Check the log for each reminder's actual status.
                </p>
              )}
              <button type="submit" className="btn btn-primary w-fit" disabled={save.isPending || conflict} data-testid="button-save-prefs">{save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Save preferences</button>
            </form>
          )}
        </section>

        <section aria-labelledby="log-h">
          <div className="mb-4 flex items-end justify-between"><h2 id="log-h" className="font-display text-2xl">Delivery log</h2><span className="text-xs text-muted-foreground">Actual status, from the server</span></div>
          {log.isLoading ? <div className="grid gap-2">{[0, 1, 2].map((i) => <Skel key={i} className="h-16" />)}</div>
            : log.isError ? <ErrorState error={log.error} onRetry={() => log.refetch()} />
            : records.length === 0 ? (
              <EmptyState mark={<Clock className="h-5 w-5 text-muted-foreground" />} title="No reminders scheduled">
                Reminders appear here once enabled and a task has a confirmed due date.
              </EmptyState>
            ) : (
              <ul className="surface divide-y divide-border overflow-hidden" data-testid="list-reminders">
                {records.map((r) => {
                  const s = STATUS[r.status] ?? { label: r.status, tone: 'pill-ink', desc: '' };
                  return (
                    <li key={r.id} className="grid gap-1 p-4 sm:grid-cols-[1fr_auto] sm:items-center" data-testid={'row-reminder-' + r.id}>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{taskTitle.get(r.taskId) ?? 'Archived or unavailable task'}</p>
                        <p className="mt-0.5 font-mono text-xs text-muted-foreground">scheduled {formatDate(r.scheduledAt)}{r.deliveredAt ? ' · delivered ' + formatDate(r.deliveredAt) : ''}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{r.reason==='EMAIL_ATTEMPT_LIMIT_REACHED'
                          ?'Delivery paused after five attempts. Your task and due date are unchanged.'
                          :r.reason==='EMAIL_ACCEPTANCE_UNCONFIRMED'?s.desc:r.reason?REASONS[r.reason]??'This reminder is paused. Contact support for details.':s.desc}</p>
                        {r.reason==='EMAIL_ATTEMPT_LIMIT_REACHED'&&<a href="/help" className="mt-1 inline-block text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4">Contact support</a>}
                        {r.lastAttemptAt&&<p className="mt-1 text-xs text-muted-foreground">Attempts: {r.attempts} · Last attempt {formatDate(r.lastAttemptAt)}</p>}
                        {r.nextAttemptAt&&<p className="mt-1 text-xs text-muted-foreground">{r.reason==='EMAIL_DISPATCH_IN_PROGRESS'?'If interrupted, recovery is available after ':'Retry after '}{formatDate(r.nextAttemptAt)} if reminders are still enabled.</p>}
                      </div>
                      <span className={'pill w-fit ' + s.tone}><span className="dot" />{s.label}</span>
                    </li>
                  );
                })}
              </ul>
            )}
        </section>
      </div>
    </div>
  );
}
