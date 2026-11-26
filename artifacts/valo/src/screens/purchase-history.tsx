import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useSearch } from "wouter";
import { ShoppingBag } from "lucide-react";
import {
  useGetCustomerPurchases,
  getGetCustomerPurchasesQueryKey,
  useListWorkspaceMessages,
  getListWorkspaceMessagesQueryKey,
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
  // What became of each order's messages (docs/architecture/messages.md, slice 1b). The orders are shown
  // whether or not this loads; an order's card says nothing of its messages until it has.
  const messages = useListWorkspaceMessages({
    query: { queryKey: getListWorkspaceMessagesQueryKey(), refetchOnWindowFocus: true },
  });
  const [licences, setLicences] = useState<Record<string, boolean>>({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [bundleError, setBundleError] = useState<string | null>(null);
  const [keys] = useState(() => new Map<string, string>());
  const offers = q.data?.products ?? [];
  // Bundles on sale that hold no template the workspace owns (docs/architecture/commercial-settings.md, slice 4c).
  const bundles = q.data?.bundles ?? [];
  // The access rule a purchase made now records; the order is made only with it accepted.
  const carries = q.data?.purchaseCarriesToLaterEditions ?? true;
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
  /** Saves a test order once for these terms: a retry reuses its request key, so it never makes a second. */
  async function saveOrder(
    keyId: string,
    choice: { priceId: string } | { bundleId: string },
    licenceVersion: string,
    failed: (message: string | null) => void,
  ) {
    setBusy(true);
    failed(null);
    try {
      if (!keys.has(keyId)) keys.set(keyId, randomUuid());
      await createCommerceOrder({
        ...choice,
        acceptedLicenceVersion: licenceVersion,
        acceptedCarriesToLaterEditions: carries,
        requestKey: keys.get(keyId)!,
      });
      keys.delete(keyId);
      await refresh();
    } catch (e) {
      failed(describeError(e).message);
      await refresh();
    } finally {
      setBusy(false);
    }
  }
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
                    : bundles.length
                      ? "No template is on sale on its own. The bundles below can be bought."
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
                    {/* The access rule a purchase made now records (ADM-006). */}
                    <p className="my-2 text-sm" data-testid="product-later-editions">
                      {carries
                        ? "Later editions of this template are included at no further charge."
                        : "This purchase covers this edition only, while it stays released: a later edition is not included."}
                    </p>
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
                        void saveOrder(
                          `${p.id}:${p.licenceVersion}:${carries}`,
                          { priceId: p.id },
                          p.licenceVersion,
                          setError,
                        )
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
          {!directCheckout && bundles.length > 0 && (
            <section className="mb-8" aria-labelledby="bundle-choices">
              <h2 id="bundle-choices" className="font-display mb-4 text-2xl">
                Bundles you can buy
              </h2>
              <ul className="grid gap-4 sm:grid-cols-2">
                {bundles.map((b) => (
                  <li key={b.id} className="rounded-2xl border bg-card p-5" data-testid="bundle-offer">
                    <h3 className="font-semibold">
                      {b.title} · {formatNaira(b.amountKobo)}
                    </h3>
                    <p className="mt-2 text-sm">
                      One purchase of these {b.templates.length} premium templates:
                    </p>
                    <ul className="list-disc pl-5 text-sm" aria-label={`Templates in ${b.title}`}>
                      {b.templates.map((template) => (
                        <li key={template.edition}>{template.title}</li>
                      ))}
                    </ul>
                    <p className="my-2 text-sm">{b.taxTreatment}</p>
                    {/* The access rule a purchase made now records (ADM-006). */}
                    <p className="my-2 text-sm" data-testid="bundle-later-editions">
                      {carries
                        ? "Later editions of these templates are included at no further charge."
                        : "This purchase covers these editions only, while they stay released: a later edition is not included."}
                    </p>
                    <details className="text-sm">
                      <summary className="cursor-pointer py-2">Licence · {b.licenceVersion}</summary>
                      <p className="whitespace-pre-wrap">{b.licenceText}</p>
                    </details>
                    <label className="my-3 flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={licences["bundle:" + b.id] ?? false}
                        onChange={(e) => setLicences((s) => ({ ...s, ["bundle:" + b.id]: e.target.checked }))}
                      />
                      I accept this version of the licence for this business.
                    </label>
                    <button
                      disabled={busy || !licences["bundle:" + b.id]}
                      className="btn btn-primary"
                      onClick={() =>
                        void saveOrder(
                          `bundle:${b.id}:${b.licenceVersion}:${carries}`,
                          { bundleId: b.id },
                          b.licenceVersion,
                          setBundleError,
                        )
                      }
                    >
                      Save test order
                    </button>
                  </li>
                ))}
              </ul>
              {bundleError && (
                <p role="alert" className="mt-3 text-sm text-destructive">
                  {bundleError}
                </p>
              )}
            </section>
          )}
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
                      download={
                        order.contentVersionId ? editionDownloads.get(order.contentVersionId) : undefined
                      }
                      bundleFiles={
                        order.contentVersionId
                          ? undefined
                          : order.editions.map((edition) => ({
                              ...edition,
                              download: editionDownloads.get(edition.contentVersionId),
                            }))
                      }
                      messages={messages.data}
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
