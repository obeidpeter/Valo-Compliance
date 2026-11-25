import type { ReactNode } from "react";
import { Plus, X } from "lucide-react";
import { ANSWER_OPTIONS, MARKER_LABEL, isMarker, valueLabel, type Marker } from "@/lib/checker";
import { cn } from "@/lib/utils";

export type Opt = { value: string; label: string };
export const opts = (vals: string[]): Opt[] => vals.map((v) => ({ value: v, label: valueLabel(v) }));
/** A question's answers without the three ways of not answering, which every question lists last. */
export const known = (vals: string[]): Opt[] => opts(vals.filter((v) => !isMarker(v)));

/** What a question passes back: its answer, and whether the visitor chose it. Emptying an answer box
 * passes "unanswered" as not chosen, so the question goes back to untouched. A question's component
 * takes `Change<never>`: which answers are valid is fixed where the question is asked, by the answers
 * it is given to offer. */
export type Change<V> = (value: V, chosen?: boolean) => void;

export const yesNo: Opt[] = opts((ANSWER_OPTIONS as string[]).filter((value) => !isMarker(value)));

/** The ways of not answering a question, listed after its answers. "Skip for now" shows as chosen
 * only when the visitor chose it: an untouched question holds the same value. */
function Markers({
  name,
  group,
  value,
  skipped,
  markers,
  onChange,
}: {
  name: string;
  group: string;
  value: unknown;
  skipped: boolean;
  markers: readonly Marker[];
  onChange: (marker: Marker) => void;
}) {
  return (
    <>
      {markers.map((k) => {
        const on = value === k && (k !== "unanswered" || skipped);
        return (
          <label
            key={k}
            className={cn(
              "cursor-pointer rounded-full border px-3.5 py-2 text-sm transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring",
              on
                ? "border-primary bg-primary text-primary-foreground"
                : "border-dashed border-input text-muted-foreground hover:bg-secondary",
            )}
          >
            <input
              type="radio"
              className="sr-only"
              name={group}
              value={k}
              checked={on}
              onChange={() => onChange(k)}
              data-testid={"radio-" + name + "-" + k}
            />
            {MARKER_LABEL[k]}
          </label>
        );
      })}
    </>
  );
}

/** A question answered by choosing one of a few answers. Nothing is chosen until the visitor chooses. */
export function Choice({
  name,
  label,
  hint,
  value,
  skipped,
  options,
  markers,
  onChange,
  inputId,
}: {
  name: string;
  label: string;
  hint?: string;
  value: string;
  skipped: boolean;
  options: Opt[];
  markers: readonly Marker[];
  onChange: Change<never>;
  /** The first answer's id, which a link to the question moves the focus to. */
  inputId?: string;
}) {
  const choose = onChange as Change<string>;
  return (
    <fieldset>
      <legend className="label text-base">{label}</legend>
      {hint && <p className="hint !mt-0 mb-2">{hint}</p>}
      <div className="flex flex-wrap gap-2">
        {options.map((o, index) => {
          const on = value === o.value;
          return (
            <label
              key={o.value}
              className={cn(
                "cursor-pointer rounded-full border px-3.5 py-2 text-sm transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring",
                on ? "border-primary bg-primary text-primary-foreground" : "border-input hover:bg-secondary",
              )}
            >
              <input
                type="radio"
                className="sr-only"
                name={name}
                value={o.value}
                checked={on}
                onChange={() => choose(o.value)}
                data-testid={"radio-" + name + "-" + o.value}
                {...(index === 0 && inputId ? { id: inputId } : {})}
              />
              {o.label}
            </label>
          );
        })}
        <Markers
          name={name}
          group={name}
          value={value}
          skipped={skipped}
          markers={markers}
          onChange={choose}
        />
      </div>
    </fieldset>
  );
}

/** A question answered in a box or a list, with the ways of not answering it beside the box. Typing
 * an answer takes the place of a chosen "I do not know"; emptying the box leaves the question
 * untouched. */
export function AnswerOr({
  name,
  label,
  hint,
  value,
  skipped,
  markers,
  onChange,
  render,
}: {
  name: string;
  label: string;
  hint?: string;
  value: string;
  skipped: boolean;
  markers: readonly Marker[];
  onChange: Change<never>;
  render: (value: string, change: (value: string) => void, labelledBy: string) => ReactNode;
}) {
  const choose = onChange as Change<string>;
  const legend = name + "-question";
  return (
    <fieldset>
      <legend id={legend} className="label text-base">
        {label}
      </legend>
      {hint && <p className="hint !mt-0 mb-2">{hint}</p>}
      {render(
        isMarker(value) ? "" : value,
        (next) => (next === "" ? choose("unanswered", false) : choose(next)),
        legend,
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">or</span>
        <Markers
          name={name}
          group={name + "-mode"}
          value={value}
          skipped={skipped}
          markers={markers}
          onChange={choose}
        />
      </div>
    </fieldset>
  );
}

/** A question answered with a short list in the visitor's own words. */
export function ListOr({
  name,
  label,
  hint,
  value,
  skipped,
  onChange,
  placeholder,
  markers = ["unknown", "unanswered"],
  inputId,
}: {
  name: string;
  label: string;
  hint?: string;
  value: string[] | Marker;
  skipped: boolean;
  onChange: Change<never>;
  placeholder: string;
  markers?: readonly Marker[];
  /** The first entry's id, which a link to the question moves the focus to. */
  inputId?: string;
}) {
  const choose = onChange as Change<string[] | Marker>;
  const list = Array.isArray(value) && value.length ? value : [""];
  return (
    <fieldset>
      <legend className="label text-base">{label}</legend>
      {hint && <p className="hint !mt-0 mb-2">{hint}</p>}
      <div className="grid gap-2">
        {list.map((a, i) => (
          <div key={i} className="flex gap-2">
            <input
              aria-label={label + " " + (i + 1)}
              {...(i === 0 && inputId ? { id: inputId } : {})}
              className="field"
              maxLength={120}
              value={a}
              placeholder={placeholder}
              onChange={(e) => choose(list.map((x, j) => (j === i ? e.target.value : x)))}
              data-testid={"input-" + name + "-" + i}
            />
            {list.length > 1 && (
              <button
                type="button"
                aria-label={"Remove item " + (i + 1)}
                className="btn btn-ghost !px-3"
                onClick={() => choose(list.filter((_, j) => j !== i))}
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}
        {list.length < 10 && (
          <button type="button" className="btn btn-ghost btn-sm w-fit" onClick={() => choose([...list, ""])}>
            <Plus className="h-4 w-4" />
            Add another
          </button>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">or</span>
        <Markers
          name={name}
          group={name + "-mode"}
          value={value}
          skipped={skipped}
          markers={markers}
          onChange={choose}
        />
      </div>
    </fieldset>
  );
}

/** A question answered by ticking any of a few answers, with the ways of not answering it after them.
 * Ticking an answer takes the place of a chosen way of not answering; the ticked answers keep the
 * order they are offered in. */
export function ChecksOr({
  name,
  label,
  hint,
  value,
  skipped,
  options,
  markers,
  onChange,
  inputId,
}: {
  name: string;
  label: string;
  hint?: string;
  /** The ticked answers, or a way of not answering. */
  value: readonly string[] | string;
  skipped: boolean;
  options: Opt[];
  markers: readonly Marker[];
  onChange: Change<never>;
  /** The first answer's id, which a link to the question moves the focus to. */
  inputId?: string;
}) {
  const choose = onChange as Change<string[] | string>;
  const ticked = Array.isArray(value) ? value : [];
  const toggle = (option: string) =>
    choose(
      options
        .map((o) => o.value)
        .filter((each) => (each === option ? !ticked.includes(each) : ticked.includes(each))),
    );
  return (
    <fieldset>
      <legend className="label text-base">{label}</legend>
      {hint && <p className="hint !mt-0 mb-2">{hint}</p>}
      <div className="flex flex-wrap gap-2">
        {options.map((o, index) => {
          const on = ticked.includes(o.value);
          return (
            <label
              key={o.value}
              className={cn(
                "cursor-pointer rounded-full border px-3.5 py-2 text-sm transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring",
                on ? "border-primary bg-primary text-primary-foreground" : "border-input hover:bg-secondary",
              )}
            >
              <input
                type="checkbox"
                className="sr-only"
                name={name}
                value={o.value}
                checked={on}
                onChange={() => toggle(o.value)}
                data-testid={"check-" + name + "-" + o.value}
                {...(index === 0 && inputId ? { id: inputId } : {})}
              />
              {o.label}
            </label>
          );
        })}
        <Markers
          name={name}
          group={name + "-mode"}
          value={Array.isArray(value) ? "" : value}
          skipped={skipped}
          markers={markers}
          onChange={choose}
        />
      </div>
    </fieldset>
  );
}

/**
 * A question answered by ticking any of a fixed list of answers, with the visitor's own words beside
 * them, all held in one list: the ticked answers first, in the order they are offered, then the
 * visitor's own words as typed. An answer held before in the visitor's own words is shown as typed.
 * Ticking an answer, or typing one, takes the place of a chosen way of not answering.
 */
export function PickOrList({
  name,
  label,
  hint,
  value,
  skipped,
  options,
  markers,
  onChange,
  placeholder,
  inputId,
  max = 10,
}: {
  name: string;
  label: string;
  hint?: string;
  value: string[] | Marker;
  skipped: boolean;
  options: Opt[];
  markers: readonly Marker[];
  onChange: Change<never>;
  placeholder: string;
  /** The first answer's id, which a link to the question moves the focus to. */
  inputId?: string;
  /** How many entries the answer holds at most, ticked and typed together. */
  max?: number;
}) {
  const choose = onChange as Change<string[] | Marker>;
  const entries = Array.isArray(value) ? value : [];
  const offered = options.map((o) => o.value);
  const ticked = entries.filter((entry) => offered.includes(entry));
  const words = entries.filter((entry) => !offered.includes(entry));
  const shown = words.length ? words : [""];
  const given = entries.filter((entry) => entry.trim() !== "").length;
  const join = (nextTicked: readonly string[], nextWords: readonly string[]) =>
    choose([...offered.filter((option) => nextTicked.includes(option)), ...nextWords]);
  const wordsId = name + "-words";
  return (
    <fieldset>
      <legend className="label text-base">{label}</legend>
      {hint && <p className="hint !mt-0 mb-2">{hint}</p>}
      <div className="flex flex-wrap gap-2">
        {options.map((o, index) => {
          const on = ticked.includes(o.value);
          return (
            <label
              key={o.value}
              className={cn(
                "cursor-pointer rounded-full border px-3.5 py-2 text-sm transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60",
                on ? "border-primary bg-primary text-primary-foreground" : "border-input hover:bg-secondary",
              )}
            >
              <input
                type="checkbox"
                className="sr-only"
                name={name}
                value={o.value}
                checked={on}
                disabled={!on && given >= max}
                onChange={() =>
                  join(on ? ticked.filter((each) => each !== o.value) : [...ticked, o.value], words)
                }
                data-testid={"check-" + name + "-" + o.value}
                {...(index === 0 && inputId ? { id: inputId } : {})}
              />
              {o.label}
            </label>
          );
        })}
      </div>
      <p id={wordsId} className="mt-4 text-sm font-medium">
        In your own words
      </p>
      <div className="mt-2 grid gap-2" role="group" aria-labelledby={wordsId}>
        {shown.map((a, i) => (
          <div key={i} className="flex gap-2">
            <input
              aria-label={label + ", in your own words " + (i + 1)}
              className="field"
              maxLength={120}
              value={a}
              placeholder={placeholder}
              // A list already holding as many entries as it can takes no more in an empty box.
              disabled={a.trim() === "" && given >= max}
              onChange={(e) =>
                join(
                  ticked,
                  shown.map((x, j) => (j === i ? e.target.value : x)),
                )
              }
              data-testid={"input-" + name + "-" + i}
            />
            {shown.length > 1 && (
              <button
                type="button"
                aria-label={"Remove item " + (i + 1)}
                className="btn btn-ghost !px-3"
                onClick={() =>
                  join(
                    ticked,
                    shown.filter((_, j) => j !== i),
                  )
                }
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}
        {ticked.length + shown.length < max && (
          <button
            type="button"
            className="btn btn-ghost btn-sm w-fit"
            onClick={() => join(ticked, [...shown, ""])}
          >
            <Plus className="h-4 w-4" />
            Add another
          </button>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">or</span>
        <Markers
          name={name}
          group={name + "-mode"}
          value={value}
          skipped={skipped}
          markers={markers}
          onChange={choose}
        />
      </div>
    </fieldset>
  );
}
