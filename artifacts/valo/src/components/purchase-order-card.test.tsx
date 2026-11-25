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
  edition: order.contentVersionId,
  title: order.title,
  downloadPath: "/api/workspace/manual-premium-templates/00000000-0000-4000-8000-00000000a201/download",
};
const render = (download: OwnedCheckoutDownload | undefined) =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <OrderCard order={order} download={download} changed={async () => undefined} />
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
