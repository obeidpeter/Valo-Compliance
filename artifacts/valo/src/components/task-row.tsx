import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Archive, CalendarDays, CheckCircle2, Loader2, Pencil } from "lucide-react";
import {
  useUpdateTask,
  useDeleteTask,
  getListTasksQueryKey,
  getListRemindersQueryKey,
  getListTasksPageQueryKey,
  TaskState,
  type WorkspaceTask,
  type TaskPage,
} from "@workspace/api-client-react";
import { TaskForm, type TaskDraft } from "@/components/task-form";
import { Notice } from "@/components/states";
import { describeError } from "@/lib/api";
import { formatDateTime, formatDay } from "@/lib/format";
import { cn } from "@/lib/utils";

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

function toDraft(t: WorkspaceTask): TaskDraft {
  return { title: t.title, notes: t.notes, dueDate: t.dueDate ?? "", dateConfirmed: t.dateConfirmed };
}

export function TaskRow({
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
            <Notice className="mb-4" title="This task was changed somewhere else">
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
                  ? "This task was changed somewhere else. The list now shows its newest version. Try again."
                  : err.message}
              </p>
            )}
            {archErr && (
              <p role="alert" className="mt-2 text-sm text-destructive">
                {archErr.kind === "conflict"
                  ? "This task was changed somewhere else. The list now shows its newest version. Archive it again if you still want to."
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
