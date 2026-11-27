import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  GetCustomerPurchasesResponse,
  GetManualLibraryRevisionResponse,
  ListManualLibraryResponse,
  ListPublicCatalogueResponse,
  ListSavedTemplatesResponse,
} from "@workspace/api-zod";
import { wordFromText } from "../modules/manual-library/files";
import { libraryAction, templateDetails } from "./template-details";

type Call = (path: string, body?: unknown, actor?: string) => Promise<Response>;

/**
 * Holding, withdrawing and reporting staff-library entries, slice 2 (ADM-007, EDP-011): a Content editor
 * holds the published version of an entry short of a withdrawal. Held, it leaves new use as an overdue one
 * does (its page, the public lists, a free download, saving, copying, the offers, new orders and the
 * price command), while what customers have stays: a document already made from it, and a buyer's file
 * and purchases. Every other entry stays available, and the staff list shows held entries first. Lifted,
 * it comes back.
 */
export async function exerciseLibraryHolds(call: Call, editor: string) {
  const { db, valoDocuments, valoOrders, valoPrices, runInWorkspaceScope } = await import("@workspace/db");
  const { resolveWorkspace } = await import("../modules/workspaces");
  const { createReleasedTemplateDraft, savedTemplateList, saveTemplate } =
    await import("../modules/catalogue");
  const {
    commerceProducts,
    createOrder,
    premiumPriceTerms,
    premiumPriceTermsId,
    recordPremiumPrice,
    settleVerifiedOrder,
  } = await import("../modules/commerce");
  const path = (itemId: string) => "/admin/manual-library/" + itemId;
  const revision = async (response: Response) => {
    const body: unknown = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    return GetManualLibraryRevisionResponse.parse(body);
  };
  const release = async (itemId: string, kind: "template" | "premium_template", title: string) => {
    const file =
      kind === "premium_template"
        ? {
            fileMode: "upload",
            upload: {
              format: "docx",
              base64: wordFromText(title, "Only its buyers may read this sentence.").bytes.toString("base64"),
            },
          }
        : { fileMode: "text" };
    const saved = await revision(
      await call(
        path(itemId) + "/drafts",
        {
          kind,
          title,
          industry: null,
          body: "Synthetic text of " + title + ".",
          requestId: randomUUID(),
          baseVersion: 0,
          ...file,
          ...templateDetails,
        },
        editor,
      ),
    );
    return revision(await call(path(itemId) + "/actions", libraryAction("publish", saved), editor));
  };
  const holding = (
    itemId: string,
    action: "hold" | "lift",
    edition: { version: number; digest: string },
    reason: string,
    actor = editor,
  ) =>
    call(
      path(itemId) + "/holds",
      { action, version: edition.version, digest: edition.digest, reason },
      actor,
    );
  const heldWhy = "Synthetic: held while its payment clause is checked against the Act.";
  const liftWhy = "Synthetic: the payment clause was checked and needs no change.";

  const freeItem = randomUUID(),
    otherItem = randomUUID(),
    premiumItem = randomUUID();
  const freeTitle = "Synthetic held register",
    premiumTitle = "Synthetic held agreement";
  const free = await release(freeItem, "template", freeTitle);
  await release(otherItem, "template", "Synthetic register nobody held");
  const premium = await release(premiumItem, "premium_template", premiumTitle);
  assert.equal(free.hold, null);

  // A workspace copies the free template and saves it before the hold.
  const user = await resolveWorkspace("synthetic-hold-user-" + freeItem);
  const asUser = <T>(work: () => Promise<T>) => runInWorkspaceScope(user.workspaceId, work);
  const copy = (await asUser(() => createReleasedTemplateDraft(user, free.id))) as { id: string };
  await asUser(() => saveTemplate(user, free.id));
  const saved = async () =>
    ListSavedTemplatesResponse.parse(await asUser(() => savedTemplateList(user))).items.find(
      (item) => item.templateId === "manual-" + freeItem,
    )?.available;
  const copies = () => asUser(() => createReleasedTemplateDraft(user, free.id));
  const page = async (itemId: string) => (await call("/public/templates/manual-" + itemId)).status;
  const listed = async (title: string, itemId: string) =>
    ListPublicCatalogueResponse.parse(
      await (await call("/public/catalogue?type=template&q=" + encodeURIComponent(title))).json(),
    ).items.some((entry) => entry.slug === "manual-" + itemId);
  const download = async () =>
    (await call("/account/manual-templates/" + free.id + "/download", undefined, "synthetic-reader")).status;

  // Another workspace buys the premium template, under a verified order.
  const priceId = randomUUID();
  const price = {
    id: priceId,
    contentVersionId: premium.id,
    title: "Synthetic held fixture",
    amountKobo: 10000,
    licenceVersion: "fixture-1",
    licenceText: "Test use only",
    taxTreatment: "Synthetic",
    approvalReference: "LOCAL_TEST_ONLY",
    effectiveFrom: new Date(Date.now() - 1000),
  };
  await db.insert(valoPrices).values(price);
  const buyer = await resolveWorkspace("synthetic-hold-buyer-" + premiumItem),
    shopper = await resolveWorkspace("synthetic-hold-shopper-" + premiumItem);
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
      contentVersionId: premium.id,
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
  const offered = () =>
    runInWorkspaceScope(shopper.workspaceId, async () =>
      (await commerceProducts()).some((product) => product.id === priceId),
    );
  const order = () =>
    runInWorkspaceScope(shopper.workspaceId, () =>
      createOrder(shopper, {
        priceId,
        acceptedLicenceVersion: "fixture-1",
        acceptedCarriesToLaterEditions: true,
        requestKey: randomUUID(),
      }),
    );
  const priced = () => {
    const terms = premiumPriceTerms({
      edition: premium.id,
      amount: "2500.00",
      licenceVersion: "synthetic-held-1",
      licenceText: "Synthetic licence for one business's own use only.",
      taxTreatment: "Synthetic tax treatment",
      from: "now",
    });
    return recordPremiumPrice(terms, {
      approvedBy: "Synthetic owner",
      reference: "synthetic-held-approval",
      confirm: premiumPriceTermsId(terms),
    });
  };
  const bought = async () => {
    const file = await call(
      "/workspace/manual-premium-templates/" + premium.id + "/download",
      undefined,
      buyer.identityId,
    );
    const purchases = GetCustomerPurchasesResponse.parse(
      await (await call("/workspace/purchases", undefined, buyer.identityId)).json(),
    ).ownedDownloads;
    return { file: file.status, listed: purchases.some((entry) => entry.edition === premium.id) };
  };

  // Before any hold, everything is in use.
  assert.deepEqual(
    [
      await page(freeItem),
      await listed(freeTitle, freeItem),
      await download(),
      await saved(),
      await offered(),
    ],
    [200, true, 200, true, true],
  );

  // A hold needs its reason, the exact published version and the Content role; nothing is lifted that is
  // not held.
  assert.equal((await holding(freeItem, "hold", free, "Too short.")).status, 422);
  assert.equal(
    (await holding(freeItem, "hold", { version: free.version, digest: "0".repeat(64) }, heldWhy)).status,
    409,
  );
  assert.equal((await holding(freeItem, "hold", free, heldWhy, "synthetic-customer")).status, 403);
  assert.equal((await holding(freeItem, "lift", free, liftWhy)).status, 409);
  // Held, with why and the workspaces it touched: the copier of the free template, the premium's buyer.
  const held = await revision(await holding(freeItem, "hold", free, heldWhy));
  assert.equal(held.hold?.reason, heldWhy);
  assert.equal(held.hold?.workspaces, 1);
  assert.equal(held.hold?.placedBy, editor);
  assert.equal((await holding(freeItem, "hold", free, heldWhy)).status, 409);
  assert.equal((await revision(await holding(premiumItem, "hold", premium, heldWhy))).hold?.workspaces, 1);
  // The staff list says which are held, and lists them first.
  const items = ListManualLibraryResponse.parse(
    await (await call("/admin/manual-library", undefined, editor)).json(),
  ).items;
  assert.equal(items.find((item) => item.itemId === freeItem)?.held, true);
  assert.equal(items.find((item) => item.itemId === otherItem)?.held, false);
  const firstUnheld = items.findIndex((item) => !item.held);
  assert.ok(items.every((item, at) => !item.held || firstUnheld === -1 || at < firstUnheld));

  // Held, the free template leaves new use: its page, the lists, a new download, saving and copying.
  assert.deepEqual(
    [await page(freeItem), await listed(freeTitle, freeItem), await download(), await saved()],
    [404, false, 404, false],
  );
  await assert.rejects(copies(), (error: unknown) => (error as { status?: number }).status === 404);
  // The premium one is neither shown, offered, ordered nor priced.
  assert.deepEqual(
    [await page(premiumItem), await listed(premiumTitle, premiumItem), await offered()],
    [404, false, false],
  );
  await assert.rejects(order(), { status: 409 });
  await assert.rejects(priced(), /not held by staff/);
  // What customers have stays: the document made from the free one keeps its edition, and the buyer
  // downloads the premium file and finds it among their purchases.
  const [document] = await db
    .select({ edition: valoDocuments.libraryEdition })
    .from(valoDocuments)
    .where(eq(valoDocuments.id, copy.id));
  assert.equal(document?.edition, free.id);
  assert.deepEqual(await bought(), { file: 200, listed: true });
  // Every other entry stays available.
  assert.equal(await page(otherItem), 200);

  // Lifted, with why, each comes back.
  assert.equal((await holding(freeItem, "lift", free, "Too short.")).status, 422);
  assert.equal((await holding(freeItem, "lift", free, liftWhy, "synthetic-customer")).status, 403);
  const lifted = await revision(await holding(freeItem, "lift", free, liftWhy));
  assert.equal(lifted.hold, null);
  await revision(await holding(premiumItem, "lift", premium, liftWhy));
  assert.deepEqual(
    [
      await page(freeItem),
      await listed(freeTitle, freeItem),
      await download(),
      await saved(),
      await offered(),
    ],
    [200, true, 200, true, true],
  );
  assert.ok((await copies()) as { id: string });
  assert.equal((await order()).amountKobo, price.amountKobo);
  assert.equal(
    ListManualLibraryResponse.parse(
      await (await call("/admin/manual-library", undefined, editor)).json(),
    ).items.find((item) => item.itemId === freeItem)?.held,
    false,
  );
}
