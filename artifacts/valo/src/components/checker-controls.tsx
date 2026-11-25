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
}: {
  name: string;
  label: string;
  hint?: string;
  value: string;
  skipped: boolean;
  options: Opt[];
  markers: readonly Marker[];
  onChange: Change<never>;
}) {
  const choose = onChange as Change<string>;
  return (
    <fieldset>
      <legend className="label text-base">{label}</legend>
      {hint && <p className="hint !mt-0 mb-2">{hint}</p>}
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
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
  value,
  skipped,
  markers,
  onChange,
  render,
}: {
  name: string;
  label: string;
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
}: {
  name: string;
  label: string;
  hint: string;
  value: string[] | Marker;
  skipped: boolean;
  onChange: Change<never>;
  placeholder: string;
  markers?: readonly Marker[];
}) {
  const choose = onChange as Change<string[] | Marker>;
  const list = Array.isArray(value) && value.length ? value : [""];
  return (
    <fieldset>
      <legend className="label text-base">{label}</legend>
      <p className="hint !mt-0 mb-2">{hint}</p>
      <div className="grid gap-2">
        {list.map((a, i) => (
          <div key={i} className="flex gap-2">
            <input
              aria-label={label + " " + (i + 1)}
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
