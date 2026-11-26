import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  GetCustomerPurchasesResponse,
  GetManualLibraryRevisionResponse,
  ListOwnedTemplateEditionsResponse,
  ListPublicCatalogueResponse,
  RecordManualLibraryReviewResponse,
} from "@workspace/api-zod";
import { wordFromText } from "../modules/manual-library/files";
import { templateDetails } from "./template-details";

type Call = (path: string, body?: unknown, actor?: string) => Promise<Response>;

/**
 * Keeping published guidance current, slice 2 (EDP-011): a premium template overdue for its review is
 * neither offered, ordered nor priced, while a workspace whose payment for it is verified downloads its
 * file and finds it among its purchases. Once a Content editor records a review, it is offered again.
 */
export async function exerciseOverduePremiumTemplate(call: Call, editor: string) {
  const { db, valoManualLibrary, valoOrders, valoPrices, runInWorkspaceScope } =
    await import("@workspace/db");
  const { resolveWorkspace } = await import("../modules/workspaces");
  const {
    commerceProducts,
    createOrder,
    premiumPriceTerms,
    premiumPriceTermsId,
    recordPremiumPrice,
    settleVerifiedOrder,
  } = await import("../modules/commerce");
  const day = 86_400_000;
  const itemId = randomUUID();
  const path = "/admin/manual-library/" + itemId;
  const title = "Synthetic overdue agreement";
  const { bytes } = wordFromText("Synthetic overdue edition", "Only the purchaser may read this sentence.");
  const saved = await call(
    path + "/drafts",
    {
      kind: "premium_template",
      title,
      body: "Public description of the synthetic overdue agreement.",
      industry: null,
      requestId: randomUUID(),
      baseVersion: 0,
      fileMode: "upload",
      upload: { format: "docx", base64: bytes.toString("base64") },
      ...templateDetails,
    },
    editor,
  );
  assert.equal(saved.status, 200);
  const edition = GetManualLibraryRevisionResponse.parse(await saved.json());
  // Released 91 days ago, so its review is overdue. It is released directly here so that it can be
  // dated in the past; the library's own trigger still requires its Content editor.
  await db
    .update(valoManualLibrary)
    .set({ state: "published", publishedBy: editor, publishedAt: new Date(Date.now() - 91 * day) })
    .where(eq(valoManualLibrary.id, edition.id));
  const priceId = randomUUID();
  const price = {
    id: priceId,
    contentVersionId: edition.id,
    title: "Synthetic overdue fixture",
    amountKobo: 10000,
    licenceVersion: "fixture-1",
    licenceText: "Test use only",
    taxTreatment: "Synthetic",
    approvalReference: "LOCAL_TEST_ONLY",
    effectiveFrom: new Date(Date.now() - 1000),
  };
  await db.insert(valoPrices).values(price);
  const buyer = await resolveWorkspace("synthetic-overdue-buyer-" + itemId);
  const other = await resolveWorkspace("synthetic-overdue-other-" + itemId);
  const offered = (holder: typeof buyer) =>
    runInWorkspaceScope(holder.workspaceId, async () =>
      (await commerceProducts()).some((product) => product.id === priceId),
    );
  const order = (holder: typeof buyer) =>
    runInWorkspaceScope(holder.workspaceId, () =>
      createOrder(holder, {
        priceId,
        acceptedLicenceVersion: "fixture-1",
        acceptedCarriesToLaterEditions: true,
        requestKey: randomUUID(),
      }),
    );
  const card = async () => {
    const response = await call(
      "/public/catalogue?type=template&access=premium&q=" + encodeURIComponent(title),
    );
    assert.equal(response.status, 200);
    return ListPublicCatalogueResponse.parse(await response.json()).items.find(
      (entry) => entry.slug === "manual-" + itemId,
    );
  };
  const download = (identity: string) =>
    call("/workspace/manual-premium-templates/" + edition.id + "/download", undefined, identity);

  // Overdue, it is not on the public pages, not offered and not ordered, and its owner cannot price it.
  assert.equal((await call("/public/templates/manual-" + itemId)).status, 404);
  assert.equal(await card(), undefined);
  assert.equal(await offered(other), false);
  await assert.rejects(order(other), { status: 409 });
  const terms = premiumPriceTerms({
    edition: edition.id,
    amount: "2500.00",
    licenceVersion: "synthetic-overdue-1",
    licenceText: "Synthetic licence for one business's own use only.",
    taxTreatment: "Synthetic tax treatment",
    from: "now",
  });
  await assert.rejects(
    recordPremiumPrice(terms, {
      approvedBy: "Synthetic owner",
      reference: "synthetic-overdue-approval",
      confirm: premiumPriceTermsId(terms),
    }),
    /not overdue for its review/,
  );

  // A payment made while it was offered, and verified after it fell due for review, still grants it:
  // the buyer downloads its file and finds it among their purchases. Nobody else downloads it.
  const orderId = randomUUID();
  await db.insert(valoOrders).values({
    id: orderId,
    reference: "valo-test-" + orderId,
    workspaceId: buyer.workspaceId,
    requestedBy: buyer.identityId,
    priceId,
    requestKey: randomUUID(),
    amountKobo: price.amountKobo,
    currency: "NGN",
    line: {
      title: price.title,
      contentVersionId: edition.id,
      licenceVersion: price.licenceVersion,
      licenceText: price.licenceText,
      taxTreatment: price.taxTreatment,
    },
  });
  await settleVerifiedOrder(orderId, {
    id: String(Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16)),
    domain: "test",
    status: "success",
    reference: "valo-test-" + orderId,
    amount: price.amountKobo,
    currency: "NGN",
    metadata: { valoOrderId: orderId, workspaceId: buyer.workspaceId },
  });
  const purchases = await call("/workspace/purchases", undefined, buyer.identityId);
  assert.equal(purchases.status, 200);
  const files = GetCustomerPurchasesResponse.parse(await purchases.json()).ownedDownloads;
  assert.deepEqual(
    files
      .filter((entry) => entry.edition === edition.id)
      .map((entry) => [entry.offerId, entry.downloadPath, entry.carried]),
    [[priceId, "/api/workspace/manual-premium-templates/" + edition.id + "/download", undefined]],
  );
  const owned = await call("/workspace/owned-template-editions", undefined, buyer.identityId);
  assert.equal(owned.status, 200);
  assert.deepEqual(ListOwnedTemplateEditionsResponse.parse(await owned.json()), [edition.id]);
  const file = await download(buyer.identityId);
  assert.equal(file.status, 200);
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), bytes);
  assert.equal((await download(other.identityId)).status, 403);

  // Reviewed, it is shown, offered and ordered again.
  const reviewed = await call(
    path + "/editorial-reviews",
    {
      version: edition.version,
      digest: edition.digest,
      note: "Synthetic: re-read the agreement against its purpose and limits, and it needs no change.",
    },
    editor,
  );
  assert.equal(reviewed.status, 200);
  RecordManualLibraryReviewResponse.parse(await reviewed.json());
  assert.equal((await card())?.priceId, priceId);
  assert.equal(await offered(other), true);
  assert.equal((await order(other)).amountKobo, price.amountKobo);
}
