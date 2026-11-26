import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CommerceOrder, OwnedCheckoutDownload } from "@workspace/api-client-react";
import { OrderCard } from "./purchase-order-card";

// docs/architecture/editions.md, slice 2 (delegated decision 3): a purchase whose edition was replaced
// carries to the template's new edition at no further charge, and the order says so.
const order: CommerceOrder = {
  id: "00000000-0000-4000-8000-00000000a101",
  reference: "ORD-SYNTH-1",
  title: "Synthetic premium template",
  amountKobo: 250000,
  currency: "NGN",
  status: "verified_success",
  createdAt: "2026-11-25T09:00:00.000Z",
  lastCheckedAt: "2026-11-25T09:00:00.000Z",
  licenceVersion: "synthetic-licence-v1",
  licenceText: "Synthetic licence text.",
  taxTreatment: "Synthetic tax treatment.",
  contentVersionId: "00000000-0000-4000-8000-00000000a201",
  editions: [
    { contentVersionId: "00000000-0000-4000-8000-00000000a201", title: "Synthetic premium template" },
  ],
  carriesToLaterEditions: true,
  refundStatus: null,
  receiptReference: "RCT-SYNTH-1",
  refunds: [],
  refundableKobo: 250000,
  refundedKobo: 0,
  refundPolicy: "Synthetic refund policy.",
  disputeStatus: null,
};
const bought: OwnedCheckoutDownload = {
  offerId: "00000000-0000-4000-8000-00000000a301",
  edition: order.contentVersionId!,
  title: order.title,
  downloadPath: "/api/workspace/manual-premium-templates/00000000-0000-4000-8000-00000000a201/download",
};
const render = (download: OwnedCheckoutDownload | undefined, shown: CommerceOrder = order) =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <OrderCard order={shown} download={download} changed={async () => undefined} />
    </QueryClientProvider>,
  );

test("a purchase whose edition was replaced downloads the new edition and says it comes at no further charge", () => {
  const carried = render({
    ...bought,
    downloadPath: "/api/workspace/manual-premium-templates/00000000-0000-4000-8000-00000000a202/download",
    carried: { boughtVersion: 1, version: 2 },
  });
  assert.match(carried, /You bought version 1\. Version 2 is yours at no\s+further charge/);
  assert.match(
    carried,
    /href="\/api\/workspace\/manual-premium-templates\/00000000-0000-4000-8000-00000000a202\/download"/,
  );
  assert.doesNotMatch(carried, /order-download-unavailable/);
  // The edition bought, still released, says nothing of a new one.
  assert.doesNotMatch(render(bought), /order-download-carried/);
  // With no edition to download, the order says so, and its receipt stays.
  assert.match(render(undefined), /This edition is no longer available to download/);
});

test("an order shows the access rule it recorded when it was made (ADM-006)", () => {
  assert.match(render(bought), /Later editions<\/dt><dd[^>]*>Included at no further charge</);
  // An order that covers only the edition bought says so; once that edition is replaced, its receipt stays.
  const only = { ...order, carriesToLaterEditions: false };
  assert.match(
    render(bought, only),
    /Later editions<\/dt><dd[^>]*>Not included: this order covers the edition bought, while it stays released</,
  );
  assert.match(render(undefined, only), /This edition is no longer available to download/);
});

test("a bundle's order lists each template it grants, with each one's download while the purchase holds it (ADM-006)", () => {
  const first = "00000000-0000-4000-8000-00000000a211",
    second = "00000000-0000-4000-8000-00000000a212";
  const bundle: CommerceOrder = {
    ...order,
    title: "Synthetic starter bundle",
    contentVersionId: null,
    editions: [
      { contentVersionId: first, title: "Synthetic agreement" },
      { contentVersionId: second, title: "Synthetic policy" },
    ],
  };
  const files = (held: boolean) =>
    bundle.editions.map((edition) => ({
      ...edition,
      download:
        held || edition.contentVersionId === first
          ? {
              offerId: edition.contentVersionId,
              edition: edition.contentVersionId,
              title: edition.title,
              downloadPath:
                "/api/workspace/manual-premium-templates/" + edition.contentVersionId + "/download",
            }
          : undefined,
    }));
  const shown = (held: boolean, status: CommerceOrder["status"] = "verified_success") =>
    renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <OrderCard
          order={{ ...bundle, status }}
          download={undefined}
          bundleFiles={files(held)}
          changed={async () => undefined}
        />
      </QueryClientProvider>,
    );
  const both = shown(true);
  assert.match(both, /Templates in this bundle/);
  for (const edition of [first, second])
    assert.match(both, new RegExp(`href="/api/workspace/manual-premium-templates/${edition}/download"`));
  assert.match(both, /aria-label="Download Synthetic agreement"/);
  // A bundle's order names no single edition, and says nothing of one.
  assert.doesNotMatch(both, /Content version/);
  assert.doesNotMatch(both, /This edition is no longer available to download/);
  // A template the purchase no longer holds says so, while the other still downloads.
  const one = shown(false);
  assert.match(one, /Synthetic policy<\/span><span[^>]*>No longer available to download/);
  assert.match(one, new RegExp(`/api/workspace/manual-premium-templates/${first}/download`));
  // Before the payment is verified, nothing downloads.
  assert.doesNotMatch(shown(true, "pending"), /bundle-template-download/);
});
