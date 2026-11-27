import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getFinancePaymentEvents,
  settleFinancePaymentEvent,
  type PaymentEvent,
} from "@workspace/api-client-react";
import { describeError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { eventFindingWords, eventTypeWords } from "@/lib/payment-check-words";

/** One Paystack event Valo could not match or process, with the form that settles it
 * (docs/architecture/reconciliation.md, slice 3a). Settling records what finance found and why; it changes
 * nothing about the event, an order, a payment or access. */
function WaitingEvent({ row, refresh }: { row: PaymentEvent; refresh: () => Promise<unknown> }) {
  const [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  async function settle() {
    setBusy(true);
    setError(null);
    try {
      await settleFinancePaymentEvent(row.id, { reason });
      await refresh();
    } catch (e) {
      setError(describeError(e).message);
    } finally {
      setBusy(false);
    }
  }
  const heading = `payment-event-${row.id}`;
  return (
    <article className="rounded-xl border bg-card p-4" aria-labelledby={heading}>
      <h4 id={heading} className="break-all font-semibold">
        {row.reference ?? "No reference"}
      </h4>
      <p className="my-2 text-sm">
        {eventTypeWords(row.eventType)} · Received {formatDateTime(row.receivedAt)}
      </p>
      <p className="my-2 text-sm">{eventFindingWords(row.finding)}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void settle();
        }}
      >
        <label className="block text-sm" htmlFor={`payment-event-reason-${row.id}`}>
          What did you find? What you looked at, and what it showed. It is kept in the staff audit.
        </label>
        <textarea
          id={`payment-event-reason-${row.id}`}
          className="field my-2 w-full"
          required
          minLength={10}
          maxLength={1500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <button type="submit" className="btn btn-secondary" disabled={busy || reason.trim().length < 10}>
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

/** Finance's view of the Paystack events Valo could not match or process: those waiting, and the latest
 * settled. */
export function FinancePaymentEvents() {
  const qc = useQueryClient(),
    key = ["/api/admin/payment-events"] as const;
  const q = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => getFinancePaymentEvents({ signal }),
    refetchOnWindowFocus: true,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: key });
  return (
    <section className="my-6 border-t pt-5" aria-labelledby="finance-payment-events">
      <h3 id="finance-payment-events" className="font-display text-xl">
        Paystack events waiting for finance
      </h3>
      <p className="my-3 text-sm">
        Each event below came from Paystack, and Valo could not match it to an order or a refund, or could not
        process it. Recording what you found settles it. It changes nothing about the event, an order, a
        payment or access, and your reason is kept in the staff audit.
      </p>
      {q.isLoading ? (
        <p role="status">Loading the Paystack events…</p>
      ) : q.isError ? (
        <div role="alert">
          <p>{describeError(q.error).message}</p>
          <button className="btn btn-secondary mt-2" onClick={() => void q.refetch()}>
            Reload the Paystack events
          </button>
        </div>
      ) : (
        <>
          {!q.data?.waiting.length ? (
            <p className="my-3 text-sm">No event is waiting for finance.</p>
          ) : (
            <div className="space-y-3">
              {q.data.waiting.map((row) => (
                <WaitingEvent key={`${row.id}:${row.finding}`} row={row} refresh={refresh} />
              ))}
            </div>
          )}
          <h4 className="mb-2 mt-5 font-semibold">Latest settled events</h4>
          {!q.data?.settled.length ? (
            <p className="text-sm">No event has been settled yet.</p>
          ) : (
            <ul className="space-y-2 text-sm" aria-label="Latest settled events">
              {q.data.settled.map((row) => (
                <li key={`${row.id}:${row.finding}`} className="rounded-lg border p-3">
                  <span className="break-all font-medium">{row.reference ?? "No reference"}</span>:{" "}
                  {eventTypeWords(row.eventType)}, settled{" "}
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
