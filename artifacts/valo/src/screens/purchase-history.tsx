import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useSearch } from "wouter";
import { ShoppingBag } from "lucide-react";
import {
  useGetCustomerPurchases,
  getGetCustomerPurchasesQueryKey,
  createCommerceOrder,
} from "@workspace/api-client-react";
import { DisputeFormsBoundary } from "@/components/dispute-workflows";
import { OrderCard } from "@/components/purchase-order-card";
import { MyTemplates, OwnedChoice } from "@/components/purchase-owned-templates";
import { WorkspaceNav } from "@/components/workspace-nav";
import { EmptyState, ErrorState, Notice, Skel } from "@/components/states";
import { describeError } from "@/lib/api";
import { formatNaira } from "@/lib/format";
import { randomUuid } from "@/lib/idempotency";
import { hasActivePurchaseWork } from "@/lib/purchase-state";

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
        refetchInterval: (query) => (hasActivePurchaseWork(query.state.data?.orders) ? 30000 : false),
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
                      download={editionDownloads.get(order.contentVersionId)}
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
