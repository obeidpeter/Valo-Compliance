import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  GetCustomerPurchasesResponse,
  GetManualLibraryRevisionResponse,
  ListEditionNoticesResponse,
} from "@workspace/api-zod";
import { wordFromText } from "../modules/manual-library/files";
import { libraryAction, templateDetails } from "./template-details";

type Call = (
  path: string,
  body?: unknown,
  actor?: string,
  headers?: Record<string, string>,
) => Promise<Response>;

/**
 * The access rule each order records (docs/architecture/commercial-settings.md, slice 3b; ADM-006): a
 * purchase made while the owner's rule says yes carries to its template's next edition; one made while it
 * says no reaches only the edition bought, and keeps that rule after the owner says yes again. The buyer
 * sees the rule before buying and on the order, accepts it with the licence, and is told at the next
 * edition's release what the purchase now gives. The rule ends as its default, yes, whatever happens, so
 * the database's later tests read today's rule.
 */
export async function exerciseOrderAccessRule(call: Call, editor: string) {
  const { db, runInWorkspaceScope, valoOrders, valoPrices } = await import("@workspace/db");
  const { resolveWorkspace } = await import("../modules/workspaces");
  const { createOrder, settleVerifiedOrder } = await import("../modules/commerce");
  const {
    commercialSettingChoice,
    commercialSettingTerms,
    commercialSettingTermsId,
    recordCommercialSettingIn,
  } = await import("../modules/commercial-settings");
  const run = randomUUID();
  const path = "/admin/manual-library/" + randomUUID();
  const { bytes } = wordFromText("Synthetic rule edition", "Only a buyer may read this sentence.");
  const release = async (baseVersion: number) => {
    const response = await call(
      path + "/drafts",
      {
        kind: "premium_template",
        title: "Synthetic rule agreement " + run,
        body: "Public description of the synthetic rule agreement.",
        industry: null,
        requestId: randomUUID(),
        baseVersion,
        ...(baseVersion === 0
          ? { fileMode: "upload", upload: { format: "docx", base64: bytes.toString("base64") } }
          : { fileMode: "keep" }),
        ...templateDetails,
      },
      editor,
    );
    assert.equal(response.status, 200);
    const revision = GetManualLibraryRevisionResponse.parse(await response.json());
    assert.equal((await call(path + "/actions", libraryAction("publish", revision), editor)).status, 200);
    return revision;
  };
  // The owner's rule, recorded as the owner's screen records it; the screen's own checks are tested with it.
  const rule = async (value: "yes" | "no", reference: string) => {
    const terms = commercialSettingTerms({ key: "purchase_carries_to_later_editions", value, from: "now" });
    await db.transaction((tx) =>
      recordCommercialSettingIn(tx, terms, {
        approvedBy: "a synthetic owner",
        reference,
        confirm: commercialSettingTermsId(terms),
      }),
    );
  };
  const priced = async (edition: string) => {
    const priceId = randomUUID();
    await db.insert(valoPrices).values({
      id: priceId,
      contentVersionId: edition,
      title: "Synthetic rule fixture",
      amountKobo: 10000,
      licenceVersion: "fixture-1",
      licenceText: "Test use only",
      taxTreatment: "Synthetic",
      approvalReference: "LOCAL_TEST_ONLY",
      effectiveFrom: new Date(Date.now() - 1000),
    });
    return priceId;
  };
  const order = (buyer: Awaited<ReturnType<typeof resolveWorkspace>>, priceId: string, accepted: boolean) =>
    runInWorkspaceScope(buyer.workspaceId, () =>
      createOrder(buyer, {
        priceId,
        acceptedLicenceVersion: "fixture-1",
        acceptedCarriesToLaterEditions: accepted,
        requestKey: randomUUID(),
      }),
    );
  const buy = async (name: string, priceId: string, accepted: boolean) => {
    const buyer = await resolveWorkspace(`synthetic-rule-${name}-${run}`);
    const made = await order(buyer, priceId, accepted);
    // The order shows the rule it recorded before it is paid.
    assert.equal(made.carriesToLaterEditions, accepted);
    await settleVerifiedOrder(made.id, {
      id: String(Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16)),
      domain: "test" as const,
      status: "success" as const,
      reference: made.reference,
      amount: made.amountKobo,
      currency: "NGN" as const,
      metadata: { valoOrderId: made.id, workspaceId: buyer.workspaceId },
    });
    return { buyer, identity: buyer.identityId, order: made.id };
  };
  const recorded = async (id: string) =>
    (
      await db
        .select({ rule: valoOrders.carriesToLaterEditions })
        .from(valoOrders)
        .where(eq(valoOrders.id, id))
    )[0]?.rule;
  const download = async (edition: string, identity: string) =>
    (await call("/workspace/manual-premium-templates/" + edition + "/download", undefined, identity)).status;
  const purchases = async (identity: string) => {
    const response = await call("/workspace/purchases", undefined, identity);
    const body = await response.text();
    assert.equal(response.status, 200, body);
    return GetCustomerPurchasesResponse.parse(JSON.parse(body));
  };
  // The notices, read through the service the notices route calls, in the buyer's own scope, as the
  // staff library's notice test reads them; this test's app has no identity for that route.
  const notice = async (buyer: Awaited<ReturnType<typeof resolveWorkspace>>) => {
    const { listEditionNotices } = await import("../modules/catalogue");
    const { items } = ListEditionNoticesResponse.parse(
      await runInWorkspaceScope(buyer.workspaceId, () => listEditionNotices(buyer)),
    );
    return items.find((item) => item.title === "Synthetic rule agreement " + run);
  };

  try {
    const first = await release(0);
    const firstPrice = await priced(first.id);
    // While the rule is its default, yes, the listing says so and a purchase records that it carries.
    const early = await buy("early", firstPrice, true);
    assert.equal(await recorded(early.order), true);
    assert.equal((await purchases(early.identity)).purchaseCarriesToLaterEditions, true);

    // Once the owner's rule says no, the listing says so, a buyer who accepted the earlier rule is
    // refused, and a new purchase records that it does not carry.
    await rule("no", "synthetic-rule-approval-no");
    const lateBuyer = await resolveWorkspace(`synthetic-rule-late-${run}`);
    const listed = await purchases(lateBuyer.identityId);
    assert.equal(listed.purchaseCarriesToLaterEditions, false);
    await assert.rejects(order(lateBuyer, firstPrice, true), {
      status: 409,
      message: /What a purchase includes has changed/,
    });
    const late = await buy("late", firstPrice, false);
    assert.equal(await recorded(late.order), false);
    // Each order shows the rule it recorded.
    assert.deepEqual(
      (await purchases(late.identity)).orders.map((row) => row.carriesToLaterEditions),
      [false],
    );
    assert.deepEqual(
      (await purchases(early.identity)).orders.map((row) => row.carriesToLaterEditions),
      [true],
    );
    assert.equal(await download(first.id, early.identity), 200);
    assert.equal(await download(first.id, late.identity), 200);

    // At the next edition's release, only the purchase that carries reaches it, and each buyer's notice
    // says what its purchase now gives.
    const second = await release(1);
    assert.equal(await download(second.id, early.identity), 200);
    assert.equal(await download(second.id, late.identity), 403);
    assert.equal(await download(first.id, late.identity), 403, "a replaced edition is no longer released");
    assert.deepEqual(
      [await notice(early.buyer), await notice(late.buyer)].map((item) => [
        item?.kind,
        item?.held,
        item?.carries,
      ]),
      [
        ["replaced", true, true],
        ["replaced", true, false],
      ],
    );
    const carriedDownload = (await purchases(early.identity)).ownedDownloads.find(
      (row) => row.edition === first.id,
    );
    assert.equal(carriedDownload?.carried?.version, 2);
    assert.equal(
      (await purchases(late.identity)).ownedDownloads.find((row) => row.edition === first.id),
      undefined,
    );

    // ADM-006: after the owner's rule says yes again, the later order keeps the rule it was bought under;
    // a purchase made now records the rule in effect now.
    await rule("yes", "synthetic-rule-approval-yes");
    assert.equal(await recorded(late.order), false);
    assert.equal(await download(second.id, late.identity), 403);
    const after = await buy("after", await priced(second.id), true);
    assert.equal(await recorded(after.order), true);
    assert.equal(await download(second.id, after.identity), 200);
    // Nothing changes the rule an order recorded: the database refuses it, and the query reports why.
    await assert.rejects(
      db.update(valoOrders).set({ carriesToLaterEditions: true }).where(eq(valoOrders.id, late.order)),
      (error: Error) =>
        /keeps the access rule it was bought under/.test(
          String((error as { cause?: Error }).cause?.message ?? error.message),
        ),
    );
  } finally {
    // The rule ends as its default whatever failed above, so later tests are not refused at checkout.
    if (!(await db.transaction((tx) => commercialSettingChoice(tx, "purchase_carries_to_later_editions"))))
      await rule("yes", "synthetic-rule-approval-restore");
  }
}
