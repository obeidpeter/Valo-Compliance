import { useState, useRef } from "react";
import { PaymentConcerns } from "@/components/payment-concerns";
import { CustomerDisputeInformation, DisputeFormsBoundary } from "@/components/dispute-workflows";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useSearch } from "wouter";
import { Download, ShoppingBag } from "lucide-react";
import {
  useGetCustomerPurchases,
  getGetCustomerPurchasesQueryKey,
  createCommerceOrder,
  startCommerceCheckout,
  refreshCommerceOrder,
  getCommerceReceipt,
  requestCommerceRefund,
  type CommerceOrder,
  type OwnedCheckoutDownload,
} from "@workspace/api-client-react";
import { WorkspaceNav } from "@/components/workspace-nav";
import { EmptyState, ErrorState, Notice, Skel } from "@/components/states";
import { describeError } from "@/lib/api";
import { formatCount, formatDateTime, formatNaira } from "@/lib/format";
import { randomUuid } from "@/lib/idempotency";
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
function OwnedChoice({ file }: { file: OwnedCheckoutDownload }) {
  return (
    <li className="rounded-2xl border bg-card p-5">
      <h3 className="font-semibold">{file.title}</h3>
      <p className="my-3 text-sm">Your workspace owns this edition.</p>
      <div className="flex flex-wrap gap-2">
        <a href={basePath + file.downloadPath} className="btn btn-primary" data-testid="checkout-download">
          <Download className="h-4 w-4" aria-hidden /> {file.pdfDownloadPath ? "Download Word" : "Download"}
        </a>
        {file.pdfDownloadPath && (
          <a
            href={basePath + file.pdfDownloadPath}
            className="btn btn-secondary"
            data-testid="checkout-download-pdf"
          >
            <Download className="h-4 w-4" aria-hidden /> Download PDF
          </a>
        )}
      </div>
    </li>
  );
}
function MyTemplates({ editions }: { editions: ReadonlyMap<string, OwnedCheckoutDownload> }) {
  const [search, setSearch] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const query = search.trim().toLowerCase();
  const files = [...editions.values()]
    .filter((file) => file.title.toLowerCase().includes(query))
    .sort((a, b) => a.title.localeCompare(b.title, "en-NG") || a.edition.localeCompare(b.edition));
  return (
    <section className="mb-8" aria-labelledby="my-templates">
      <h2 id="my-templates" className="font-display mb-4 text-2xl">
        My Templates
      </h2>
      <div className="mb-4 max-w-xl">
        <label className="label" htmlFor="owned-template-search">
          Search by title
        </label>
        <div className="flex items-center gap-2">
          <input
            ref={searchInput}
            id="owned-template-search"
            type="search"
            autoComplete="off"
            className="field min-w-0 flex-1 [&::-webkit-search-cancel-button]:hidden"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {search && (
            <button
              type="button"
              className="btn btn-secondary shrink-0"
              onClick={() => {
                setSearch("");
                searchInput.current?.focus();
              }}
            >
              Clear search
            </button>
          )}
        </div>
      </div>
      <p
        role="status"
        className={files.length ? "sr-only" : "rounded-2xl border bg-card p-5 text-sm text-muted-foreground"}
      >
        {!editions.size
          ? "Your workspace has no premium templates available to download."
          : !files.length
            ? "No owned editions match your search."
            : `${formatCount(files.length)} ${files.length === 1 ? "edition" : "editions"} available to download.`}
      </p>
      {files.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {files.map((file) => (
            <li
              key={file.edition}
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card p-4"
            >
              <h3 className="min-w-0 break-words font-semibold">{file.title}</h3>
              <div className="flex flex-wrap gap-2">
                <a
                  href={basePath + file.downloadPath}
                  aria-label={`Download ${file.title}`}
                  className="btn btn-secondary shrink-0"
                >
                  <Download className="h-4 w-4" aria-hidden />{" "}
                  {file.pdfDownloadPath ? "Download Word" : "Download"}
                </a>
                {file.pdfDownloadPath && (
                  <a
                    href={basePath + file.pdfDownloadPath}
                    aria-label={`Download ${file.title} PDF`}
                    className="btn btn-secondary shrink-0"
                  >
                    <Download className="h-4 w-4" aria-hidden /> Download PDF
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
function OrderCard({
  order,
  downloadPath,
  changed,
}: {
  order: CommerceOrder;
  downloadPath: string | undefined;
  changed: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState(""),
    [notice, setNotice] = useState<string | null>(null);
  const [amount, setAmount] = useState(""),
    [policyAccepted, setPolicyAccepted] = useState(false);
  const refundKey = useRef<{ fingerprint: string; key: string } | null>(null);
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
      {order.status === "verified_success" && !downloadPath && (
        <p className="my-3 text-sm text-muted-foreground" data-testid="order-download-unavailable">
          This edition is no longer available to download. Your saved receipt stays here.
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        {downloadPath && order.status === "verified_success" && (
          <a
            href={basePath + downloadPath}
            className="btn btn-primary"
            aria-label={`Download ${order.title}`}
            data-testid="order-template-download"
          >
            <Download className="h-4 w-4" aria-hidden /> Download
          </a>
        )}
        {!downloadPath && ["created", "pending"].includes(order.status) && (
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
export function PurchaseHistoryPage() {
  return (
    <DisputeFormsBoundary>
      <PurchaseHistoryContent />
    </DisputeFormsBoundary>
  );
}
function PurchaseHistoryContent() {
  const offerId = new URLSearchParams(useSearch()).get("offer");
  const directCheckout = offerId !== null;
  const qc = useQueryClient(),
    q = useGetCustomerPurchases({
      query: {
        queryKey: getGetCustomerPurchasesQueryKey(),
        refetchOnWindowFocus: true,
        refetchInterval: 30000,
      },
    });
  const [licences, setLicences] = useState<Record<string, boolean>>({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [keys] = useState(() => new Map<string, string>());
  const offers = q.data?.products ?? [];
  const ownedFiles = q.data?.ownedDownloads ?? [];
  const downloads = new Map(ownedFiles.map((file) => [file.offerId, file]));
  const editionDownloads = new Map(ownedFiles.map((file) => [file.edition, file]));
  // Historical offers resolve old checkout links. Prefer the current offer's title for the edition.
  for (const offer of offers) {
    const file = downloads.get(offer.id);
    if (file) editionDownloads.set(file.edition, file);
  }
  const products = offers.filter((p) => (directCheckout ? p.id === offerId : !downloads.has(p.id)));
  const selectedDownload = offerId ? downloads.get(offerId) : undefined;
  const refresh = () => qc.invalidateQueries({ queryKey: getGetCustomerPurchasesQueryKey() });
  return (
    <div className="mx-auto max-w-6xl px-5 py-10 lg:px-8">
      <WorkspaceNav />
      <header className="mb-8">
        <p className="eyebrow">Your workspace</p>
        <h1 className="font-display mt-2 text-4xl">
          {directCheckout ? "Template checkout" : "Purchases and licences"}
        </h1>
        {directCheckout ? (
          <Link href="/workspace/purchases" className="mt-3 inline-block text-primary underline">
            View all purchases and licences
          </Link>
        ) : (
          <p className="mt-3 max-w-2xl text-muted-foreground" data-testid="text-purchases-message">
            Your orders, their receipts and the licences you accepted are listed here. A saved order is not
            proof of payment, and neither is coming back from the payment page.
          </p>
        )}
      </header>
      <Notice title="Real payments are switched off" className="mb-6">
        Where a checkout is offered here, it is a test, in Paystack's test mode. Do not enter a real card, or
        real or confidential customer details. A receipt sent by email is not shown as delivered unless its
        delivery is confirmed.
      </Notice>
      {q.isLoading ? (
        <Skel className="h-48" />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <>
          {!directCheckout && <MyTemplates editions={editionDownloads} />}
          <section className="mb-8" aria-labelledby="purchase-choices">
            <h2 id="purchase-choices" className="font-display mb-4 text-2xl">
              {directCheckout ? "Your selected template" : "Documents you can buy"}
            </h2>
            {selectedDownload ? (
              <ul className="max-w-2xl">
                <OwnedChoice file={selectedDownload} />
              </ul>
            ) : !products.length ? (
              <p
                className="rounded-2xl border bg-card p-5 text-sm text-muted-foreground"
                data-testid="text-nothing-to-buy"
              >
                {directCheckout
                  ? "This offer is unavailable. Open the template again to see its current price and licence."
                  : offers.length
                    ? "Your workspace owns every template currently on sale."
                    : "Nothing can be bought yet. A document is listed here once it is published with a price and a licence. The documents you have made, and their files, stay in your workspace."}
              </p>
            ) : (
              <ul className={directCheckout ? "max-w-2xl" : "grid gap-4 sm:grid-cols-2"}>
                {products.map((p) => (
                  <li key={p.id} className="rounded-2xl border bg-card p-5">
                    <h3 className="font-semibold">
                      {p.title} · {formatNaira(p.amountKobo)}
                    </h3>
                    <p className="my-2 text-sm">{p.taxTreatment}</p>
                    <details className="text-sm">
                      <summary className="cursor-pointer py-2">Licence · {p.licenceVersion}</summary>
                      <p className="whitespace-pre-wrap">{p.licenceText}</p>
                    </details>
                    <label className="my-3 flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={licences[p.id] ?? false}
                        onChange={(e) => setLicences((s) => ({ ...s, [p.id]: e.target.checked }))}
                      />
                      I accept this version of the licence for this business.
                    </label>
                    <button
                      disabled={busy || !licences[p.id]}
                      className="btn btn-primary"
                      onClick={() =>
                        void (async () => {
                          setBusy(true);
                          setError(null);
                          try {
                            const keyId = `${p.id}:${p.licenceVersion}`;
                            if (!keys.has(keyId)) keys.set(keyId, randomUuid());
                            await createCommerceOrder({
                              priceId: p.id,
                              acceptedLicenceVersion: p.licenceVersion,
                              requestKey: keys.get(keyId)!,
                            });
                            keys.delete(keyId);
                            await refresh();
                          } catch (e) {
                            setError(describeError(e).message);
                            await refresh();
                          } finally {
                            setBusy(false);
                          }
                        })()
                      }
                    >
                      Save test order
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {error && (
              <p role="alert" className="mt-3 text-sm text-destructive">
                {error}
              </p>
            )}
          </section>
          {(!directCheckout || Boolean(q.data?.orders.length)) && (
            <section aria-labelledby="purchase-history">
              <h2 id="purchase-history" className="font-display mb-4 text-2xl">
                Your orders
              </h2>
              {!q.data?.orders.length ? (
                <EmptyState
                  mark={<ShoppingBag className="h-5 w-5" />}
                  title="No orders yet"
                  action={
                    <Link href="/workspace" className="btn btn-primary">
                      Back to Home
                    </Link>
                  }
                >
                  An order appears here once you choose a document to buy and accept its licence. Saving an
                  order does not pay for it.
                </EmptyState>
              ) : (
                <div className="space-y-4">
                  {q.data.orders.map((order) => (
                    <OrderCard
                      key={order.id}
                      order={order}
                      downloadPath={editionDownloads.get(order.contentVersionId)?.downloadPath}
                      changed={refresh}
                    />
                  ))}
                  {q.data.hasMoreOrders && (
                    <p className="text-sm text-muted-foreground" data-testid="text-more-orders">
                      Showing your 100 most recent orders. Every premium template you own stays listed under
                      My Templates above.
                    </p>
                  )}
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
