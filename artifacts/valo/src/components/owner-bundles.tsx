import { useId, useState } from "react";
import {
  previewOwnerBundle,
  recordOwnerBundle,
  useListOwnerBundles,
  type OwnerBundlePreview,
  type OwnerBundleTerms,
} from "@workspace/api-client-react";
import { formatDateTime, formatNaira, lagosClockTime } from "@/lib/format";
import { describeError } from "@/lib/describe-error";
import { ErrorState } from "./states";

const field = "mt-1 block w-full rounded-lg border border-border bg-background p-2";

/**
 * The owner's bundles (docs/architecture/commercial-settings.md, slice 4b; ADM-006). Only the development
 * owner decides a bundle: the premium templates it holds, its price, licence and tax treatment. The screen
 * shows the exact terms and their checksum before anything is recorded, and records only those terms.
 */
export function OwnerBundles() {
  const result = useListOwnerBundles({ query: { retry: false } });
  const id = useId();
  const [bundle, setBundle] = useState("");
  const [title, setTitle] = useState("");
  const [items, setItems] = useState<string[]>([]);
  const [amount, setAmount] = useState("");
  const [licenceVersion, setLicenceVersion] = useState("");
  const [licenceText, setLicenceText] = useState("");
  const [taxTreatment, setTaxTreatment] = useState("");
  const [startsNow, setStartsNow] = useState(true);
  const [startsAt, setStartsAt] = useState("");
  const [reference, setReference] = useState("");
  const [preview, setPreview] = useState<OwnerBundlePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  // Recording confirms only the terms previewed, so any change to them asks for a new preview.
  const edit =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      setPreview(null);
      setNotice("");
    };
  const choose = (item: string, chosen: boolean) =>
    edit(setItems)(chosen ? [...items, item] : items.filter((other) => other !== item));
  const terms = (): OwnerBundleTerms => ({
    bundle: bundle.trim(),
    title: title.trim(),
    items,
    amount: amount.trim(),
    licenceVersion: licenceVersion.trim(),
    licenceText: licenceText.trim(),
    taxTreatment: taxTreatment.trim(),
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
      setPreview(await previewOwnerBundle(terms()));
    });
  const record = (shown: OwnerBundlePreview) =>
    act(async () => {
      const saved = await recordOwnerBundle({
        ...terms(),
        reference: reference.trim(),
        confirm: shown.checksum,
      });
      setPreview(null);
      await result.refetch();
      setNotice(
        `Bundle recorded: ${saved.title} at ${formatNaira(saved.amountKobo)}, from ${formatDateTime(saved.from)}.` +
          (saved.closed.length ? " Its earlier version closes then." : ""),
      );
    });
  const ready = Boolean(
    bundle.trim() &&
    title.trim() &&
    items.length >= 2 &&
    items.length <= 10 &&
    amount.trim() &&
    licenceVersion.trim() &&
    licenceText.trim() &&
    taxTreatment.trim(),
  );
  const titleOf = (item: string) =>
    result.data?.templates.find((template) => template.item === item)?.title ?? "A template";
  return (
    <section className="surface mt-8 p-5 sm:p-7" aria-labelledby="owner-bundles-heading">
      <h2 className="font-display text-2xl" id="owner-bundles-heading">
        Bundles of premium templates
      </h2>
      <p className="mt-2 text-sm">
        Only you decide a bundle: the premium templates it holds, its price, its licence and its tax
        treatment. A version starts when you say, closes the bundle's open version at that moment, and never
        changes afterwards. Checkout does not offer bundles yet, and recording one takes no payment.
      </p>
      {result.isError ? (
        <ErrorState error={result.error} onRetry={() => result.refetch()} />
      ) : result.isPending ? (
        <p className="mt-4">Loading the bundles…</p>
      ) : (
        <>
          {result.data.versions.length ? (
            <ul className="mt-4 space-y-3" aria-label="Bundles">
              {result.data.versions.map((version) => (
                <li key={version.bundleId} className="rounded-lg border p-3 text-sm">
                  <p className="font-semibold">
                    {version.title} · {version.bundle}
                  </p>
                  <p className="mt-1">
                    {formatNaira(version.amountKobo)} from {formatDateTime(version.effectiveFrom)}
                    {version.effectiveTo ? ` to ${formatDateTime(version.effectiveTo)}` : ""} · licence{" "}
                    {version.licenceVersion} · {version.taxTreatment}
                  </p>
                  <p className="mt-1">Holds: {version.items.map(titleOf).join("; ")}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4">No bundle has been recorded yet.</p>
          )}
          {result.data.templates.length < 2 ? (
            <p className="mt-4">
              A bundle holds two to ten premium templates, and fewer than two have been released. A Content
              editor releases them first.
            </p>
          ) : (
            <>
              <h3 className="mt-6 font-display text-xl">Record a bundle's version</h3>
              <div className="mt-3 space-y-3">
                <div>
                  <label className="block text-sm font-medium" htmlFor={id + "-bundle"}>
                    Bundle name, such as starter-pack. An existing name records its next version.
                  </label>
                  <input
                    id={id + "-bundle"}
                    className={field}
                    value={bundle}
                    onChange={(e) => edit(setBundle)(e.target.value)}
                    disabled={busy}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium" htmlFor={id + "-title"}>
                    Title, on one line
                  </label>
                  <input
                    id={id + "-title"}
                    className={field}
                    value={title}
                    onChange={(e) => edit(setTitle)(e.target.value)}
                    disabled={busy}
                  />
                </div>
                <fieldset className="text-sm">
                  <legend className="font-medium">Premium templates it holds, two to ten</legend>
                  {result.data.templates.map((template) => (
                    <label key={template.item} className="mt-1 flex items-start gap-2">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={items.includes(template.item)}
                        onChange={(e) => choose(template.item, e.target.checked)}
                        disabled={busy}
                      />
                      <span>
                        {template.title}
                        {template.onSale ? "" : " · not on sale now"}
                      </span>
                    </label>
                  ))}
                </fieldset>
                <div>
                  <label className="block text-sm font-medium" htmlFor={id + "-amount"}>
                    Amount in naira, such as 1500 or 1500.00
                  </label>
                  <input
                    id={id + "-amount"}
                    className={field}
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => edit(setAmount)(e.target.value)}
                    disabled={busy}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium" htmlFor={id + "-licence-version"}>
                    Licence version, such as bundle-1
                  </label>
                  <input
                    id={id + "-licence-version"}
                    className={field}
                    value={licenceVersion}
                    onChange={(e) => edit(setLicenceVersion)(e.target.value)}
                    disabled={busy}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium" htmlFor={id + "-licence-text"}>
                    Licence text
                  </label>
                  <textarea
                    id={id + "-licence-text"}
                    className={field}
                    rows={6}
                    value={licenceText}
                    onChange={(e) => edit(setLicenceText)(e.target.value)}
                    disabled={busy}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium" htmlFor={id + "-tax"}>
                    Tax treatment, on one line
                  </label>
                  <input
                    id={id + "-tax"}
                    className={field}
                    value={taxTreatment}
                    onChange={(e) => edit(setTaxTreatment)(e.target.value)}
                    disabled={busy}
                  />
                </div>
                <fieldset className="text-sm">
                  <legend className="font-medium">When it starts</legend>
                  <label className="mt-1 flex items-center gap-2">
                    <input
                      type="radio"
                      name="owner-bundle-start"
                      checked={startsNow}
                      onChange={() => edit(setStartsNow)(true)}
                      disabled={busy}
                    />
                    Now
                  </label>
                  <label className="mt-1 flex items-center gap-2">
                    <input
                      type="radio"
                      name="owner-bundle-start"
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
                  Preview the exact terms
                </button>
              </div>
              {preview && (
                <div className="mt-5 space-y-3 rounded-lg border p-4" data-testid="owner-bundle-preview">
                  <h4 className="font-semibold">The terms you are recording for {preview.terms.title}</h4>
                  <dl className="grid gap-2 text-sm">
                    <div>
                      <dt className="font-semibold">Bundle name</dt>
                      <dd>{preview.terms.bundle}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold">Templates</dt>
                      <dd>
                        <ul className="list-disc pl-5" aria-label="Templates in this bundle">
                          {preview.templates.map((template) => (
                            <li key={template.item}>
                              {template.title}
                              {template.onSale ? "" : " · not on sale now"}
                            </li>
                          ))}
                        </ul>
                      </dd>
                    </div>
                    <div>
                      <dt className="font-semibold">Amount</dt>
                      <dd>{formatNaira(preview.terms.amountKobo)}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold">Licence</dt>
                      <dd>{preview.terms.licenceVersion}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold">Tax treatment</dt>
                      <dd>{preview.terms.taxTreatment}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold">Starts</dt>
                      <dd>
                        {preview.terms.from === "now"
                          ? "When you record it"
                          : formatDateTime(preview.terms.from)}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-semibold">Checksum of these terms</dt>
                      <dd className="break-all font-mono">{preview.checksum}</dd>
                    </div>
                  </dl>
                  <details>
                    <summary className="cursor-pointer text-sm">The licence text</summary>
                    <p className="mt-1 whitespace-pre-wrap border-l-2 border-border pl-3 text-sm">
                      {preview.terms.licenceText}
                    </p>
                  </details>
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
                    Record this bundle
                  </button>
                </div>
              )}
            </>
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
