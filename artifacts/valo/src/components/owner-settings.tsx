import { useId, useState } from "react";
import {
  previewOwnerSetting,
  recordOwnerSetting,
  useListOwnerSettings,
  type OwnerSettingKey,
  type OwnerSettingPreview,
  type OwnerSettingTerms,
} from "@workspace/api-client-react";
import { formatCount, formatDateTime, lagosClockTime } from "@/lib/format";
import { describeError } from "@/lib/describe-error";
import { ErrorState } from "./states";

const field = "mt-1 block w-full rounded-lg border border-border bg-background p-2";

type Words = { unit: string | null; yes: string | null; no: string | null };
/** A value as the screen says it: a count with its unit, or what yes or no means for the setting. */
const valueText = (value: number | boolean, words: Words) =>
  typeof value === "boolean"
    ? ((value ? words.yes : words.no) ?? (value ? "Yes" : "No"))
    : `${formatCount(value)} ${words.unit ?? ""}`.trim();

/**
 * The owner's commercial settings (docs/architecture/commercial-settings.md, slice 3; ADM-006): the
 * drafting assistant's two daily allowances, each with its default and the values the owner recorded.
 * As for prices, the screen shows the exact terms and their checksum before anything is recorded, and
 * records only those terms.
 */
export function OwnerSettings() {
  const result = useListOwnerSettings({ query: { retry: false } });
  const id = useId();
  const [key, setKey] = useState<OwnerSettingKey | "">("");
  const [value, setValue] = useState("");
  const [startsNow, setStartsNow] = useState(true);
  const [startsAt, setStartsAt] = useState("");
  const [reference, setReference] = useState("");
  const [preview, setPreview] = useState<OwnerSettingPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  // Recording confirms only the terms previewed, so any change to them asks for a new preview.
  const edit =
    <T,>(set: (next: T) => void) =>
    (next: T) => {
      set(next);
      setPreview(null);
      setNotice("");
    };
  const terms = (): OwnerSettingTerms => ({
    key: key as OwnerSettingKey,
    value: value.trim(),
    from: startsNow ? "now" : lagosClockTime(startsAt),
  });
  async function act(run: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await run();
    } catch (e) {
      setError(describeError(e).message);
    } finally {
      setBusy(false);
    }
  }
  const review = () =>
    act(async () => {
      setPreview(await previewOwnerSetting(terms()));
    });
  const record = (shown: OwnerSettingPreview) =>
    act(async () => {
      const saved = await recordOwnerSetting({
        ...terms(),
        reference: reference.trim(),
        confirm: shown.checksum,
      });
      setPreview(null);
      await result.refetch();
      setNotice(
        (typeof saved.value === "boolean"
          ? `Rule recorded from ${formatDateTime(saved.from)}: ${valueText(saved.value, shown)}.`
          : `Value recorded: ${valueText(saved.value, shown)} for ${shown.title.toLowerCase()}, from ${formatDateTime(saved.from)}.`) +
          (saved.closed.length ? " The setting's earlier value closes then." : ""),
      );
    });
  const chosen = result.data?.items.find((item) => item.key === key);
  const ready = Boolean(
    chosen && (chosen.kind === "yes-no" ? /^(yes|no)$/.test(value) : /^\d{1,7}$/.test(value.trim())),
  );
  return (
    <section className="surface mt-8 p-5 sm:p-7" aria-labelledby="owner-settings-heading">
      <h2 className="font-display text-2xl" id="owner-settings-heading">
        Commercial settings
      </h2>
      <p className="mt-2 text-sm">
        Only you decide these values. A value starts when you say, closes the setting's open value at that
        moment, and never changes afterwards. While you have recorded none, a setting reads its default. A
        higher drafting allowance lets more drafts be asked for in a day; spending on the AI provider stays
        within the budget you approved.
      </p>
      {result.isError ? (
        <ErrorState error={result.error} onRetry={() => result.refetch()} />
      ) : result.isPending ? (
        <p className="mt-4">Loading the settings…</p>
      ) : (
        <>
          <ul className="mt-4 space-y-3" aria-label="Each setting and its values">
            {result.data.items.map((item) => (
              <li key={item.key} className="rounded-lg border p-3 text-sm">
                <p className="font-semibold">{item.title}</p>
                {item.values.length ? (
                  <ul className="mt-1 list-disc pl-5">
                    {item.values.map((recorded) => (
                      <li key={recorded.settingId}>
                        {valueText(recorded.value, item)} from {formatDateTime(recorded.effectiveFrom)}
                        {recorded.effectiveTo ? ` to ${formatDateTime(recorded.effectiveTo)}` : ""}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1">
                    {valueText(item.defaultValue, item)}, the default: you have recorded no value.
                  </p>
                )}
              </li>
            ))}
          </ul>
          <h3 className="mt-6 font-display text-xl">Record a value</h3>
          <div className="mt-3 space-y-3">
            <div>
              <label className="block text-sm font-medium" htmlFor={id + "-key"}>
                Setting
              </label>
              <select
                id={id + "-key"}
                className={field}
                value={key}
                onChange={(e) => {
                  // A whole number and a yes or no are different answers: a new setting starts with none.
                  setValue("");
                  edit(setKey)(e.target.value as OwnerSettingKey | "");
                }}
                disabled={busy}
              >
                <option value="">Choose a setting</option>
                {result.data.items.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.title}
                  </option>
                ))}
              </select>
            </div>
            {chosen?.kind === "yes-no" ? (
              <fieldset className="text-sm">
                <legend className="font-medium">The rule</legend>
                {(["yes", "no"] as const).map((answer) => (
                  <label key={answer} className="mt-1 flex items-start gap-2">
                    <input
                      type="radio"
                      name="owner-setting-answer"
                      className="mt-1"
                      checked={value === answer}
                      onChange={() => edit(setValue)(answer)}
                      disabled={busy}
                    />
                    {answer === "yes" ? chosen.yes : chosen.no}
                  </label>
                ))}
              </fieldset>
            ) : (
              <div>
                <label className="block text-sm font-medium" htmlFor={id + "-value"}>
                  Drafts a day, a whole number
                </label>
                <input
                  id={id + "-value"}
                  className={field}
                  inputMode="numeric"
                  value={value}
                  onChange={(e) => edit(setValue)(e.target.value)}
                  disabled={busy}
                />
              </div>
            )}
            <fieldset className="text-sm">
              <legend className="font-medium">When it starts</legend>
              <label className="mt-1 flex items-center gap-2">
                <input
                  type="radio"
                  name="owner-setting-start"
                  checked={startsNow}
                  onChange={() => edit(setStartsNow)(true)}
                  disabled={busy}
                />
                Now
              </label>
              <label className="mt-1 flex items-center gap-2">
                <input
                  type="radio"
                  name="owner-setting-start"
                  checked={!startsNow}
                  onChange={() => edit(setStartsNow)(false)}
                  disabled={busy}
                />
                At a time on the Lagos clock
              </label>
              {!startsNow && (
                <div className="mt-2">
                  <label className="block font-medium" htmlFor={id + "-start"}>
                    Start time, Lagos
                  </label>
                  <input
                    id={id + "-start"}
                    className={field}
                    type="datetime-local"
                    value={startsAt}
                    onChange={(e) => edit(setStartsAt)(e.target.value)}
                    disabled={busy}
                  />
                </div>
              )}
            </fieldset>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy || !ready || (!startsNow && !lagosClockTime(startsAt))}
              onClick={() => void review()}
            >
              Preview the exact value
            </button>
          </div>
          {preview && (
            <div className="mt-5 space-y-3 rounded-lg border p-4" data-testid="owner-setting-preview">
              <h4 className="font-semibold">The value you are recording</h4>
              <dl className="grid gap-2 text-sm">
                <div>
                  <dt className="font-semibold">Setting</dt>
                  <dd>{preview.title}</dd>
                </div>
                <div>
                  <dt className="font-semibold">Value</dt>
                  <dd>{valueText(preview.terms.value, preview)}</dd>
                </div>
                <div>
                  <dt className="font-semibold">Starts</dt>
                  <dd>
                    {preview.terms.from === "now" ? "When you record it" : formatDateTime(preview.terms.from)}
                  </dd>
                </div>
                <div>
                  <dt className="font-semibold">Checksum of these terms</dt>
                  <dd className="break-all font-mono">{preview.checksum}</dd>
                </div>
              </dl>
              <div>
                <label className="block text-sm font-medium" htmlFor={id + "-reference"}>
                  Where your approval is written, such as a decision's reference
                </label>
                <input
                  id={id + "-reference"}
                  className={field}
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  disabled={busy}
                />
              </div>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || reference.trim().length < 3}
                onClick={() => void record(preview)}
              >
                Record this value
              </button>
            </div>
          )}
        </>
      )}
      {notice && (
        <p role="status" className="mt-4">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-4">
          {error}
        </p>
      )}
    </section>
  );
}
