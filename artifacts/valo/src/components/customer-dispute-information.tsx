import { useRef, useState } from "react";
import { useGetOrderDisputeInformation, saveOrderDisputeInformation } from "@workspace/api-client-react";
import { describeError } from "@/lib/api";
import { InformationFacts, text, useDisputeDirty, wrapButton } from "./dispute-forms-boundary";

export function CustomerDisputeInformation({ orderId }: { orderId: string }) {
  const q = useGetOrderDisputeInformation(orderId),
    keys = useRef(new Map<string, string>());
  const [disputeId, setDispute] = useState(""),
    [name, setName] = useState(""),
    [phone, setPhone] = useState(""),
    [details, setDetails] = useState("");
  const [address, setAddress] = useState(""),
    [date, setDate] = useState(""),
    [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  useDisputeDirty(!!(disputeId || name || phone || details || address || date || consent));
  if (!q.data || (q.isError && [401, 403].includes(describeError(q.error).status ?? 0)))
    return (
      <div className="my-3 text-sm" role={q.isError ? "alert" : "status"}>
        <p>{q.isError ? describeError(q.error).message : "Loading your dispute information…"}</p>
        {q.isError && (
          <button style={wrapButton} className="btn btn-secondary mt-2" onClick={() => void q.refetch()}>
            Reload saved statements
          </button>
        )}
      </div>
    );
  return (
    <section className="my-4 rounded-xl border p-3">
      <h4 className="font-semibold">Information for an existing bank dispute</h4>
      <p className="my-2 text-sm">{q.data.notice}</p>
      {!q.data.disputes.length ? (
        <p className="my-2 text-sm">
          No existing bank dispute is recorded for this order. You can still save a payment concern for Valo
          below.
        </p>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (busy || !consent) return;
            setBusy(true);
            setError("");
            setSaved(false);
            const input = {
              disputeId,
              customerName: name.trim(),
              customerPhone: phone.trim(),
              serviceDetails: details.trim(),
              ...(address.trim() ? { deliveryAddress: address.trim() } : {}),
              ...(date ? { deliveryDate: date } : {}),
              consentVersion: "test-dispute-information-v1" as const,
            };
            const fingerprint = JSON.stringify(input);
            if (!keys.current.has(fingerprint)) keys.current.set(fingerprint, crypto.randomUUID());
            void saveOrderDisputeInformation(orderId, {
              ...input,
              requestKey: keys.current.get(fingerprint)!,
            })
              .then(async () => {
                setDispute("");
                setName("");
                setPhone("");
                setDetails("");
                setAddress("");
                setDate("");
                setConsent(false);
                setSaved(true);
                await q.refetch();
              })
              .catch((e) => setError(describeError(e).message))
              .finally(() => setBusy(false));
          }}
        >
          <label className="block text-sm">
            Selected existing bank dispute
            <select
              className="field my-1 w-full"
              value={disputeId}
              required
              disabled={busy}
              onChange={(e) => setDispute(e.target.value)}
            >
              <option value="">Choose the matching dispute</option>
              {q.data.disputes.map((d) => (
                <option key={String(d.id)} value={String(d.id)}>
                  {String(d.id)} — {String(d.status)}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            Your actual name
            <input
              className="field my-1 w-full"
              value={name}
              required
              maxLength={150}
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            Your actual phone number
            <input
              className="field my-1 w-full"
              value={phone}
              required
              minLength={5}
              maxLength={40}
              disabled={busy}
              onChange={(e) => setPhone(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            What was actually supplied or disputed
            <textarea
              className="field my-1 w-full"
              required
              minLength={10}
              maxLength={2000}
              value={details}
              disabled={busy}
              onChange={(e) => setDetails(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            Actual delivery address, only if relevant
            <input
              className="field my-1 w-full"
              value={address}
              maxLength={500}
              disabled={busy}
              onChange={(e) => setAddress(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            Actual delivery date, only if known
            <input
              type="date"
              className="field my-1 w-full"
              value={date}
              disabled={busy}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label className="my-3 flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={consent}
              disabled={busy}
              onChange={(e) => setConsent(e.target.checked)}
            />
            I consent to finance sharing these exact facts and my verified account email with Paystack for
            this selected dispute.
          </label>
          <button style={wrapButton} className="btn btn-secondary" disabled={busy || !consent}>
            {busy ? "Saving statement…" : "Save statement — not a bank decision"}
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="my-2 text-destructive">
          {error} Reload the saved statements before repeating an uncertain submission.
        </p>
      )}
      {saved && (
        <p role="status" className="my-2 text-sm">
          Statement saved for this existing dispute. It has not been sent to the provider.
        </p>
      )}
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer py-1">Saved statements</summary>
        {!q.data.information.length ? (
          <p className="my-2">No statements saved.</p>
        ) : (
          <div className="my-2 space-y-3">
            {q.data.information.map((r, i) => (
              <InformationFacts key={text(r.id) ?? i} row={r} />
            ))}
          </div>
        )}
      </details>
    </section>
  );
}
