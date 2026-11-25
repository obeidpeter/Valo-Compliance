import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import {
  GetDocumentResponse,
  GetManualLibraryRevisionResponse,
  GetReleasedTemplateResponse,
  GetCustomerPurchasesResponse,
  ListOwnedTemplateEditionsResponse,
  ListPublicCatalogueResponse,
} from "@workspace/api-zod";
import { wordFromText } from "../modules/manual-library/files";
import { changeNote, libraryAction, templateDetails, withdrawalReason } from "./template-details";

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
    ...templateDetails,
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
    call(path + "/actions", libraryAction(action, revision), editor);
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
  // DOC-005 and EDT-001: the form of a premium template (here TPL-13, "Service agreement") starts only
  // in a workspace that holds a verified purchase of a live edition of that template, and cannot be
  // added to a plain document without one. An order saved but not paid is not a purchase.
  const { createDocument, saveDocument } = await import("../modules/documents");
  const { compileGuidedContent, emptyGuidedData } = await import("@workspace/valo-core/guided-runtime");
  const serviceForm = {
    title: "Service agreement",
    content: compileGuidedContent(emptyGuidedData("TPL-13")),
  };
  const startForm = (holder: typeof account) =>
    runInWorkspaceScope(holder.workspaceId, () => createDocument(holder, serviceForm));
  const refusedForm = { status: 403, message: /comes with a template you buy/ };
  await assert.rejects(startForm(account), refusedForm);
  const plain = await runInWorkspaceScope(account.workspaceId, () =>
    createDocument(account, {
      title: "Synthetic plain document",
      content: {
        fields: {
          issuerName: "",
          recipientName: "",
          documentNumber: "",
          issueDate: "",
          dueDate: "",
          notes: "",
        },
        blocks: [{ id: "section-1", type: "paragraph", text: "Synthetic text", rows: [] }],
        selectedClauses: [],
        formatting: { font: "sans", accent: "forest" },
      },
    }),
  );
  await assert.rejects(
    runInWorkspaceScope(account.workspaceId, () =>
      saveDocument(account, plain.id, { ...serviceForm, expectedRevision: plain.revision }),
    ),
    refusedForm,
  );
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
  // PAY-002 and PAY-006 through the API, with Paystack stood in for: the server creates the checkout
  // and returns Paystack's hosted page, keeps it for a retry, and grants the edition only once its own
  // check with Paystack says the payment succeeded. No request leaves this process.
  const hosted = "https://checkout.paystack.com/synthetic-" + order.id.slice(0, 8);
  const asked: { path: string; body: Record<string, unknown> | undefined }[] = [];
  await withStandInPaystack(
    (path, body) => {
      asked.push({ path, body });
      if (path === "/transaction/initialize")
        return { authorization_url: hosted, reference: order.reference };
      if (path === "/transaction/verify/" + encodeURIComponent(order.reference)) return verified;
      return undefined;
    },
    async () => {
      const checkout = () => call("/workspace/orders/" + order.id + "/checkout", {}, reader);
      const started = await checkout();
      assert.equal(started.status, 200);
      assert.deepEqual(await started.json(), { url: hosted });
      assert.equal(asked.length, 1);
      // Paystack is asked for this order's own reference and amount, for the customer's address on
      // record, returning to the purchases page. No card or payment detail passes through Valo.
      const sent = asked[0]!.body!;
      assert.deepEqual(
        { reference: sent.reference, amount: sent.amount, currency: sent.currency, email: sent.email },
        {
          reference: order.reference,
          amount: order.amountKobo,
          currency: "NGN",
          email: reader + "@example.invalid",
        },
      );
      assert.match(String(sent.callback_url), /\/workspace\/purchases$/);
      assert.doesNotMatch(JSON.stringify(sent), /card|cvv|pan\b|authorization_code|pin\b/i);
      // Starting it again, as from another tab, returns the same page without asking Paystack again.
      const again = await checkout();
      assert.equal(again.status, 200);
      assert.deepEqual(await again.json(), { url: hosted });
      assert.equal(asked.length, 1);
      const [stored] = await db.select().from(valoOrders).where(eq(valoOrders.id, order.id));
      assert.deepEqual(
        { status: stored!.status, checkoutUrl: stored!.checkoutUrl },
        { status: "pending", checkoutUrl: hosted },
      );
      // Coming back to Valo is not proof of payment: nothing is granted until the server checks.
      assert.deepEqual(await owned(reader), []);
      const refreshed = await call("/workspace/orders/" + order.id + "/refresh", {}, reader);
      assert.equal(refreshed.status, 200);
      assert.equal(((await refreshed.json()) as { status: string }).status, "verified_success");
      assert.deepEqual(
        asked.map((a) => a.path),
        ["/transaction/initialize", "/transaction/verify/" + encodeURIComponent(order.reference)],
      );
      assert.deepEqual(await owned(reader), [first.id]);
      const paidAgain = await checkout();
      assert.equal(paidAgain.status, 409);
      assert.equal(
        ((await paidAgain.json()) as { error: string }).error,
        "This purchase is already verified. Do not pay again.",
      );
    },
  );
  // The same verified answer arriving again, as from the event worker, changes nothing.
  await settleVerifiedOrder(order.id, verified);
  // Once the purchase is verified the form starts, and the plain document can take its questions; a
  // workspace that has not bought the template is still refused.
  const made = await startForm(account);
  await runInWorkspaceScope(account.workspaceId, () =>
    saveDocument(account, plain.id, { ...serviceForm, expectedRevision: plain.revision }),
  );
  const stranger = await resolveWorkspace("synthetic-premium-stranger-" + itemId);
  await assert.rejects(startForm(stranger), refusedForm);
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
  // A reversal ends new starts of the form; the document already made stays the customer's and saves.
  await assert.rejects(startForm(account), refusedForm);
  const kept = await runInWorkspaceScope(account.workspaceId, () =>
    saveDocument(account, made.id, { ...serviceForm, expectedRevision: made.revision }),
  );
  assert.equal(kept.revision, made.revision + 1);
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
  // Its page says what changed in the new edition (docs/architecture/guidance-currency.md, slice 3).
  assert.equal(replacement.change?.note, changeNote);
  // The purchase carries to the new edition at no further charge (docs/architecture/editions.md,
  // delegated decision 3): the buyer's purchases list the new edition's file under the edition bought,
  // and say what it carries to.
  const carriedFiles = await checkoutFiles(other);
  assert.ok(carriedFiles.length > 0);
  for (const carriedFile of carriedFiles) {
    assert.equal(carriedFile.edition, first.id);
    assert.equal(
      carriedFile.downloadPath,
      "/api/workspace/manual-premium-templates/" + next.id + "/download",
    );
    assert.deepEqual(carriedFile.carried, { boughtVersion: 1, version: 2 });
  }
  assert.equal(replacement.offer, undefined);
  const replacedCard = await libraryCard();
  assert.equal(replacedCard?.id, next.id);
  assert.equal(replacedCard.amountKobo, undefined);
  assert.equal(replacedCard.priceId, undefined);
  assert.equal(replacedCard.freeDownloadPath, undefined);
  // The template counts as the buyer's, in both editions.
  assert.deepEqual(await owned(other), [first.id, next.id].sort());
  // The buyer is told once that the edition bought was replaced, and what the purchase carries to
  // (docs/architecture/editions.md, slice 3). The reversed purchase holds nothing, and the reader made
  // no document from the edition, so the reader is told nothing.
  const { listEditionNotices } = await import("../modules/catalogue");
  const written = async (edition: string) =>
    (
      await db.execute(
        sql`select workspace_id, route, kind, title, version, replacement_version, reason, held, documents
              from valo_edition_notices where edition = ${edition} order by kind`,
      )
    ).rows;
  // A replacement's notice carries what changed (docs/architecture/guidance-currency.md, slice 3).
  const heldNotice = {
    workspace_id: secondBuyer.workspaceId,
    route: "library",
    kind: "replaced",
    title: "Service agreement",
    version: 1,
    replacement_version: 2,
    reason: changeNote,
    held: true,
    documents: 0,
  };
  assert.deepEqual(await written(first.id), [heldNotice]);
  const buyerNotices = await runInWorkspaceScope(secondBuyer.workspaceId, () =>
    listEditionNotices(secondBuyer),
  );
  assert.deepEqual(
    buyerNotices.items.map((n) => [n.title, n.version, n.kind, n.replacementVersion, n.held, n.documents]),
    [["Service agreement", 1, "replaced", 2, true, 0]],
  );
  assert.deepEqual(
    (await runInWorkspaceScope(account.workspaceId, () => listEditionNotices(account))).items,
    [],
  );
  assert.notEqual(replacedCard.id, first.id);
  assert.equal(await productVisible(), false);
  // The reversed purchase carries nothing, and the edition bought closes to new downloads; the new
  // edition downloads for the buyer.
  assert.equal((await download(first.id, reader)).status, 403);
  assert.equal((await download(next.id, reader)).status, 403);
  assert.equal((await download(first.id, other)).status, 403);
  const carriedDownload = await download(next.id, other);
  assert.equal(carriedDownload.status, 200);
  assert.equal(carriedDownload.headers.get("cache-control"), "private, no-store");
  await readRevision(await act("withdraw", next));
  // Withdrawn, the new edition closes too, and its buyer is told why.
  assert.equal((await download(next.id, other)).status, 403);
  assert.deepEqual(await written(next.id), [
    {
      ...heldNotice,
      kind: "withdrawn",
      version: 2,
      replacement_version: null,
      reason: withdrawalReason,
    },
  ]);
  assert.equal(await libraryCard(), undefined);
  assert.equal((await call("/public/templates/manual-" + itemId)).status, 404);
}

/**
 * Forms v2, slice 6 (DOC-005, DOC-007, EDT-010): a premium template's form starts only from an edition
 * the workspace bought that has released form text, under the workspace's own verified order, which
 * the document records and keeps. A workspace that holds a live edition without form text starts the
 * questions-only form, and one that holds none is told to buy the template first. A reversal closes
 * new starts; the document already made stays its owner's, saves and reads its wording.
 */
export async function exercisePremiumFormDocument(call: Call, editor: string) {
  const { db, valoDocuments, valoPrices, runInWorkspaceScope } = await import("@workspace/db");
  const { resolveWorkspace } = await import("../modules/workspaces");
  const { createOrder, settleVerifiedOrder } = await import("../modules/commerce");
  const { getDocumentForm, listFormTemplates, saveDocument, startFormDocument } =
    await import("../modules/documents");
  const { proposedFormText } = await import("../modules/manual-library/form-text-maps");
  const { parseFormText } = await import("@workspace/valo-core/form-text");
  const { formDocumentContent } = await import("@workspace/valo-core/guided-runtime-v2");
  const { GUIDED_SPECS_V2 } = await import("@workspace/valo-core/guided-specs-v2");
  const { sha256 } = await import("@workspace/valo-core");
  const formText = (await proposedFormText("TPL-17"))!;
  const run = randomUUID();
  // Two released premium editions of the offer letter: the first without form text, the second with
  // the proposed form text, which the staff library previews against the v2 form.
  const { bytes } = wordFromText("Synthetic offer letter", "Only the purchaser may read this sentence.");
  const release = async (withForm: boolean) => {
    const itemId = randomUUID();
    const path = "/admin/manual-library/" + itemId;
    const response = await call(
      path + "/drafts",
      {
        kind: "premium_template",
        title: "Offer letter",
        body: "Public description of the synthetic offer letter.",
        industry: null,
        requestId: randomUUID(),
        baseVersion: 0,
        fileMode: "upload",
        upload: { format: "docx", base64: bytes.toString("base64") },
        ...(withForm ? { formText } : {}),
        ...templateDetails,
      },
      editor,
    );
    assert.equal(response.status, 200);
    const draft = GetManualLibraryRevisionResponse.parse(await response.json());
    assert.deepEqual(draft.formFit, withForm ? { templateId: "TPL-17", state: "fits", problems: [] } : null);
    const published = await call(
      path + "/actions",
      { action: "publish", version: draft.version, digest: draft.digest },
      editor,
    );
    assert.equal(published.status, 200);
    return { path, revision: draft };
  };
  const plain = await release(false),
    formed = await release(true);
  const buyer = await resolveWorkspace("synthetic-premium-form-buyer-" + run),
    stranger = await resolveWorkspace("synthetic-premium-form-stranger-" + run);
  const inScope = <T>(holder: typeof buyer, work: () => Promise<T>) =>
    runInWorkspaceScope(holder.workspaceId, work);
  const start = (holder: typeof buyer, body: unknown = { templateId: "TPL-17" }) =>
    inScope(holder, () => startFormDocument(holder, body));
  const startable = async (holder: typeof buyer) =>
    (await inScope(holder, () => listFormTemplates(holder))).templates.filter(
      (t) => t.templateId === "TPL-17",
    );
  // Whether the starter is told the offer letter needs a purchase before either of its forms starts.
  const needsPurchase = async (holder: typeof buyer) =>
    (await inScope(holder, () => listFormTemplates(holder))).needsPurchase.includes("TPL-17");
  const buyFirst = { status: 403, message: /comes with a template you buy/ };
  const questionsOnly = { status: 409, message: /Start its questions-only form instead/ };
  // Without a purchase, the form is not offered and does not start.
  await assert.rejects(start(buyer), buyFirst);
  assert.deepEqual(await startable(buyer), []);
  assert.equal(await needsPurchase(buyer), true);
  const buy = async (edition: { id: string }) => {
    const priceId = randomUUID();
    await db.insert(valoPrices).values({
      id: priceId,
      contentVersionId: edition.id,
      title: "Synthetic premium form fixture",
      amountKobo: 10000,
      licenceVersion: "fixture-1",
      licenceText: "Test use only",
      taxTreatment: "Synthetic",
      approvalReference: "LOCAL_TEST_ONLY",
      effectiveFrom: new Date(Date.now() - 1000),
    });
    const order = await inScope(buyer, () =>
      createOrder(buyer, { priceId, acceptedLicenceVersion: "fixture-1", requestKey: randomUUID() }),
    );
    const verified = {
      id: String(Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16)),
      domain: "test" as const,
      status: "success" as const,
      reference: order.reference,
      amount: order.amountKobo,
      currency: "NGN" as const,
      metadata: { valoOrderId: order.id, workspaceId: buyer.workspaceId },
    };
    await settleVerifiedOrder(order.id, verified);
    return { order, verified };
  };
  // A bought edition without form text starts the questions-only form.
  const first = await buy(plain.revision);
  await assert.rejects(start(buyer), questionsOnly);
  assert.deepEqual(await startable(buyer), []);
  assert.equal(await needsPurchase(buyer), false);
  // Once the edition with form text is bought, its form is offered and starts from it, under that
  // edition's order, which the document records; another workspace is still refused.
  const second = await buy(formed.revision);
  assert.deepEqual(await startable(buyer), [{ templateId: "TPL-17", editionVersion: 1 }]);
  assert.equal(await needsPurchase(buyer), false);
  assert.deepEqual(await startable(stranger), []);
  assert.equal(await needsPurchase(stranger), true);
  await assert.rejects(start(stranger), buyFirst);
  const made = GetDocumentResponse.parse(await start(buyer));
  assert.deepEqual(made.form, { version: 2, edition: formed.revision.id, digest: sha256(formText) });
  assert.equal(made.title, "Offer letter");
  const recorded = async () =>
    (
      await db
        .select({ formOrder: valoDocuments.formOrder })
        .from(valoDocuments)
        .where(eq(valoDocuments.id, made.id))
    )[0]?.formOrder;
  assert.equal(await recorded(), second.order.id);
  assert.equal((await inScope(buyer, () => getDocumentForm(buyer, made.id))).formText, formText);
  await assert.rejects(
    inScope(stranger, () => getDocumentForm(stranger, made.id)),
    { status: 404 },
  );
  // Its answers fill the letter's wording, and a save keeps exactly what they make.
  const spec = GUIDED_SPECS_V2["TPL-17"]!,
    text = parseFormText(formText);
  const answers = structuredClone(made.content.formAnswers!) as Parameters<typeof formDocumentContent>[2];
  answers.values = {
    ...answers.values,
    issuerName: "Synthetic Employer Ltd",
    recipientName: "Synthetic Candidate",
    role: "Synthetic accounts officer",
  };
  const contentFor = (data: typeof answers) => {
    const { unfilled: _unfilled, ...content } = formDocumentContent(spec, text, data, made.content);
    return content;
  };
  const saved = GetDocumentResponse.parse(
    await inScope(buyer, () =>
      saveDocument(buyer, made.id, {
        expectedRevision: 1,
        title: "Offer letter",
        content: contentFor(answers),
      }),
    ),
  );
  assert.equal(saved.revision, 2);
  assert.ok(
    saved.content.blocks.some((block) => block.text === "Dear Synthetic Candidate,"),
    "the answers fill the letter's own words",
  );
  // A new edition of the offer letter with its wording carries the purchase at no further charge
  // (docs/architecture/editions.md, slice 2): the form starts from the new edition, under the order
  // for the first, and the document already made keeps its edition and its wording.
  const nextResponse = await call(
    formed.path + "/drafts",
    {
      kind: "premium_template",
      title: "Offer letter",
      body: "Public description of the synthetic offer letter.",
      industry: null,
      requestId: randomUUID(),
      baseVersion: 1,
      fileMode: "keep",
      formText,
      ...templateDetails,
    },
    editor,
  );
  assert.equal(nextResponse.status, 200);
  const nextEdition = GetManualLibraryRevisionResponse.parse(await nextResponse.json());
  const nextPublished = await call(formed.path + "/actions", libraryAction("publish", nextEdition), editor);
  assert.equal(nextPublished.status, 200);
  // The cleanup below withdraws the item's released edition, which is now the second.
  formed.revision = nextEdition;
  assert.deepEqual(await startable(buyer), [{ templateId: "TPL-17", editionVersion: 2 }]);
  const carriedForm = GetDocumentResponse.parse(await start(buyer));
  assert.deepEqual(carriedForm.form, { version: 2, edition: nextEdition.id, digest: sha256(formText) });
  assert.equal(
    (
      await db
        .select({ formOrder: valoDocuments.formOrder })
        .from(valoDocuments)
        .where(eq(valoDocuments.id, carriedForm.id))
    )[0]?.formOrder,
    second.order.id,
  );
  assert.deepEqual(made.form?.edition, (await inScope(buyer, () => getDocumentForm(buyer, made.id))).edition);
  assert.deepEqual(await startable(stranger), []);
  // Reversed, the edition with form text starts no new form: the live edition still held without
  // one starts the questions-only form, and with no purchase left the business is told to buy first.
  await settleVerifiedOrder(second.order.id, { ...second.verified, status: "reversed" });
  await assert.rejects(start(buyer), questionsOnly);
  assert.deepEqual(await startable(buyer), []);
  await settleVerifiedOrder(first.order.id, { ...first.verified, status: "reversed" });
  await assert.rejects(start(buyer), buyFirst);
  assert.equal(await needsPurchase(buyer), true);
  // A document made like this one is a new start, refused the same way.
  await assert.rejects(
    start(buyer, { templateId: "TPL-17", formAnswers: saved.content.formAnswers }),
    buyFirst,
  );
  // The document made stays its owner's: it saves, reads its wording and keeps its order.
  const kept = await inScope(buyer, () =>
    saveDocument(buyer, made.id, {
      expectedRevision: 2,
      title: "Offer letter",
      content: contentFor({ ...answers, values: { ...answers.values, role: "Synthetic finance officer" } }),
    }),
  );
  assert.equal(kept.revision, 3);
  assert.deepEqual(kept.form, made.form);
  assert.equal((await inScope(buyer, () => getDocumentForm(buyer, made.id))).formText, formText);
  assert.equal(await recorded(), second.order.id);
  // Both editions are withdrawn again, so that no later check finds them.
  for (const { path, revision } of [plain, formed]) {
    const withdrawn = await call(path + "/actions", libraryAction("withdraw", revision), editor);
    assert.equal(withdrawn.status, 200);
  }
}

/** A Paystack test merchant for the length of `run`, with Paystack itself stood in for: `answer`
 * gives the data for a path, or nothing for a failed request. Only requests to Paystack's API are
 * answered here; the settings and `fetch` are put back afterwards. */
async function withStandInPaystack(
  answer: (path: string, body: Record<string, unknown> | undefined) => unknown,
  run: () => Promise<void>,
) {
  assert.equal(Boolean(process.env.PAYSTACK_SECRET_KEY), false);
  assert.equal(process.env.VALO_SANDBOX_CHECKOUT_ENABLED, undefined);
  const { PAYSTACK_API } = await import("../modules/commerce");
  const realFetch = globalThis.fetch;
  process.env.VALO_SANDBOX_CHECKOUT_ENABLED = "true";
  process.env.PAYSTACK_SECRET_KEY = "sk_test_synthetic_fixture_not_a_key";
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== PAYSTACK_API) return realFetch(input, init);
    const body =
      typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
    const data = answer(url.pathname, body);
    return data === undefined ? new Response("{}", { status: 502 }) : Response.json({ status: true, data });
  }) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.VALO_SANDBOX_CHECKOUT_ENABLED;
    delete process.env.PAYSTACK_SECRET_KEY;
  }
}
