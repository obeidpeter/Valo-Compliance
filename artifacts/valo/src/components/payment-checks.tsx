import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getFinancePaymentChecks,
  settleFinancePaymentCheck,
  type PaymentCheck,
} from "@workspace/api-client-react";
import { describeError } from "@/lib/api";
import { formatDateTime, formatDay, formatNaira } from "@/lib/format";
import { ORDER_STATUS_LABELS } from "@/lib/order-status-words";
import { findingWords, OUTCOME_WORDS, type PaymentCheckOutcome } from "@/lib/payment-check-words";

/** One difference a daily check found, with the form that settles it (docs/architecture/reconciliation.md,
 * slice 2). Settling records what finance found and why; it changes nothing about the order. */
function PaymentDifference({ row, refresh }: { row: PaymentCheck; refresh: () => Promise<unknown> }) {
  const [outcome, setOutcome] = useState<PaymentCheckOutcome | null>(null),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const paid = row.orderStatus === "verified_success";
  async function settle() {
    if (!outcome) return;
    setBusy(true);
    setError(null);
    try {
      await settleFinancePaymentCheck(row.id, { outcome, reason });
      await refresh();
    } catch (e) {
      setError(describeError(e).message);
    } finally {
      setBusy(false);
    }
  }
  const heading = `payment-check-${row.id}`;
  return (
    <article className="rounded-xl border bg-card p-4" aria-labelledby={heading}>
      <h4 id={heading} className="break-all font-semibold">
        {row.reference}
      </h4>
      <p className="my-2 text-sm">
        {formatNaira(row.amountKobo)} · {ORDER_STATUS_LABELS[row.orderStatus] ?? row.orderStatus} · Checked
        for {formatDay(row.day)}
      </p>
      <ul className="my-2 list-disc pl-5 text-sm" aria-label="What differs">
        {findingWords(row.finding).map((words) => (
          <li key={words}>{words}</li>
        ))}
      </ul>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void settle();
        }}
      >
        <fieldset className="my-3">
          <legend className="text-sm font-medium">What did you find?</legend>
          {(["explained", "no_payment_stands"] as const).map((value) => (
            <label key={value} className="mt-2 flex items-start gap-2 text-sm">
              <input
                type="radio"
                name={`outcome-${row.id}`}
                value={value}
                checked={outcome === value}
                disabled={busy || (value === "no_payment_stands" && paid)}
                onChange={() => setOutcome(value)}
              />
              <span>
                <strong>{OUTCOME_WORDS[value].label}.</strong> {OUTCOME_WORDS[value].text}
              </span>
            </label>
          ))}
          {paid && (
            <p className="mt-2 text-xs text-muted-foreground">
              Valo holds this order as paid, so it cannot be settled as having no payment.
            </p>
          )}
        </fieldset>
        <label className="block text-sm" htmlFor={`payment-check-reason-${row.id}`}>
          Why: what you looked at, and what it showed. It is kept in the staff audit.
        </label>
        <textarea
          id={`payment-check-reason-${row.id}`}
          className="field my-2 w-full"
          required
          minLength={10}
          maxLength={1500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <button
          type="submit"
          className="btn btn-secondary"
          disabled={busy || !outcome || reason.trim().length < 10}
        >
          Record what you found
        </button>
      </form>
      {busy && (
        <p className="mt-2 text-sm" role="status">
          Recording…
        </p>
      )}
      {error && (
        <p className="mt-2 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </article>
  );
}

/** Finance's view of the daily payment checks: the differences nobody has settled, and the latest settled. */
export function FinancePaymentChecks() {
  const qc = useQueryClient(),
    key = ["/api/admin/payment-checks"] as const;
  const q = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => getFinancePaymentChecks({ signal }),
    refetchOnWindowFocus: true,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: key });
  return (
    <section className="my-6 border-t pt-5" aria-labelledby="finance-payment-checks">
      <h3 id="finance-payment-checks" className="font-display text-xl">
        Daily payment checks
      </h3>
      <p className="my-3 text-sm">
        Each difference below is one order whose latest daily check found something that Valo&apos;s records
        and Paystack&apos;s answer do not agree on. Recording what you found settles it. It changes nothing
        about the order, its payment or its access, and your reason is kept in the staff audit.
      </p>
      {q.isLoading ? (
        <p role="status">Loading the daily payment checks…</p>
      ) : q.isError ? (
        <div role="alert">
          <p>{describeError(q.error).message}</p>
          <button className="btn btn-secondary mt-2" onClick={() => void q.refetch()}>
            Reload the daily payment checks
          </button>
        </div>
      ) : (
        <>
          {!q.data?.differences.length ? (
            <p className="my-3 text-sm">No difference is waiting to be settled.</p>
          ) : (
            <div className="space-y-3">
              {q.data.differences.map((row) => (
                <PaymentDifference key={row.id} row={row} refresh={refresh} />
              ))}
            </div>
          )}
          <h4 className="mb-2 mt-5 font-semibold">Latest settled</h4>
          {!q.data?.settled.length ? (
            <p className="text-sm">Nothing has been settled yet.</p>
          ) : (
            <ul className="space-y-2 text-sm" aria-label="Latest settled">
              {q.data.settled.map((row) => (
                <li key={row.id} className="rounded-lg border p-3">
                  <span className="break-all font-medium">{row.reference}</span>:{" "}
                  {row.outcome ? OUTCOME_WORDS[row.outcome].label : "Settled"},{" "}
                  {row.resolvedAt ? formatDateTime(row.resolvedAt) : "at a time not recorded"},{" "}
                  {row.resolvedByYou ? "by you" : "by another member of finance"}.
                  {row.reason && <span className="block text-muted-foreground">{row.reason}</span>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
