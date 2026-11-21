import { useMemo, useState, useRef, useCallback, useEffect } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Archive, CalendarDays, CheckCircle2, ListTodo, Loader2, Pencil, Plus } from "lucide-react";
import {
  useCreateTask,
  useUpdateTask,
  useDeleteTask,
  getListTasksQueryKey,
  getListRemindersQueryKey,
  useListTasksPage,
  getListTasksPageQueryKey,
  TaskState,
  type WorkspaceTask,
  type TaskPage,
} from "@workspace/api-client-react";
import { WorkspaceNav } from "@/components/workspace-nav";
import { TaskForm, emptyDraft, type TaskDraft } from "@/components/task-form";
import { EmptyState, ErrorState, Notice, Skel } from "@/components/states";
import { describeError } from "@/lib/api";
import { formatDateTime, formatDay } from "@/lib/format";
import { live } from "@/lib/checker";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useUnsavedNavigation } from "@/lib/use-unsaved-navigation";
import { UnsavedNavigationDialog } from "@/components/unsaved-navigation-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";

const STATE_LABEL: Record<TaskState, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  completed_by_user: "Done (by you)",
  needs_review: "Needs review",
};
const STATE_TONE: Record<TaskState, string> = {
  not_started: "pill-ink",
  in_progress: "pill-forest",
  completed_by_user: "pill-forest",
  needs_review: "pill-ochre",
};
type Filter = "open" | "done" | "all";

export default function TasksPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>("open");
  const [page, setPage] = useState(1),
    [editEpoch, setEditEpoch] = useState(0);
  const [pinned, setPinned] = useState<Record<string, WorkspaceTask>>({});
  const pinnedRef = useRef(pinned);
  /** The view asked for while a task edit is unsaved: the customer is asked before it is discarded. */
  const [leaving, setLeaving] = useState<{ filter: Filter; page: number } | null>(null);
  const pin = useCallback((editing: boolean, task: WorkspaceTask) => {
    if ((editing && pinnedRef.current[task.id]) || (!editing && !pinnedRef.current[task.id])) return;
    const next = { ...pinnedRef.current };
    if (editing) next[task.id] = task;
    else delete next[task.id];
    pinnedRef.current = next;
    setPinned(next);
  }, []);
  const tasks = useListTasksPage(
    { page, filter },
    { query: { queryKey: getListTasksPageQueryKey({ page, filter }), ...live } },
  );
  const [newOpen, setNewOpen] = useState(false);
  const [newDraft, setNewDraft] = useState<TaskDraft>(emptyDraft());
  const newDraftRef = useRef(newDraft);
  newDraftRef.current = newDraft;
  const navigation = useUnsavedNavigation(
    () =>
      Object.keys(pinnedRef.current).length > 0 ||
      JSON.stringify(newDraftRef.current) !== JSON.stringify(emptyDraft()),
  );
  // Leaving asks its own question, about every task edit that is not saved. A question about the
  // view, still open underneath it, is answered by staying.
  useEffect(() => {
    if (navigation.blocked) setLeaving(null);
  }, [navigation.blocked]);
  const create = useCreateTask();
  const { toast } = useToast();

  const rows = useMemo(() => {
    const all = [...(tasks.data?.items ?? [])];
    for (const task of Object.values(pinned)) if (!all.some((row) => row.id === task.id)) all.push(task);
    return all;
  }, [tasks.data, pinned]);
  function changeView(nextFilter: Filter, nextPage: number) {
    if (Object.keys(pinnedRef.current).length) setLeaving({ filter: nextFilter, page: nextPage });
    else changeViewNow(nextFilter, nextPage);
  }
  function changeViewNow(nextFilter: Filter, nextPage: number) {
    pinnedRef.current = {};
    setPinned({});
    setEditEpoch((value) => value + 1);
    setFilter(nextFilter);
    setPage(nextPage);
  }

  function createTask() {
    create.mutate(
      {
        data: {
          title: newDraft.title.trim(),
          notes: newDraft.notes,
          dueDate: newDraft.dueDate || null,
          dateConfirmed: !!newDraft.dueDate && newDraft.dateConfirmed,
          assessmentId: null,
          ruleId: null,
        },
      },
      {
        onSuccess: () => {
          void qc.invalidateQueries({ queryKey: getListTasksQueryKey() });
          void qc.invalidateQueries({ queryKey: getListTasksPageQueryKey() });
          void qc.invalidateQueries({ queryKey: getListRemindersQueryKey() });
          setNewDraft(emptyDraft());
          setNewOpen(false);
          create.reset();
          toast({ title: "Task created" });
        },
      },
    );
  }

  const total = tasks.data?.total ?? 0;
  const open = tasks.data?.openCount ?? 0;

  return (
    <div className="mx-auto max-w-4xl px-5 py-12 lg:px-8">
      <UnsavedNavigationDialog
        open={navigation.blocked}
        busy={create.isPending}
        saveLabel="Return to save tasks"
        onSave={() => navigation.stay()}
        onStay={() => navigation.stay()}
        onDiscard={() => navigation.proceed()}
      />
      <ConfirmDialog
        open={leaving !== null}
        title="Leave your task edits?"
        keep="Stay and save them"
        confirm="Discard them and change view"
        onKeep={() => setLeaving(null)}
        onConfirm={() => {
          const next = leaving;
          setLeaving(null);
          if (next) changeViewNow(next.filter, next.page);
        }}
      >
        You have task edits that are not saved. Changing this view discards them.
      </ConfirmDialog>
      <WorkspaceNav />
      <div className="reveal flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Personal tasks</p>
          <h1 className="font-display mt-2 text-4xl">Tasks</h1>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setNewOpen((o) => !o)}
          aria-expanded={newOpen}
          data-testid="button-new-task"
        >
          <Plus className="h-4 w-4" />
          New task
        </button>
      </div>
      <p className="mt-3 max-w-2xl text-muted-foreground">
        Your own to-do list. Marking a task done records your progress only; it is not approval or
        confirmation from any regulator.
      </p>

      {newOpen && (
        <div className="surface reveal mt-6 p-5 sm:p-6" data-testid="panel-new-task">
          <TaskForm
            idPrefix="new"
            draft={newDraft}
            onChange={setNewDraft}
            onSubmit={createTask}
            pending={create.isPending}
            submitLabel="Create task"
            extra={
              create.error ? (
                <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  {describeError(create.error).message}
                </p>
              ) : undefined
            }
            footer={
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setNewOpen(false)}>
                Close
              </button>
            }
          />
          <p className="hint mt-3">
            To link a task to a rule, open a saved assessment and use "Add task" on a likely relevant item.
          </p>
        </div>
      )}

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <div
          role="group"
          aria-label="Filter tasks"
          className="inline-flex rounded-full border border-border bg-card p-1"
        >
          {(["open", "done", "all"] as Filter[]).map((f) => (
            <button
              key={f}
              aria-pressed={filter === f}
              type="button"
              onClick={() => changeView(f, 1)}
              className={cn(
                "rounded-full px-4 py-1.5 text-sm capitalize focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                filter === f
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground",
              )}
              data-testid={"tab-" + f}
            >
              {f}
            </button>
          ))}
        </div>
        {tasks.isSuccess && (
          <span className="font-mono text-xs text-muted-foreground">
            {open} open / {total} total
          </span>
        )}
      </div>

      <div className="mt-3 flex justify-end">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={tasks.isFetching}
          onClick={() => tasks.refetch()}
          data-testid="button-refresh-tasks"
        >
          {tasks.isFetching ? "Refreshing…" : "Refresh tasks"}
        </button>
      </div>
      <div className="mt-4">
        {tasks.isError && rows.length > 0 && (
          <p role="alert" className="mb-3 text-sm text-destructive">
            Refresh failed. Your open edits are still here; retry without closing them.
          </p>
        )}
        {tasks.isLoading && !rows.length ? (
          <div className="grid gap-3">
            {[0, 1, 2].map((i) => (
              <Skel key={i} className="h-24" />
            ))}
          </div>
        ) : tasks.isError && !rows.length ? (
          <ErrorState error={tasks.error} onRetry={() => tasks.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            mark={<ListTodo className="h-5 w-5 text-muted-foreground" />}
            title={total === 0 ? "No tasks yet" : "Nothing in this view"}
            action={
              total === 0 ? (
                <>
                  <button type="button" className="btn btn-primary" onClick={() => setNewOpen(true)}>
                    Write a task
                  </button>
                  <Link href="/workspace/assessments" className="btn btn-ghost">
                    From an assessment
                  </Link>
                </>
              ) : undefined
            }
          >
            {total === 0
              ? "Add anything you need to remember. Tasks work even where Valo has no released rules for your situation."
              : "Try another filter."}
          </EmptyState>
        ) : (
          <ul className="grid gap-3">
            {rows.map((t) => (
              <TaskRow key={`${editEpoch}-${t.id}`} task={t} onEditing={pin} />
            ))}
          </ul>
        )}
      </div>
      {!!Object.keys(pinned).length && (
        <p role="status" className="hint">
          Open edits are kept here even when background results change. Save or discard them before changing
          pages.
        </p>
      )}
      {tasks.isSuccess && (
        <nav aria-label="Task pages" className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={page === 1}
            onClick={() => changeView(filter, page - 1)}
            data-testid="button-task-prev"
          >
            Previous
          </button>
          <span className="text-sm" data-testid="text-task-total">
            Page {page} · {tasks.data.filteredTotal} matching tasks · {tasks.data.total} total
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={!tasks.data.hasNext}
            onClick={() => changeView(filter, page + 1)}
            data-testid="button-task-next"
          >
            Next
          </button>
        </nav>
      )}
    </div>
  );
}

function toDraft(t: WorkspaceTask): TaskDraft {
  return { title: t.title, notes: t.notes, dueDate: t.dueDate ?? "", dateConfirmed: t.dateConfirmed };
}

function TaskRow({
  task,
  onEditing,
}: {
  task: WorkspaceTask;
  onEditing: (editing: boolean, task: WorkspaceTask) => void;
}) {
  const qc = useQueryClient();
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: getListTasksQueryKey() }),
      qc.invalidateQueries({ queryKey: getListTasksPageQueryKey() }),
      qc.invalidateQueries({ queryKey: getListRemindersQueryKey() }),
    ]);
  const update = useUpdateTask({
    mutation: {
      onMutate: () => qc.cancelQueries({ queryKey: getListTasksQueryKey() }),
      onSuccess: (saved) => {
        qc.setQueryData<WorkspaceTask[]>(getListTasksQueryKey(), (old) =>
          old?.map((row) => (row.id === saved.id ? saved : row)),
        );
        qc.setQueriesData<TaskPage>({ queryKey: getListTasksPageQueryKey() }, (old) =>
          old ? { ...old, items: old.items.map((row) => (row.id === saved.id ? saved : row)) } : old,
        );
        return refresh();
      },
    },
  });
  const archive = useDeleteTask({
    mutation: {
      onMutate: () => qc.cancelQueries({ queryKey: getListTasksQueryKey() }),
      onSuccess: (_result, variables) => {
        qc.setQueryData<WorkspaceTask[]>(getListTasksQueryKey(), (old) =>
          old?.filter((row) => row.id !== variables.id),
        );
        return refresh();
      },
    },
  });
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    onEditing(editing, task);
    return () => onEditing(false, task);
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- keyed on the task's id, so a refetched task does not report editing stopping and starting
  }, [editing, task.id, onEditing]);
  const [draft, setDraft] = useState<TaskDraft | null>(null);
  const [baseRev, setBaseRev] = useState(task.revision);
  const [conflict, setConflict] = useState<number | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);

  function startEdit() {
    setDraft(toDraft(task));
    setBaseRev(task.revision);
    setConflict(null);
    update.reset();
    setEditing(true);
  }

  function saveEdit(rev = baseRev) {
    if (!draft) return;
    update.mutate(
      {
        id: task.id,
        data: {
          title: draft.title.trim(),
          notes: draft.notes,
          dueDate: draft.dueDate || null,
          dateConfirmed: !!draft.dueDate && draft.dateConfirmed,
          state: task.state,
          expectedRevision: rev,
        },
      },
      {
        onSuccess: () => {
          setEditing(false);
          setDraft(null);
          setConflict(null);
        },
        onError: (e) => {
          const d = describeError(e);
          if (d.kind === "conflict") {
            setConflict(d.currentRevision ?? -1);
            void refresh();
          }
        },
      },
    );
  }

  function setState(state: TaskState) {
    update.mutate(
      {
        id: task.id,
        data: {
          title: task.title,
          notes: task.notes,
          dueDate: task.dueDate,
          dateConfirmed: task.dateConfirmed,
          state,
          expectedRevision: task.revision,
        },
      },
      {
        onError: (e) => {
          if (describeError(e).kind === "conflict") void refresh();
        },
      },
    );
  }

  function doArchive() {
    archive.mutate(
      { id: task.id, data: { expectedRevision: task.revision } },
      {
        onError: (e) => {
          if (describeError(e).kind === "conflict") void refresh();
          setConfirmArchive(false);
        },
      },
    );
  }

  const err = !conflict && update.error ? describeError(update.error) : null;
  const archErr = archive.error ? describeError(archive.error) : null;
  const done = task.state === "completed_by_user";
  const latestDiffers = conflict !== null && task.revision !== baseRev;

  return (
    <li
      className={cn("surface p-5 transition-opacity", done && !editing && "opacity-80")}
      data-testid={"card-task-" + task.id}
    >
      {editing && draft ? (
        <>
          <p className="eyebrow mb-4">Editing version {baseRev}</p>
          {conflict !== null && (
            <Notice className="mb-4" title="This task changed elsewhere">
              What you typed is still in the form below. The newest saved one is version {task.revision}
              {latestDiffers ? "" : " (refreshing)"}.
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn btn-ink btn-sm"
                  disabled={update.isPending}
                  onClick={() => {
                    setBaseRev(task.revision);
                    saveEdit(task.revision);
                  }}
                  data-testid={"button-overwrite-" + task.id}
                >
                  Save mine over version {task.revision}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setDraft(toDraft(task));
                    setBaseRev(task.revision);
                    setConflict(null);
                    update.reset();
                  }}
                  data-testid={"button-load-latest-" + task.id}
                >
                  Discard mine and load the newest
                </button>
              </div>
            </Notice>
          )}
          <TaskForm
            idPrefix={"edit-" + task.id}
            draft={draft}
            onChange={setDraft}
            onSubmit={() => saveEdit()}
            pending={update.isPending}
            submitLabel="Save changes"
            extra={
              err ? (
                <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  {err.message}
                </p>
              ) : undefined
            }
            footer={
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setEditing(false);
                  setDraft(null);
                  setConflict(null);
                  update.reset();
                }}
              >
                Discard edits
              </button>
            }
          />
        </>
      ) : (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <button
            type="button"
            aria-label={done ? "Mark as not done" : "Mark done by me"}
            disabled={update.isPending}
            onClick={() => setState(done ? "in_progress" : "completed_by_user")}
            className={cn(
              "grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              done
                ? "border-primary bg-primary text-primary-foreground"
                : "border-input hover:border-primary",
            )}
            data-testid={"button-toggle-" + task.id}
          >
            {update.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : done ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : null}
          </button>
          <div className="min-w-0 flex-1">
            <p
              className={cn(
                "font-medium leading-snug",
                done && "line-through decoration-muted-foreground/60",
              )}
            >
              {task.title}
            </p>
            {task.notes && (
              <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                {task.notes}
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <span className={"pill " + STATE_TONE[task.state]}>{STATE_LABEL[task.state]}</span>
              {task.needsReview && (
                <span className="pill pill-ochre">Linked rule changed. Review this task.</span>
              )}
              {task.dueDate && (
                <span className="pill pill-ink">
                  <CalendarDays className="h-3 w-3" />
                  {formatDay(task.dueDate)}
                  {task.dateConfirmed ? "" : " (unconfirmed)"}
                </span>
              )}
              {task.ruleId && task.assessmentId && (
                <Link
                  href={"/workspace/assessments/" + task.assessmentId}
                  className="text-muted-foreground underline underline-offset-2"
                  title={"Rule " + task.ruleId}
                >
                  From a saved result
                </Link>
              )}
              <span className="text-muted-foreground">
                Version {task.revision} · saved {formatDateTime(task.updatedAt)}
              </span>
            </div>
            {done && (
              <p className="mt-2 text-xs text-muted-foreground">
                Recorded as done by you. Not regulator approval.
              </p>
            )}
            {err && (
              <p role="alert" className="mt-2 text-sm text-destructive">
                {err.kind === "conflict"
                  ? "This task changed elsewhere; the list has been refreshed. Try again."
                  : err.message}
              </p>
            )}
            {archErr && (
              <p role="alert" className="mt-2 text-sm text-destructive">
                {archErr.kind === "conflict"
                  ? "This task changed elsewhere; refreshed. Archive again if you still want to."
                  : archErr.message}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:flex-col sm:items-end">
            <label className="sr-only" htmlFor={"state-" + task.id}>
              Status
            </label>
            <select
              id={"state-" + task.id}
              className="field !min-h-9 !py-1 text-sm sm:w-40"
              value={task.state}
              disabled={update.isPending}
              onChange={(e) => setState(e.target.value as TaskState)}
              data-testid={"select-state-" + task.id}
            >
              {Object.values(TaskState).map((s) => (
                <option key={s} value={s}>
                  {STATE_LABEL[s]}
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={startEdit}
                data-testid={"button-edit-" + task.id}
              >
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </button>
              {confirmArchive ? (
                <span className="flex gap-1">
                  <button
                    type="button"
                    className="btn btn-ink btn-sm"
                    disabled={archive.isPending}
                    onClick={doArchive}
                    data-testid={"button-confirm-archive-" + task.id}
                  >
                    {archive.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Archive
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setConfirmArchive(false)}
                  >
                    Keep
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  aria-label="Archive task"
                  onClick={() => {
                    archive.reset();
                    setConfirmArchive(true);
                  }}
                  data-testid={"button-archive-" + task.id}
                >
                  <Archive className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </li>
  );
}
