import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import {
  GetManualLibraryRevisionResponse,
  GetReleasedTemplateResponse,
  GetCustomerPurchasesResponse,
  ListOwnedTemplateEditionsResponse,
  ListPublicCatalogueResponse,
} from "@workspace/api-zod";
import { wordFromText } from "../modules/manual-library/files";

type Call = (path: string, body?: unknown, actor?: string) => Promise<Response>;

export async function exercisePremiumManualTemplate(call: Call, editor: string) {
  const { db, valoOrders, valoPrices, runInWorkspaceScope } = await import("@workspace/db");
  const { resolveWorkspace } = await import("../modules/workspaces");
  const { commerceProducts, createOrder, settleVerifiedOrder } = await import("../modules/commerce");
  const itemId = randomUUID();
  const path = "/admin/manual-library/" + itemId;
  const { bytes } = wordFromText("Synthetic private edition", "Only the purchaser may read this sentence.");
  const data = {
    kind: "premium_template",
    title: "Service agreement",
    body: "Public description of the synthetic agreement.",
    industry: null,
    requestId: randomUUID(),
    baseVersion: 0,
    fileMode: "upload",
    upload: { format: "docx", base64: bytes.toString("base64") },
  };
  const draft = (value: unknown) => call(path + "/drafts", value, editor);
  const libraryCard = async () => {
    const response = await call("/public/catalogue?type=template&access=premium&q=Service%20agreement");
    assert.equal(response.status, 200);
    return ListPublicCatalogueResponse.parse(await response.json()).items.find(
      (i) => i.slug === "manual-" + itemId,
    );
  };
  const readRevision = async (response: Response) => {
    assert.equal(response.status, 200);
    return GetManualLibraryRevisionResponse.parse(await response.json());
  };
  const act = (action: string, revision: { version: number; digest: string }) =>
    call(path + "/actions", { action, version: revision.version, digest: revision.digest }, editor);
  assert.equal((await draft({ ...data, kind: "template" })).status, 422);
  assert.equal((await draft({ ...data, title: "Invoice" })).status, 422);
  assert.equal((await draft({ ...data, body: "" })).status, 422);
  assert.equal((await draft({ ...data, body: "x".repeat(601) })).status, 422);
  assert.equal((await draft({ ...data, fileMode: "text", upload: undefined })).status, 422);
  const first = await readRevision(await draft(data));
  assert.deepEqual(
    Buffer.from(await (await call(path + "/revisions/1/file", undefined, editor)).arrayBuffer()),
    bytes,
  );
  const account = await resolveWorkspace("synthetic-premium-reader-" + itemId);
  const reader = account.identityId,
    other = "synthetic-other-premium-reader-" + itemId;
  const download = (edition: string, identity: string) =>
    call("/workspace/manual-premium-templates/" + edition + "/download", undefined, identity);
  const owned = async (identity: string) => {
    const response = await call("/workspace/owned-template-editions", undefined, identity);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    return ListOwnedTemplateEditionsResponse.parse(await response.json());
  };
  const priceId = randomUUID();
  const price = {
    id: priceId,
    contentVersionId: first.id,
    title: "Synthetic premium fixture",
    amountKobo: 10000,
    licenceVersion: "fixture-1",
    licenceText: "Test use only",
    taxTreatment: "Synthetic",
    approvalReference: "LOCAL_TEST_ONLY",
    effectiveFrom: new Date(),
  };
  await db.insert(valoPrices).values([
    price,
    { ...price, id: randomUUID(), amountKobo: 9000, effectiveFrom: new Date(Date.now() - 172800000) },
    { ...price, id: randomUUID(), amountKobo: 12000, effectiveFrom: new Date(Date.now() + 86400000) },
    {
      ...price,
      id: randomUUID(),
      amountKobo: 8000,
      effectiveFrom: new Date(Date.now() - 86400000),
      effectiveTo: new Date(Date.now() - 1000),
    },
  ]);
  const productVisible = () =>
    runInWorkspaceScope(account.workspaceId, async () =>
      (await commerceProducts()).some((p) => p.id === priceId),
    );
  assert.equal(await productVisible(), false);
  assert.equal(await libraryCard(), undefined);
  await readRevision(await act("publish", first));
  const detail = GetReleasedTemplateResponse.parse(
    await (await call("/public/templates/manual-" + itemId)).json(),
  );
  assert.equal(detail.access, "premium");
  assert.deepEqual(detail.offer, {
    id: priceId,
    title: price.title,
    amountKobo: 10000,
    currency: "NGN",
    licenceVersion: "fixture-1",
    licenceText: "Test use only",
    taxTreatment: "Synthetic",
  });
  const buyerOffer = await runInWorkspaceScope(account.workspaceId, async () =>
    (await commerceProducts()).find((p) => p.id === priceId),
  );
  assert.deepEqual(detail.offer, buyerOffer);
  const card = await libraryCard();
  assert.equal(card?.id, first.id);
  assert.equal(card.amountKobo, detail.offer.amountKobo);
  assert.equal(card.priceId, detail.offer.id);
  assert.equal(card.freeDownloadPath, undefined);
  assert.equal(card.premiumDownloadPath, "/api/workspace/manual-premium-templates/" + first.id + "/download");
  assert.equal((await call("/workspace/owned-template-editions", undefined, "")).status, 401);
  assert.deepEqual(await owned(reader), []);
  assert.deepEqual(detail.preview, [data.body]);
  assert.equal((await call("/public/resources/manual-" + itemId)).status, 404);
  assert.equal(
    (await call("/account/manual-templates/" + first.id + "/download", undefined, reader)).status,
    404,
  );
  assert.equal((await download(first.id, "")).status, 401);
  assert.equal((await download(first.id, reader)).status, 403);
  assert.equal(await productVisible(), true);
  const orderFor = (holder: typeof account) =>
    runInWorkspaceScope(holder.workspaceId, () =>
      createOrder(holder, {
        priceId,
        acceptedLicenceVersion: "fixture-1",
        requestKey: randomUUID(),
      }),
    );
  const [order, secondTab] = await Promise.all([orderFor(account), orderFor(account)]);
  assert.equal(order.id, secondTab.id);
  // Previous versions could save a second order for the same edition from another tab.
  const legacyId = randomUUID();
  await db.insert(valoOrders).values({
    id: legacyId,
    reference: "valo-test-" + legacyId,
    workspaceId: account.workspaceId,
    requestedBy: reader,
    priceId,
    requestKey: randomUUID(),
    amountKobo: price.amountKobo,
    currency: "NGN",
    line: {
      title: price.title,
      contentVersionId: first.id,
      licenceVersion: price.licenceVersion,
      licenceText: price.licenceText,
      taxTreatment: price.taxTreatment,
    },
  });
  const startLegacy = () => call("/workspace/orders/" + legacyId + "/checkout", {}, reader);
  const competingCheckout = await startLegacy();
  assert.equal(competingCheckout.status, 409);
  const checkoutFiles = async (who: string) => {
    const response = await call("/workspace/purchases", undefined, who);
    assert.equal(response.status, 200);
    return GetCustomerPurchasesResponse.parse(await response.json()).ownedDownloads;
  };
  assert.deepEqual(await checkoutFiles(reader), []);
  assert.deepEqual(await owned(reader), []);
  assert.equal((await download(first.id, reader)).status, 403);
  const verified = {
    id: String(Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16)),
    domain: "test" as const,
    status: "success" as const,
    reference: order.reference,
    amount: order.amountKobo,
    currency: "NGN" as const,
    metadata: { valoOrderId: order.id, workspaceId: account.workspaceId },
  };
  await settleVerifiedOrder(order.id, verified);
  assert.equal((await startLegacy()).status, 409);
  await assert.rejects(orderFor(account), /payment for this edition is already on record/);
  assert.ok(
    (await checkoutFiles(reader)).some(
      (file) =>
        file.offerId === priceId &&
        file.edition === first.id &&
        file.downloadPath === "/api/workspace/manual-premium-templates/" + first.id + "/download",
    ),
  );
  assert.deepEqual(await checkoutFiles(other), []);
  assert.deepEqual(await owned(reader), [first.id]);
  assert.deepEqual(await owned(other), []);
  const file = await download(first.id, reader);
  assert.equal(file.status, 200);
  assert.equal(file.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), bytes);
  assert.equal((await download(first.id, other)).status, 403);
  await settleVerifiedOrder(order.id, { ...verified, status: "reversed" });
  assert.deepEqual(await checkoutFiles(reader), []);
  assert.deepEqual(await owned(reader), []);
  assert.equal((await download(first.id, reader)).status, 403);
  // Keep a different workspace's genuine test entitlement active across replacement.
  const secondBuyer = await resolveWorkspace(other);
  const secondOrder = await orderFor(secondBuyer);
  await settleVerifiedOrder(secondOrder.id, {
    ...verified,
    id: String(Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16)),
    reference: secondOrder.reference,
    metadata: { valoOrderId: secondOrder.id, workspaceId: secondBuyer.workspaceId },
  });
  assert.equal((await download(first.id, other)).status, 200);
  const newPrice = { ...price, id: randomUUID(), amountKobo: 11000, effectiveFrom: new Date() };
  await db
    .update(valoPrices)
    .set({ effectiveTo: sql`now()` })
    .where(eq(valoPrices.id, priceId));
  await db.insert(valoPrices).values(newPrice);
  const afterRepricing = await checkoutFiles(other);
  assert.ok(
    [priceId, newPrice.id].every((id) =>
      afterRepricing.some((file) => file.offerId === id && file.edition === first.id),
    ),
  );
  assert.equal((await libraryCard())?.priceId, newPrice.id);
  assert.deepEqual(await owned(other), [first.id]);
  assert.equal((await download(first.id, other)).status, 200);
  const next = await readRevision(
    await draft({ ...data, requestId: randomUUID(), baseVersion: 1, fileMode: "keep", upload: undefined }),
  );
  await readRevision(await act("publish", next));
  const replacement = GetReleasedTemplateResponse.parse(
    await (await call("/public/templates/manual-" + itemId)).json(),
  );
  assert.equal(replacement.id, next.id);
  assert.deepEqual(await checkoutFiles(other), []);
  assert.equal(replacement.offer, undefined);
  const replacedCard = await libraryCard();
  assert.equal(replacedCard?.id, next.id);
  assert.equal(replacedCard.amountKobo, undefined);
  assert.equal(replacedCard.priceId, undefined);
  assert.equal(replacedCard.freeDownloadPath, undefined);
  assert.deepEqual(await owned(other), [first.id]);
  assert.notEqual(replacedCard.id, first.id);
  assert.equal(await productVisible(), false);
  assert.equal((await download(first.id, reader)).status, 403);
  assert.equal((await download(next.id, reader)).status, 403);
  assert.equal((await download(first.id, other)).status, 403);
  assert.equal((await download(next.id, other)).status, 403);
  await readRevision(await act("withdraw", next));
  assert.equal(await libraryCard(), undefined);
  assert.equal((await call("/public/templates/manual-" + itemId)).status, 404);
}
