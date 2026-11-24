import { useEffect, useMemo, useRef, useState, type FocusEvent, type ReactNode } from "react";
import { ArrowDownRight, Check, Copy, Info, Plus, Trash2 } from "lucide-react";
import type { GuidedField, GuidedTable } from "@workspace/valo-core/guided";
import { guidedFieldIssue, guidedVisible } from "@workspace/valo-core/guided-runtime";
import { formIssues, type FormValue, type FormView } from "@/lib/form-view";
import { formatNaira, lagosToday } from "@/lib/format";
import { DATE_QUICK_OFFSETS, addCalendarDays } from "@/lib/date-shortcuts";
import { MONEY_HELP, askedAs, lineSubtotalKobo, saidAs, shownAmount, storedAmount } from "@/lib/guided-money";
import { computeGuidedProgress } from "@/lib/guided-progress";
import { cn } from "@/lib/utils";

/**
 * Guided form for a document template. Pure: all values live in `value`.
 * Every input stores the exact typed text, so invalid edits stay visible and are
 * reported as issues rather than silently replaced by an older valid amount.
 * Money is typed in naira and stored as whole kobo (integer string), worked out from the digits
 * alone; what is not an amount is stored as typed. The amount is read back with the naira sign.
 */

const KOBO = /^(0|[1-9]\d{0,23})$/;

export function koboToNgnDisplay(k: string): string | null {
  return KOBO.test(k) ? formatNaira(k) : null;
}

export function checkField(f: GuidedField, raw: string | undefined): string | null {
  return guidedFieldIssue(f, raw);
}

export function isVisible(f: Pick<GuidedField, "when">, values: Record<string, string>) {
  return guidedVisible(f, values);
}

/** Issues keyed by field id, or `table:rowIndex:columnId` for table cells. Hidden fields are skipped. */
export function guidedIssues(spec: FormView, value: FormValue): Record<string, string> {
  return formIssues(spec, value);
}

/** The questions of a v1 form, or of a v2 form that fills a released template's own wording. */
type Props = {
  spec: FormView;
  value: FormValue;
  onChange: (next: FormValue) => void;
  disabled?: boolean | undefined;
  onValidityChange?: (issues: Record<string, string>) => void;
};

export function GuidedFields({ spec, value, onChange, disabled, onValidityChange }: Props) {
  const issues = useMemo(() => guidedIssues(spec, value), [spec, value]);
  const cb = useRef(onValidityChange);
  cb.current = onValidityChange;
  const sig = JSON.stringify(issues);
  useEffect(() => {
    cb.current?.(issues);
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps
  const root = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<string | null>(null);
  useEffect(() => {
    if (!pendingFocus.current) return;
    root.current?.querySelector<HTMLElement>(pendingFocus.current)?.focus();
    pendingFocus.current = null;
  });

  if (value.templateId !== spec.templateId || value.schemaVersion !== spec.schemaVersion) {
    return (
      <div
        role="alert"
        className="rounded-2xl border border-destructive/40 bg-destructive/5 p-5 text-sm"
        data-testid="guided-mismatch"
      >
        <p className="font-medium text-destructive">These saved answers belong to a different form.</p>
        <p className="mt-1 text-muted-foreground">
          Expected {spec.templateId} (schema {spec.schemaVersion}); found {value.templateId} (schema{" "}
          {value.schemaVersion}). Nothing has been changed or converted.
        </p>
      </div>
    );
  }

  const fieldById = new Map(spec.fields.map((f) => [f.id, f]));
  const setValue = (id: string, v: string) => onChange({ ...value, values: { ...value.values, [id]: v } });
  const setRows = (tid: string, rows: Record<string, string>[]) =>
    onChange({ ...value, tables: { ...value.tables, [tid]: rows } });
  const placed = new Set(spec.sections.flatMap((s) => s.fieldIds));
  const loose = spec.fields.filter((f) => !placed.has(f.id));
  const total = Object.keys(issues).length;
  const progress = computeGuidedProgress(spec, value, issues);
  const hiddenWithValues = spec.fields.filter(
    (f) => !isVisible(f, value.values) && (value.values[f.id] ?? "").trim(),
  );

  function jumpToSelector(selector: string) {
    const el =
      root.current?.querySelector<HTMLElement>(selector) ?? document.querySelector<HTMLElement>(selector);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.focus();
  }

  function jumpToDomId(domId: string) {
    const el = document.getElementById(domId);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    const firstInput = el.querySelector<HTMLElement>("input, textarea, select, button");
    firstInput?.focus({ preventScroll: true });
  }

  const renderFields = (fs: readonly GuidedField[]) => (
    <div className="grid gap-5 sm:grid-cols-2">
      {fs
        .filter((f) => isVisible(f, value.values))
        .map((f) => (
          <FieldInput
            key={f.id}
            field={f}
            id={"g-" + f.id}
            value={value.values[f.id] ?? ""}
            error={issues[f.id]}
            disabled={disabled}
            onChange={(v) => setValue(f.id, v)}
          />
        ))}
    </div>
  );

  return (
    <div ref={root} className="grid gap-8" data-testid="guided-fields">
      <header className="grid gap-2">
        <p className="eyebrow">Questions</p>
        <h2 className="font-display text-2xl leading-tight">{spec.title}</h2>
        {spec.description && (
          <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">{spec.description}</p>
        )}
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <p
            className={cn("pill w-fit", total ? "pill-ochre" : "pill-forest")}
            aria-live="polite"
            data-testid="status-guided-issues"
          >
            <span className="dot" />
            {total
              ? `${total} ${total === 1 ? "answer needs" : "answers need"} attention`
              : "All shown answers are complete"}
          </p>
          {progress.firstIssueTarget && !disabled && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => jumpToSelector(progress.firstIssueTarget!.selector)}
              data-testid="button-next-blank"
            >
              <ArrowDownRight className="h-4 w-4" aria-hidden="true" /> Jump to next blank
            </button>
          )}
        </div>
        {progress.requiredTotal > 0 && (
          <div className="mt-2 grid gap-2" data-testid="guided-progress">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {progress.requiredDone} of {progress.requiredTotal} required answers complete
              </span>
              <span className="tabular-nums">{progress.percent}%</span>
            </div>
            <div
              className="h-2 w-full overflow-hidden rounded-full bg-secondary"
              role="progressbar"
              aria-label="Required answers progress"
              aria-valuenow={progress.percent}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-300"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
          </div>
        )}
        {progress.navItems.length > 1 && (
          <nav
            aria-label="Jump to section"
            className="mt-2 flex flex-wrap gap-2"
            data-testid="nav-guided-sections"
          >
            {progress.navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  item.done
                    ? "border-[hsl(var(--forest-border))] bg-accent/60 text-accent-foreground"
                    : "border-border bg-card text-foreground",
                )}
                onClick={() => jumpToDomId(item.domId)}
              >
                {item.done ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : null}
                <span>{item.label}</span>
                {!item.done && <span className="text-muted-foreground">({item.issueCount} left)</span>}
              </button>
            ))}
          </nav>
        )}
      </header>
      {Object.entries(issues)
        .filter(
          ([key]) =>
            !spec.fields.some((f) => f.id === key) &&
            !spec.tables.some((t) => t.id === key) &&
            !key.includes(":"),
        )
        .map(([key, message]) => (
          <p key={key} role="alert" className="text-sm text-destructive" data-testid={`guided-issue-${key}`}>
            {message}
          </p>
        ))}

      {spec.notices.length > 0 && (
        <ul
          className="grid gap-2 rounded-2xl border border-[hsl(var(--ochre-border))] bg-[hsl(var(--ochre-soft))] p-4 text-sm"
          data-testid="list-guided-notices"
        >
          {spec.notices.map((n, i) => (
            <li key={i} className="flex gap-2">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--ochre-foreground))]" aria-hidden />
              {n}
            </li>
          ))}
        </ul>
      )}

      {spec.sections.map((s) => {
        const fs = s.fieldIds.map((id) => fieldById.get(id)).filter((f): f is GuidedField => !!f);
        if (!fs.some((f) => isVisible(f, value.values))) return null;
        return (
          <fieldset
            key={s.id}
            id={"guided-sec-" + s.id}
            disabled={disabled}
            className="min-w-0 border-t border-border pt-6"
            data-testid={"section-" + s.id}
          >
            <legend className="font-display float-left mb-1 w-full text-xl">{s.label}</legend>
            {s.help && <p className="hint clear-both mb-4 !mt-0 max-w-prose">{s.help}</p>}
            <div className="clear-both">{renderFields(fs)}</div>
          </fieldset>
        );
      })}

      {loose.some((f) => isVisible(f, value.values)) && (
        <fieldset id="guided-sec-other" disabled={disabled} className="min-w-0 border-t border-border pt-6">
          <legend className="font-display float-left mb-4 w-full text-xl">Other details</legend>
          <div className="clear-both">{renderFields(loose)}</div>
        </fieldset>
      )}

      {spec.tables
        .filter((t) => isVisible(t, value.values))
        .map((t) => (
          <TableEditor
            key={t.id}
            table={t}
            rows={value.tables[t.id] ?? []}
            values={value.values}
            issues={issues}
            disabled={disabled}
            onRows={(rows, focus) => {
              pendingFocus.current = focus;
              setRows(t.id, rows);
            }}
          />
        ))}

      {hiddenWithValues.length > 0 && (
        <p
          className="hint rounded-xl border border-dashed border-border p-3"
          data-testid="text-guided-hidden"
        >
          {hiddenWithValues.length === 1
            ? "One earlier answer is kept but hidden, because a choice it depends on was changed. A hidden answer is not checked and is not put in the document. It is shown again if you change the choice back."
            : `${hiddenWithValues.length} earlier answers are kept but hidden, because a choice they depend on was changed. Hidden answers are not checked and are not put in the document. They are shown again if you change the choice back.`}
        </p>
      )}
    </div>
  );
}

function FieldInput({
  field: f,
  id,
  value,
  error,
  disabled,
  onChange,
  spoken,
}: {
  /** A question, with the example a v2 form may give it (forms v2: a hint, never saved or printed). */
  field: GuidedField & { example?: string | undefined };
  id: string;
  value: string;
  error?: string | undefined;
  disabled?: boolean | undefined;
  onChange: (v: string) => void;
  /** Added to the label for a screen reader only: which row of a table the answer belongs to. */
  spoken?: string;
}) {
  const helpId = id + "-help",
    exampleId = id + "-example",
    errId = id + "-error";
  // A required question nobody has answered yet is marked as still needed, not as a mistake. It is
  // shown as one only once the customer has been to it and left it empty. A wrong answer is shown
  // as soon as it is given.
  const [visited, setVisited] = useState(false);
  const unanswered = f.required && !value.trim();
  const shown = error && (visited || !unanswered) ? saidAs(error) : undefined;
  const money = f.type === "money_kobo";
  // The definitions' help for a money question explains kobo, which the customer no longer types.
  const help = money && /\bkobo\b/i.test(f.help ?? "") ? MONEY_HELP : f.help;
  const leave = (event: FocusEvent<HTMLElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setVisited(true);
  };
  const described =
    [help && helpId, f.example && exampleId, shown && errId, money && id + "-ngn"]
      .filter(Boolean)
      .join(" ") || undefined;
  const example = f.example && (
    <p id={exampleId} className="hint" data-testid={"example-" + id}>
      For example: {f.example}
    </p>
  );
  const common = {
    id,
    disabled,
    "aria-invalid": !!shown,
    "aria-describedby": described,
    "aria-required": f.required,
    "data-testid": "input-" + id,
  };
  const text = (
    <>
      {askedAs(f)}
      {spoken && <span className="sr-only"> {spoken}</span>}
    </>
  );
  const req = unanswered ? (
    <span
      className="ml-1 text-xs font-medium text-[hsl(var(--ochre-foreground))]"
      data-testid={"mark-needed-" + id}
    >
      Still needed
    </span>
  ) : (
    <span className="ml-1 text-xs font-normal text-muted-foreground">
      {f.required ? "Required" : "Optional"}
    </span>
  );
  const wide = f.type === "long_text" || f.type === "acknowledgement";

  let control: ReactNode;
  if (f.type === "acknowledgement") {
    return (
      <div className={cn("min-w-0", wide && "sm:col-span-2")} onBlur={leave}>
        <label
          htmlFor={id}
          className={cn(
            "flex items-start gap-3 rounded-xl border p-4 text-sm transition-colors",
            shown ? "border-destructive/50" : "border-border",
            value === "yes" && "bg-accent/60",
          )}
        >
          <input
            type="checkbox"
            {...common}
            className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]"
            checked={value === "yes"}
            onChange={(e) => onChange(e.target.checked ? "yes" : "")}
          />
          <span className="leading-relaxed">
            <span className="font-medium">{text}</span>
            {req}
          </span>
        </label>
        {help && (
          <p id={helpId} className="hint">
            {help}
          </p>
        )}
        {example}
        {shown && (
          <p id={errId} className="hint !text-destructive">
            {shown}
          </p>
        )}
      </div>
    );
  }
  if (f.type === "long_text")
    control = (
      <textarea
        {...common}
        className="field min-h-28"
        maxLength={5000}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  else if (f.type === "select")
    control = (
      <select {...common} className="field" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose an option</option>
        {value && !f.options?.some((o) => o.value === value) && (
          <option value={value}>Unrecognised saved value: {value}</option>
        )}
        {f.options?.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  else if (f.type === "date")
    control = (
      <div>
        <input
          {...common}
          type="date"
          className="field"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        {!disabled && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {DATE_QUICK_OFFSETS.map((opt) => (
              <button
                key={opt.days}
                type="button"
                className="rounded-full border border-border bg-card px-2.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                onClick={() => onChange(addCalendarDays(lagosToday(), opt.days))}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  else if (money) control = <MoneyInput common={common} id={id} value={value} onChange={onChange} />;
  else {
    const num = f.type === "integer" || f.type === "quantity";
    control = (
      <input
        {...common}
        type="text"
        inputMode={f.type === "integer" ? "numeric" : f.type === "quantity" ? "decimal" : undefined}
        className={cn("field", num && "font-mono tabular-nums")}
        maxLength={num ? 16 : 500}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  return (
    <div className={cn("min-w-0", wide && "sm:col-span-2")} onBlur={leave}>
      <label className="label" htmlFor={id}>
        {text}
        {req}
      </label>
      {control}
      {help && (
        <p id={helpId} className="hint">
          {help}
        </p>
      )}
      {example}
      {shown && (
        <p id={errId} className="hint !text-destructive">
          {shown}
        </p>
      )}
    </div>
  );
}

/**
 * The box for an amount. The customer types naira; the answer handed on is the same amount in whole
 * kobo, or what was typed when it is not an amount. The box keeps the customer's own typing, and
 * takes the stored answer again only when that answer changes from somewhere else, as on an undo.
 */
function MoneyInput({
  common,
  id,
  value,
  onChange,
}: {
  common: Record<string, unknown>;
  id: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [text, setText] = useState(() => shownAmount(value));
  useEffect(() => {
    setText((typed) => (storedAmount(typed) === value ? typed : shownAmount(value)));
  }, [value]);
  const stored = storedAmount(text);
  const reading = stored && stored === value ? koboToNgnDisplay(stored) : null;
  return (
    <>
      <div className="relative">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-3.5 grid place-items-center text-sm text-muted-foreground"
        >
          ₦
        </span>
        <input
          {...common}
          inputMode="decimal"
          autoComplete="off"
          maxLength={26}
          className="field pl-8 tabular-nums"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            onChange(storedAmount(e.target.value));
          }}
        />
      </div>
      <p
        id={id + "-ngn"}
        className="hint tabular-nums"
        aria-live="polite"
        data-testid={"text-" + id + "-ngn"}
      >
        {reading ? "Reads as " + reading : ""}
      </p>
    </>
  );
}

function TableEditor({
  table: t,
  rows,
  values,
  issues,
  disabled,
  onRows,
}: {
  table: GuidedTable;
  rows: Record<string, string>[];
  values: Record<string, string>;
  issues: Record<string, string>;
  disabled?: boolean | undefined;
  onRows: (rows: Record<string, string>[], focusSelector: string | null) => void;
}) {
  const base = "gt-" + t.id;
  const canAdd = !disabled && rows.length < t.maxRows;
  const add = () =>
    onRows(
      [...rows, Object.fromEntries(t.columns.map((c) => [c.id, ""]))],
      `#${base}-${rows.length}-${t.columns[0]?.id}`,
    );
  const remove = (i: number) => {
    const next = rows.filter((_, j) => j !== i);
    const target = next.length === 0 ? `#${base}-add` : `#${base}-remove-${Math.min(i, next.length - 1)}`;
    onRows(next, target);
  };
  const duplicate = (i: number) => {
    if (!canAdd) return;
    const copy = { ...rows[i] };
    const next = [...rows.slice(0, i + 1), copy, ...rows.slice(i + 1)];
    onRows(next, `#${base}-${i + 1}-${t.columns[0]?.id}`);
  };
  return (
    <fieldset
      id={"guided-tbl-" + t.id}
      disabled={disabled}
      className="min-w-0 border-t border-border pt-6"
      data-testid={"table-" + t.id}
    >
      <legend className="font-display float-left w-full text-xl">{t.label}</legend>
      <p className="hint clear-both !mt-1 mb-4">
        {t.help ? t.help + " " : ""}
        {t.minRows === t.maxRows
          ? `${t.minRows} rows.`
          : `${t.minRows ? t.minRows + " to " : "Up to "}${t.maxRows} rows.`}{" "}
        {rows.length} added.
      </p>
      {issues[t.id] && (
        <p className="hint mb-3 !text-destructive" role="status">
          {issues[t.id]}
        </p>
      )}
      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-sidebar/50 px-5 py-8 text-center text-sm text-muted-foreground">
          No rows yet. Add one when you have the details.
        </div>
      ) : (
        <ol className="grid gap-3">
          {rows.map((r, i) => {
            const rowSubtotal =
              r.quantity && r.unitPriceKobo ? lineSubtotalKobo(r.quantity, r.unitPriceKobo) : null;
            return (
              <li key={i} className="rounded-2xl border border-border bg-sidebar/50 p-4">
                <fieldset className="min-w-0">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-3">
                      <legend className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                        Row {i + 1}
                      </legend>
                      {rowSubtotal && (
                        <span
                          className="rounded-full bg-accent px-2.5 py-0.5 text-xs font-medium tabular-nums text-accent-foreground"
                          data-testid={`text-row-total-${t.id}-${i}`}
                        >
                          Line total: {formatNaira(rowSubtotal)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm !min-h-8 !px-3 text-xs"
                        disabled={!canAdd}
                        aria-label={`Duplicate ${t.label} row ${i + 1}`}
                        onClick={() => duplicate(i)}
                        data-testid={`button-duplicate-${t.id}-${i}`}
                      >
                        <Copy className="h-3.5 w-3.5" aria-hidden />
                        Duplicate
                      </button>
                      <button
                        type="button"
                        id={`${base}-remove-${i}`}
                        className="btn btn-ghost btn-sm !min-h-8 !px-3 text-xs"
                        disabled={disabled || rows.length <= t.minRows}
                        aria-label={`Remove ${t.label} row ${i + 1}`}
                        onClick={() => remove(i)}
                        data-testid={`button-remove-${t.id}-${i}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        Remove
                      </button>
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {t.columns
                      .filter((c) => isVisible(c, { ...values, ...r }))
                      .map((c) => (
                        <FieldInput
                          key={c.id}
                          field={c}
                          id={`${base}-${i}-${c.id}`}
                          spoken={`(row ${i + 1})`}
                          value={r[c.id] ?? ""}
                          error={issues[`${t.id}:${i}:${c.id}`]}
                          disabled={disabled}
                          onChange={(v) =>
                            onRows(
                              rows.map((x, j) => (j === i ? { ...x, [c.id]: v } : x)),
                              null,
                            )
                          }
                        />
                      ))}
                  </div>
                </fieldset>
              </li>
            );
          })}
        </ol>
      )}
      <button
        type="button"
        id={`${base}-add`}
        className="btn btn-ghost btn-sm mt-4"
        disabled={!canAdd}
        onClick={add}
        data-testid={`button-add-${t.id}`}
      >
        <Plus className="h-4 w-4" aria-hidden />
        Add a row
      </button>
      {rows.length >= t.maxRows && <p className="hint">This table takes no more than {t.maxRows} rows.</p>}
    </fieldset>
  );
}

export default GuidedFields;
