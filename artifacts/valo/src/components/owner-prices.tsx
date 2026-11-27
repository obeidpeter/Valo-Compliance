import { useId, useState } from "react";
import {
  previewOwnerPrice,
  recordOwnerPrice,
  useListOwnerPrices,
  type OwnerPricePreview,
  type OwnerPriceTerms,
} from "@workspace/api-client-react";
import { formatDateTime, formatNaira, lagosClockTime } from "@/lib/format";
import { describeError } from "@/lib/describe-error";
import { ErrorState } from "./states";

const field = "mt-1 block w-full rounded-lg border border-border bg-background p-2";

/**
 * The owner's price screen (docs/architecture/commercial-settings.md, slice 1; ADM-006). Only the
 * development owner decides a premium template's price, licence and tax treatment: the screen shows
 * the exact terms and their checksum before anything is recorded, and records only those terms.
 */
export function OwnerPrices() {
  const result = useListOwnerPrices({ query: { retry: false } });
  const id = useId();
  const [edition, setEdition] = useState("");
  const [amount, setAmount] = useState("");
  const [licenceVersion, setLicenceVersion] = useState("");
  const [licenceText, setLicenceText] = useState("");
  const [taxTreatment, setTaxTreatment] = useState("");
  const [startsNow, setStartsNow] = useState(true);
  const [startsAt, setStartsAt] = useState("");
  const [carries, setCarries] = useState(false);
  const [reference, setReference] = useState("");
  const [preview, setPreview] = useState<OwnerPricePreview | null>(null);
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
  const terms = (): OwnerPriceTerms => ({
    edition,
    amount: amount.trim(),
    licenceVersion: licenceVersion.trim(),
    licenceText: licenceText.trim(),
    taxTreatment: taxTreatment.trim(),
    from: startsNow ? "now" : lagosClockTime(startsAt),
    carries,
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
      setPreview(await previewOwnerPrice(terms()));
    });
  const record = (shown: OwnerPricePreview) =>
    act(async () => {
      const saved = await recordOwnerPrice({
        ...terms(),
        reference: reference.trim(),
        confirm: shown.checksum,
      });
      setPreview(null);
      await result.refetch();
      setNotice(
        `Price recorded: ${formatNaira(saved.amountKobo)} for ${saved.title}, from ${formatDateTime(saved.from)}.` +
          (saved.closed.length ? " The template's earlier price closes then." : ""),
      );
    });
  const ready = Boolean(
    edition && amount.trim() && licenceVersion.trim() && licenceText.trim() && taxTreatment.trim(),
  );
  return (
    <section className="surface mt-8 p-5 sm:p-7" aria-labelledby="owner-prices-heading">
      <h2 className="font-display text-2xl" id="owner-prices-heading">
        Premium template prices
      </h2>
      <p className="mt-2 text-sm">
        Only you decide a price, its licence and its tax treatment. A price starts when you say, closes the
        template's open price at that moment, and never changes afterwards. Orders already made keep the price
        and terms they were made at. Checkout runs only in test mode here, and recording a price takes no
        payment.
      </p>
      {result.isError ? (
        <ErrorState error={result.error} onRetry={() => result.refetch()} />
      ) : result.isPending ? (
        <p className="mt-4">Loading the premium templates…</p>
      ) : !result.data.items.length ? (
        <p className="mt-4">No premium template is published yet. A Content editor publishes one first.</p>
      ) : (
        <>
          <ul className="mt-4 space-y-3" aria-label="Published premium templates">
            {result.data.items.map((item) => (
              <li key={item.edition} className="rounded-lg border p-3 text-sm">
                <p className="font-semibold">
                  {item.title} · version {item.version}
                </p>
                {item.prices.length ? (
                  <ul className="mt-1 list-disc pl-5">
                    {item.prices.map((price) => (
                      <li key={price.priceId}>
                        {formatNaira(price.amountKobo)} from {formatDateTime(price.effectiveFrom)}
                        {price.effectiveTo ? ` to ${formatDateTime(price.effectiveTo)}` : ""} · licence{" "}
                        {price.licenceVersion} · {price.taxTreatment}
                        {price.carriedFrom ? " · carried from an earlier edition" : ""}
                        {price.carriesToLaterEditions ? " · carries to later editions" : ""}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1">No price yet, so it cannot be bought.</p>
                )}
              </li>
            ))}
          </ul>
          <h3 className="mt-6 font-display text-xl">Record a price</h3>
          <div className="mt-3 space-y-3">
            <div>
              <label className="block text-sm font-medium" htmlFor={id + "-edition"}>
                Template
              </label>
              <select
                id={id + "-edition"}
                className={field}
                value={edition}
                onChange={(e) => edit(setEdition)(e.target.value)}
                disabled={busy}
              >
                <option value="">Choose a template</option>
                {result.data.items.map((item) => (
                  <option key={item.edition} value={item.edition}>
                    {item.title} · version {item.version}
                  </option>
                ))}
              </select>
            </div>
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
                Licence version, such as premium-1
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
                  name="owner-price-start"
                  checked={startsNow}
                  onChange={() => edit(setStartsNow)(true)}
                  disabled={busy}
                />
                Now
              </label>
              <label className="mt-1 flex items-center gap-2">
                <input
                  type="radio"
                  name="owner-price-start"
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
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={carries}
                onChange={(e) => edit(setCarries)(e.target.checked)}
                disabled={busy}
              />
              <span>
                Carry this price to the template's later editions. Each time a Content editor releases its
                next edition, the same price, licence and tax treatment are recorded for it.
              </span>
            </label>
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
            <div className="mt-5 space-y-3 rounded-lg border p-4" data-testid="owner-price-preview">
              <h4 className="font-semibold">The terms you are recording for {preview.title}</h4>
              <dl className="grid gap-2 text-sm">
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
                    {preview.terms.from === "now" ? "When you record it" : formatDateTime(preview.terms.from)}
                  </dd>
                </div>
                <div>
                  <dt className="font-semibold">Later editions</dt>
                  <dd>
                    {preview.terms.carries ? "Carries to each one as it is released" : "Does not carry"}
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
                Record this price
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
