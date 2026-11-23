import { useRef, useState } from "react";
import { Download } from "lucide-react";
import {
  startCommerceCheckout,
  refreshCommerceOrder,
  getCommerceReceipt,
  requestCommerceRefund,
  type CommerceOrder,
  type OwnedCheckoutDownload,
} from "@workspace/api-client-react";
import { PaymentConcerns } from "@/components/payment-concerns";
import { CustomerDisputeInformation, useDisputeDirty } from "@/components/dispute-workflows";
import { describeError } from "@/lib/api";
import { formatDateTime, formatNaira } from "@/lib/format";
import { basePath } from "@/lib/env";

const labels: Record<string, string> = {
  created: "Order saved — not paid",
  pending: "Awaiting verified payment",
  abandoned: "Payment not completed",
  failed: "Payment failed",
  verified_success: "Test purchase verified",
  needs_review: "Staff reconciliation required",
  reversed: "Payment reversed — access suspended",
};

export function OrderCard({
  order,
  download,
  changed,
}: {
  order: CommerceOrder;
  download: OwnedCheckoutDownload | undefined;
  changed: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState(""),
    [notice, setNotice] = useState<string | null>(null);
  const [amount, setAmount] = useState(""),
    [policyAccepted, setPolicyAccepted] = useState(false);
  const refundKey = useRef<{ fingerprint: string; key: string } | null>(null);
  useDisputeDirty(Boolean(amount.trim() || reason.trim() || busy));
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      await changed();
    } catch (e) {
      setError(describeError(e).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="rounded-2xl border bg-card p-5 sm:p-6">
      <div className="flex flex-wrap justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{order.title}</h2>
          <p className="mt-1 text-sm">{labels[order.status]}</p>
        </div>
        <p className="font-semibold">{formatNaira(order.amountKobo)}</p>
      </div>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">Order reference</dt>
          <dd className="break-all">{order.reference}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Saved</dt>
          <dd>{formatDateTime(order.createdAt)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Last server verification</dt>
          <dd>{order.lastCheckedAt ? formatDateTime(order.lastCheckedAt) : "Not yet verified"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Tax treatment</dt>
          <dd>{order.taxTreatment}</dd>
        </div>
      </dl>
      <details className="my-4 text-sm">
        <summary className="cursor-pointer py-2 font-medium">
          Licence at purchase · {order.licenceVersion}
        </summary>
        <p className="whitespace-pre-wrap py-2">{order.licenceText}</p>
        <p className="text-muted-foreground">
          Content version: <span className="break-all">{order.contentVersionId}</span>
        </p>
      </details>
      {order.disputeStatus && (
        <>
          <p className="my-3 text-sm" role="status">
            Provider dispute observation: {order.disputeStatus}. This label does not establish a final bank
            outcome or automatically restore held access. Saved drafts and previously downloaded files are not
            deleted.
          </p>
          <CustomerDisputeInformation orderId={order.id} />
        </>
      )}
      {order.status === "verified_success" && !download && (
        <p className="my-3 text-sm text-muted-foreground" data-testid="order-download-unavailable">
          This edition is no longer available to download. Your saved receipt stays here.
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        {download && order.status === "verified_success" && (
          <>
            <a
              href={basePath + download.downloadPath}
              className="btn btn-primary"
              aria-label={`Download ${order.title}`}
              data-testid="order-template-download"
            >
              <Download className="h-4 w-4" aria-hidden />{" "}
              {download.pdfDownloadPath ? "Download Word" : "Download"}
            </a>
            {download.pdfDownloadPath && (
              <a
                href={basePath + download.pdfDownloadPath}
                className="btn btn-secondary"
                aria-label={`Download ${order.title} PDF`}
                data-testid="order-template-download-pdf"
              >
                <Download className="h-4 w-4" aria-hidden /> Download PDF
              </a>
            )}
          </>
        )}
        {!download && ["created", "pending"].includes(order.status) && (
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const result = await startCommerceCheckout(order.id, {});
                window.location.assign(result.url);
              })
            }
          >
            Continue hosted test checkout
          </button>
        )}
        <button
          className="btn btn-secondary"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await refreshCommerceOrder(order.id, {});
              setNotice(
                "Status checked with Paystack. A browser return URL is never treated as proof of payment.",
              );
            })
          }
        >
          Check payment status
        </button>
        {order.receiptReference && (
          <button
            className="btn btn-secondary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const result = await getCommerceReceipt(order.id),
                  url = URL.createObjectURL(
                    new Blob([JSON.stringify(result, null, 2)], { type: "application/json" }),
                  );
                const a = document.createElement("a");
                a.href = url;
                a.download = `${result.receiptReference}.json`;
                a.click();
                URL.revokeObjectURL(url);
                setNotice(`${result.notice} Email delivery: ${result.deliveryStatus.replaceAll("_", " ")}.`);
              })
            }
          >
            Download test purchase receipt
          </button>
        )}
      </div>
      {!!order.refunds?.length && (
        <section className="mt-6 border-t pt-4" aria-label={`Refund history for ${order.reference}`}>
          <h3 className="font-semibold">Refund history</h3>
          <p className="my-2 text-sm">
            Confirmed processed: {formatNaira(order.refundedKobo)}. A provider-processed refund is not
            confirmation that your bank has credited your account.
          </p>
          <ul className="space-y-3">
            {order.refunds.map((r) => (
              <li key={r.id} className="rounded-xl border p-3 text-sm">
                <p>
                  {r.amountKobo === null ? "Amount not confirmed" : formatNaira(r.amountKobo)} ·{" "}
                  {r.status.replaceAll("_", " ")}
                </p>
                <p className="break-all text-xs text-muted-foreground">{r.reference}</p>
                <p className="my-1 whitespace-pre-wrap">{r.reason}</p>
                {r.decisionReason && <p>Finance decision: {r.decisionReason}</p>}
                <p>
                  Saved {formatDateTime(r.createdAt)} · Provider checked{" "}
                  {r.checkedAt ? formatDateTime(r.checkedAt) : "not yet"}
                </p>
                {r.failure && (
                  <p role="status">
                    Reconciliation: {r.failure.replaceAll("_", " ").toLowerCase()}. The request has not been
                    treated as a new payment.
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {order.status === "verified_success" && order.refundableKobo > 0 && (
        <form
          className="mt-6 border-t pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const match = /^(0|[1-9][0-9]{0,7})(?:\.([0-9]{1,2}))?$/.exec(amount);
              if (!match) throw Error("Enter a positive NGN amount with at most two decimal places.");
              const kobo = BigInt(match[1]!) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"));
              if (kobo <= 0n || kobo > BigInt(order.refundableKobo))
                throw Error("The amount must fit within the unreserved balance.");
              const fingerprint = JSON.stringify([reason, String(kobo)]);
              if (refundKey.current?.fingerprint !== fingerprint)
                refundKey.current = { fingerprint, key: crypto.randomUUID() };
              await requestCommerceRefund(order.id, {
                reason,
                amountKobo: Number(kobo),
                requestKey: refundKey.current!.key,
                acceptedPolicyVersion: "test-refund-v1",
              });
              setReason("");
              setAmount("");
              setPolicyAccepted(false);
              refundKey.current = null;
              setNotice(
                "Refund request saved for finance review. No refund has been completed and your drafts remain unchanged.",
              );
            });
          }}
        >
          <label className="block text-sm font-medium" htmlFor={`refund-amount-${order.id}`}>
            Refund amount in NGN
          </label>
          <input
            id={`refund-amount-${order.id}`}
            inputMode="decimal"
            className="field my-2 w-full"
            maxLength={12}
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <p className="mb-3 text-sm text-muted-foreground">
            Unreserved balance: {formatNaira(order.refundableKobo)}. Pending or unknown refunds reduce this
            balance.
          </p>
          <label className="block text-sm font-medium" htmlFor={`refund-${order.id}`}>
            Reason for refund request
          </label>
          <textarea
            className="field my-2 w-full"
            id={`refund-${order.id}`}
            minLength={10}
            maxLength={1500}
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <p className="my-3 text-sm">{order.refundPolicy}</p>
          <label className="my-3 flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              required
              checked={policyAccepted}
              onChange={(e) => setPolicyAccepted(e.target.checked)}
            />
            I accept this test-only refund policy for this request.
          </label>
          <button className="btn btn-secondary" disabled={busy || !policyAccepted}>
            Request refund review
          </button>
        </form>
      )}
      {busy && (
        <p className="mt-3 text-sm" role="status">
          Checking your request…
        </p>
      )}
      {error && (
        <p className="mt-3 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="mt-3 text-sm" role="status">
          {notice}
        </p>
      )}
      <PaymentConcerns orderId={order.id} orderReference={order.reference} />
    </article>
  );
}
