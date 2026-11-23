import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BellOff, BellRing, CalendarPlus, Clock, Loader2 } from "lucide-react";
import { Link } from "wouter";
import {
  useGetReminderPreferences,
  useSaveReminderPreferences,
  useListReminders,
  useListTasks,
  getGetReminderPreferencesQueryKey,
  getListRemindersQueryKey,
  getListTasksQueryKey,
  ReminderPreferencesInputOffsetsItem,
  type ReminderPreferencesInputOffsetsItem as Offset,
  type ReminderRecordStatus,
} from "@workspace/api-client-react";
import { WorkspaceNav } from "@/components/workspace-nav";
import { useAccountEpoch } from "@/components/account-state-boundary";
import { EmptyState, ErrorState, Notice, Skel } from "@/components/states";
import { UnsavedNavigationDialog } from "@/components/unsaved-navigation-dialog";
import { describeError } from "@/lib/api";
import { buildTasksIcs, downloadIcsFile } from "@/lib/calendar-export";
import { formatDateTime } from "@/lib/format";
import { live } from "@/lib/checker";
import { REMINDER_STATUS, reminderMeaning, reminderNeedsHelp, triedTimes } from "@/lib/reminder-words";
import { useUnsavedNavigation } from "@/lib/use-unsaved-navigation";
import { cn } from "@/lib/utils";

const OFFSETS = Object.values(ReminderPreferencesInputOffsetsItem) as Offset[];
const offsetLabel = (n: number) =>
  n === 0 ? "On the due date" : n === 1 ? "1 day before" : n + " days before";
/** The colour of each state's label. */
const TONE: Record<ReminderRecordStatus, string> = {
  held: "pill-ochre",
  pending: "pill-ink",
  sent: "pill-forest",
  cancelled: "pill-ink",
  failed: "pill-ochre",
};

export default function RemindersPage() {
  const currentAccount = useAccountEpoch();
  const qc = useQueryClient();
  const prefs = useGetReminderPreferences({
    query: { queryKey: getGetReminderPreferencesQueryKey(), ...live },
  });
  const log = useListReminders({ query: { queryKey: getListRemindersQueryKey(), ...live } });
  const tasks = useListTasks({ query: { queryKey: getListTasksQueryKey(), ...live } });
  const save = useSaveReminderPreferences();

  const [enabled, setEnabled] = useState(false);
  const [offsets, setOffsets] = useState<Offset[]>([1]);
  const [savedSnapshot, setSavedSnapshot] = useState<{ enabled: boolean; offsets: Offset[] } | null>(null);
  const [rev, setRev] = useState(0);
  const [conflict, setConflict] = useState(false);
  const [savedNote, setSavedNote] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const init = useRef(false);
  const form = useRef<HTMLFormElement>(null),
    leaving = useRef(false);

  const dirty =
    savedSnapshot !== null &&
    (enabled !== savedSnapshot.enabled ||
      offsets.length !== savedSnapshot.offsets.length ||
      offsets.some((value, index) => value !== savedSnapshot.offsets[index]));
  const navigation = useUnsavedNavigation(() => dirty || save.isPending);

  useEffect(() => {
    if (prefs.data && !init.current) {
      init.current = true;
      const loadedOffsets = (prefs.data.offsets.filter((o) => (OFFSETS as number[]).includes(o)) as Offset[])
        .sort((a, b) => a - b)
        .slice(0, 4);
      setEnabled(prefs.data.enabled);
      setOffsets(loadedOffsets);
      setSavedSnapshot({ enabled: prefs.data.enabled, offsets: loadedOffsets });
      setRev(prefs.data.revision);
    }
  }, [prefs.data]);

  const taskTitle = useMemo(() => new Map((tasks.data ?? []).map((t) => [t.id, t.title])), [tasks.data]);
  const records = useMemo(
    () => [...(log.data ?? [])].sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt)),
    [log.data],
  );

  function toggle(o: Offset) {
    setSavedNote(false);
    setOffsets((cur) =>
      cur.includes(o)
        ? cur.filter((x) => x !== o)
        : cur.length >= 4
          ? cur
          : [...cur, o].sort((a, b) => a - b),
    );
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setSavedNote(false);
    if (enabled && offsets.length < 1) {
      leaving.current = false;
      setErr("Choose at least one time while reminders are on.");
      return;
    }
    save.mutate(
      { data: { enabled, offsets, expectedRevision: rev } },
      {
        onSuccess: (p) => {
          if (!currentAccount()) return;
          const nextOffsets = (p.offsets.filter((o) => (OFFSETS as number[]).includes(o)) as Offset[])
            .sort((a, b) => a - b)
            .slice(0, 4);
          setRev(p.revision);
          setSavedSnapshot({ enabled: p.enabled, offsets: nextOffsets });
          setConflict(false);
          setSavedNote(true);
          qc.setQueryData(getGetReminderPreferencesQueryKey(), p);
          void qc.invalidateQueries({ queryKey: getListRemindersQueryKey() });
          if (leaving.current) {
            leaving.current = false;
            navigation.proceed();
          }
        },
        onError: (er) => {
          if (!currentAccount()) return;
          leaving.current = false;
          const d = describeError(er);
          if (d.kind === "conflict") {
            setConflict(true);
            void qc.invalidateQueries({ queryKey: getGetReminderPreferencesQueryKey() });
          } else setErr(d.message);
        },
      },
    );
  }

  async function loadLatest() {
    const r = await prefs.refetch();
    if (!currentAccount()) return;
    if (r.data) {
      const nextOffsets = (r.data.offsets.filter((o) => (OFFSETS as number[]).includes(o)) as Offset[])
        .sort((a, b) => a - b)
        .slice(0, 4);
      setEnabled(r.data.enabled);
      setOffsets(nextOffsets);
      setSavedSnapshot({ enabled: r.data.enabled, offsets: nextOffsets });
      setRev(r.data.revision);
    }
    setConflict(false);
    setErr(null);
    save.reset();
  }

  const p = prefs.data;

  return (
    <div className="mx-auto max-w-5xl px-5 py-12 lg:px-8">
      <WorkspaceNav />
      <div className="reveal">
        <p className="eyebrow">Due-date reminders</p>
        <h1 className="font-display mt-2 text-4xl">Reminders</h1>
      </div>
      <p className="mt-3 max-w-2xl text-muted-foreground">
        Reminders are off unless you turn them on. They apply only to tasks with a due date you have
        confirmed.
      </p>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_1.15fr]">
        <section aria-labelledby="pref-h">
          {prefs.isLoading ? (
            <Skel className="h-80" />
          ) : prefs.isError || !p ? (
            <ErrorState error={prefs.error} onRetry={() => prefs.refetch()} />
          ) : (
            <form ref={form} onSubmit={submit} noValidate className="surface grid gap-6 p-5 sm:p-7">
              <h2 id="pref-h" className="font-display text-2xl">
                Preferences
              </h2>

              <div
                className={cn(
                  "rounded-xl border p-4 text-sm",
                  p.deliveryAvailable
                    ? "border-[hsl(var(--forest-border))] bg-accent"
                    : "border-[hsl(var(--ochre-border))] bg-[hsl(var(--ochre-soft))]",
                )}
                data-testid="status-delivery"
              >
                <p className="flex items-center gap-2 font-medium">
                  {p.deliveryAvailable ? (
                    <BellRing className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <BellOff className="h-4 w-4" aria-hidden="true" />
                  )}
                  {p.deliveryAvailable ? "Test emails only" : "Reminder emails are not being sent yet"}
                </p>
                <p className="mt-1 text-foreground/80">
                  {p.deliveryAvailable
                    ? "Valo is still being built. A reminder is sent only as a test, to the workspace owner's verified email address."
                    : "You can save your choices now. Nothing is sent, and each reminder stays on hold, until sending is switched on."}
                </p>
                {(tasks.data ?? []).some((t) => t.dueDate && t.state !== "completed_by_user") && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm mt-3"
                    onClick={() => {
                      const ics = buildTasksIcs(tasks.data ?? [], {
                        alarmDaysBefore: offsets.length ? offsets : [7, 1, 0],
                      });
                      if (ics) downloadIcsFile(ics, "valo-deadlines.ics");
                    }}
                    data-testid="button-export-reminders-ics"
                  >
                    <CalendarPlus className="h-4 w-4" aria-hidden="true" />
                    Download phone/calendar alerts (.ics)
                  </button>
                )}
              </div>

              <label className="flex cursor-pointer items-center justify-between gap-4">
                <span>
                  <span className="block font-medium">Send email reminders before a task is due</span>
                  <span className="text-sm text-muted-foreground">
                    Off unless you turn it on. You can turn it off at any time.
                  </span>
                </span>
                <span className="relative inline-flex">
                  <input
                    type="checkbox"
                    // oxlint-disable-next-line jsx-a11y/role-has-required-aria-props -- the native checkbox exposes its checked state to the switch role
                    role="switch"
                    className="peer sr-only"
                    checked={enabled}
                    onChange={(e) => {
                      setEnabled(e.target.checked);
                      setSavedNote(false);
                    }}
                    data-testid="switch-enabled"
                  />
                  <span className="h-7 w-12 rounded-full bg-input transition-colors peer-checked:bg-primary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring" />
                  <span className="pointer-events-none absolute left-1 top-1 h-5 w-5 rounded-full bg-card shadow transition-transform peer-checked:translate-x-5" />
                </span>
              </label>

              <fieldset disabled={!enabled} className="disabled:opacity-50">
                <legend className="label">How long before the due date (choose up to 4)</legend>
                <div className="flex flex-wrap gap-2">
                  {OFFSETS.map((o) => {
                    const on = offsets.includes(o);
                    const blocked = !on && offsets.length >= 4;
                    return (
                      <label
                        key={o}
                        className={cn(
                          "cursor-pointer rounded-full border px-3.5 py-2 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring",
                          on
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-input hover:bg-secondary",
                          blocked && "cursor-not-allowed opacity-50",
                        )}
                      >
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={on}
                          disabled={blocked}
                          onChange={() => toggle(o)}
                          data-testid={"checkbox-offset-" + o}
                        />
                        {offsetLabel(o)}
                      </label>
                    );
                  })}
                </div>
                <p className="hint">Each reminder is planned for 09:00, Lagos time.</p>
              </fieldset>

              {conflict && (
                <Notice title="Your preferences were changed somewhere else">
                  What you chose above is still here. To go on, load the preferences that were saved last.
                  That replaces what you chose above.
                  <button
                    type="button"
                    className="btn btn-ink btn-sm mt-3"
                    onClick={loadLatest}
                    data-testid="button-reload-prefs"
                  >
                    Load the saved preferences
                  </button>
                </Notice>
              )}
              {err && (
                <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  {err}
                </p>
              )}
              {savedNote && (
                <p
                  role="status"
                  className="rounded-xl bg-secondary px-4 py-3 text-sm"
                  data-testid="status-saved"
                >
                  Preferences saved. Saving sends nothing
                  {p.deliveryAvailable ? "" : ", and reminder emails are not being sent yet"}. The delivery
                  log shows what has happened to each reminder.
                </p>
              )}
              <button
                type="submit"
                className="btn btn-primary w-fit"
                disabled={save.isPending || conflict}
                data-testid="button-save-prefs"
              >
                {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Save preferences
              </button>
            </form>
          )}
        </section>

        <section aria-labelledby="log-h">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
            <h2 id="log-h" className="font-display text-2xl">
              Delivery log
            </h2>
            <span className="text-xs text-muted-foreground">What has happened to each reminder</span>
          </div>
          {log.isLoading ? (
            <div className="grid gap-2">
              {[0, 1, 2].map((i) => (
                <Skel key={i} className="h-16" />
              ))}
            </div>
          ) : log.isError ? (
            <ErrorState error={log.error} onRetry={() => log.refetch()} />
          ) : records.length === 0 ? (
            <EmptyState
              mark={<Clock className="h-5 w-5 text-muted-foreground" />}
              title="No reminders yet"
              action={
                <Link href="/workspace/tasks" className="btn btn-ghost">
                  Go to your tasks
                </Link>
              }
            >
              A reminder appears here once reminders are on and a task has a due date you have confirmed.
            </EmptyState>
          ) : (
            <ul className="surface divide-y divide-border overflow-hidden" data-testid="list-reminders">
              {records.map((r) => (
                <li
                  key={r.id}
                  className="grid gap-1 p-4 sm:grid-cols-[1fr_auto] sm:items-center"
                  data-testid={"row-reminder-" + r.id}
                >
                  <div className="min-w-0">
                    <p className="break-words text-sm font-medium">
                      {taskTitle.has(r.taskId) ? (
                        <Link
                          href={
                            "/workspace/tasks?filter=all&q=" + encodeURIComponent(taskTitle.get(r.taskId)!)
                          }
                          className="underline decoration-border underline-offset-4 hover:decoration-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                          data-testid={"link-reminder-task-" + r.id}
                        >
                          {taskTitle.get(r.taskId)}
                        </Link>
                      ) : (
                        "A task no longer in your list"
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Planned for {formatDateTime(r.scheduledAt)}
                      {r.deliveredAt ? " · Delivered " + formatDateTime(r.deliveredAt) : ""}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">{reminderMeaning(r)}</p>
                    {reminderNeedsHelp(r) && (
                      <Link
                        href="/support"
                        className="mt-1 inline-block text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4"
                      >
                        Report a problem
                      </Link>
                    )}
                    {r.lastAttemptAt && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {triedTimes(r.attempts)} Last tried {formatDateTime(r.lastAttemptAt)}.
                      </p>
                    )}
                    {r.nextAttemptAt && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {r.reason === "EMAIL_DISPATCH_IN_PROGRESS"
                          ? "If this try is cut short, Valo tries again after "
                          : r.status === "held"
                            ? "Valo looks at this again after "
                            : "Valo tries again after "}
                        {formatDateTime(r.nextAttemptAt)}, if reminders are still on.
                      </p>
                    )}
                  </div>
                  <span className={"pill w-fit " + (TONE[r.status] ?? "pill-ink")}>
                    <span className="dot" />
                    {REMINDER_STATUS[r.status]?.label ?? r.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <UnsavedNavigationDialog
        open={navigation.blocked}
        busy={save.isPending}
        description="You have unsaved changes to your reminder preferences. Save, discard them, or stay on this page."
        onSave={() => {
          if (conflict) return;
          if (enabled && offsets.length < 1) {
            setErr("Choose at least one time while reminders are on.");
            return;
          }
          leaving.current = true;
          form.current?.requestSubmit();
        }}
        onDiscard={navigation.proceed}
        onStay={navigation.stay}
        error={
          conflict
            ? "Your preferences were changed somewhere else. Load the saved preferences before saving."
            : (err ?? undefined)
        }
      />
    </div>
  );
}
