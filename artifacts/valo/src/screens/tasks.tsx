import { useMemo, useState, useRef, useCallback, useEffect } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { ListTodo, Plus } from "lucide-react";
import {
  useCreateTask,
  getListTasksQueryKey,
  getListRemindersQueryKey,
  useListTasksPage,
  getListTasksPageQueryKey,
  type WorkspaceTask,
} from "@workspace/api-client-react";
import { WorkspaceNav } from "@/components/workspace-nav";
import { TaskForm, emptyDraft, type TaskDraft } from "@/components/task-form";
import { TaskRow } from "@/components/task-row";
import { EmptyState, ErrorState, Skel } from "@/components/states";
import { describeError } from "@/lib/api";
import { live } from "@/lib/checker";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useUnsavedNavigation } from "@/lib/use-unsaved-navigation";
import { UnsavedNavigationDialog } from "@/components/unsaved-navigation-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";

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
        title="Leave unsaved task changes?"
        description="You have task edits that are not saved. Stay here to finish and save them, or leave and discard them."
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
            To link a task to a rule, open a saved result and use "Add task" on an item marked "Likely
            relevant".
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
                    From a saved result
                  </Link>
                </>
              ) : undefined
            }
          >
            {total === 0
              ? "Add anything you need to remember. Tasks work even where no published rule covers your situation."
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
