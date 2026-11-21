import { useState, type FormEvent, type ReactNode } from "react";
import { Loader2 } from "lucide-react";

export interface TaskDraft {
  title: string;
  notes: string;
  dueDate: string;
  dateConfirmed: boolean;
}

export const emptyDraft = (title = ""): TaskDraft => ({
  title,
  notes: "",
  dueDate: "",
  dateConfirmed: false,
});

export function validateDraft(d: TaskDraft): Record<string, string> {
  const e: Record<string, string> = {};
  if (!d.title.trim()) e.title = "Give the task a short title.";
  else if (d.title.trim().length > 200) e.title = "Keep the title under 200 characters.";
  if (d.notes.length > 6000) e.notes = "Notes are limited to 6,000 characters.";
  if (d.dueDate && !d.dateConfirmed) e.dueDate = "Tick the confirmation to keep this due date, or clear it.";
  return e;
}

/** Controlled task fields. Parent owns the draft so unsaved text survives conflicts and refetches. */
export function TaskForm({
  idPrefix,
  draft,
  onChange,
  onSubmit,
  pending,
  submitLabel,
  extra,
  footer,
}: {
  idPrefix: string;
  draft: TaskDraft;
  onChange: (d: TaskDraft) => void;
  onSubmit: () => void;
  pending: boolean;
  submitLabel: string;
  extra?: ReactNode;
  footer?: ReactNode;
}) {
  const [touched, setTouched] = useState(false);
  const errors = validateDraft(draft);
  const set = <K extends keyof TaskDraft>(k: K, v: TaskDraft[K]) =>
    onChange({ ...draft, [k]: v, ...(k === "dueDate" ? { dateConfirmed: false } : {}) });
  function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (Object.keys(errors).length) return;
    onSubmit();
  }
  const err = (k: string) => (touched ? errors[k] : undefined);
  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <div>
        <label className="label" htmlFor={idPrefix + "-title"}>
          Title
        </label>
        <input
          id={idPrefix + "-title"}
          className="field"
          maxLength={200}
          value={draft.title}
          aria-invalid={!!err("title")}
          aria-describedby={err("title") ? idPrefix + "-title-err" : undefined}
          onChange={(e) => set("title", e.target.value)}
          data-testid={"input-" + idPrefix + "-title"}
        />
        {err("title") && (
          <p id={idPrefix + "-title-err"} className="hint !text-destructive">
            {err("title")}
          </p>
        )}
      </div>
      <div>
        <label className="label" htmlFor={idPrefix + "-notes"}>
          Notes <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <textarea
          id={idPrefix + "-notes"}
          rows={3}
          className="field"
          maxLength={6000}
          value={draft.notes}
          onChange={(e) => set("notes", e.target.value)}
          data-testid={"input-" + idPrefix + "-notes"}
        />
        {err("notes") && <p className="hint !text-destructive">{err("notes")}</p>}
      </div>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,14rem)_1fr] sm:items-start">
        <div>
          <label className="label" htmlFor={idPrefix + "-due"}>
            Due date <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <div className="flex gap-2">
            <input
              id={idPrefix + "-due"}
              type="date"
              className="field"
              value={draft.dueDate}
              aria-invalid={!!err("dueDate")}
              onChange={(e) => set("dueDate", e.target.value)}
              data-testid={"input-" + idPrefix + "-due"}
            />
            {draft.dueDate && (
              <button
                type="button"
                className="btn btn-ghost btn-sm shrink-0"
                onClick={() => set("dueDate", "")}
              >
                Clear
              </button>
            )}
          </div>
        </div>
        {draft.dueDate && (
          <label className="mt-0 flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-sidebar p-3 text-sm sm:mt-6">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-[hsl(155_42%_21%)]"
              checked={draft.dateConfirmed}
              onChange={(e) => onChange({ ...draft, dateConfirmed: e.target.checked })}
              data-testid={"checkbox-" + idPrefix + "-confirm"}
            />
            <span>I checked this date myself. Valo does not supply or verify official deadlines.</span>
          </label>
        )}
      </div>
      {err("dueDate") && (
        <p role="alert" className="hint !mt-0 !text-destructive">
          {err("dueDate")}
        </p>
      )}
      {extra}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          className="btn btn-primary btn-sm"
          disabled={pending}
          data-testid={"button-" + idPrefix + "-submit"}
        >
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          {submitLabel}
        </button>
        {footer}
      </div>
    </form>
  );
}
