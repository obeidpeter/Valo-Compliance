import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import {
  CreateCommerceOrderResponse,
  GetCustomerPurchasesResponse,
  GetManualLibraryRevisionResponse,
} from "@workspace/api-zod";
import { wordFromText } from "../modules/manual-library/files";
import { withStandInPaystack } from "./manual-premium-template";
import { libraryAction, templateDetails } from "./template-details";

type Call = (
  path: string,
  body?: unknown,
  actor?: string,
  headers?: Record<string, string>,
) => Promise<Response>;

const UNASKED =
  "Paystack could not be asked about your earlier order just now, so nothing new was started. Try again in a few minutes.";
const ON_RECORD =
  "A payment for this edition is already on record. Check your purchases before paying again.";

/**
 * PAY-006 (docs/architecture/order-safety.md, slice 4): before another order for an edition, or a payment
 * for one, the provider is asked again about each earlier order of the workspace for it that ended
 * abandoned or failed. One paid since is settled, and nothing more is made or started. Through the API,
 * with Paystack stood in for: no request leaves this process.
 */
export async function exerciseSecondLook(call: Call, editor: string) {
  const { db, valoEntitlements, valoOrders, valoPrices } = await import("@workspace/db");
  const { resolveWorkspace } = await import("../modules/workspaces");
  const run = randomUUID();

  // A released premium template with a price, as the other purchase tests make one.
  const offer = async (name: string) => {
    const item = "/admin/manual-library/" + randomUUID();
    const { bytes } = wordFromText(`Synthetic ${name} edition`, "Only a buyer may read this sentence.");
    const drafted = await call(
      item + "/drafts",
      {
        kind: "premium_template",
        title: `Synthetic second look ${name} ${run}`,
        body: `Public description of the synthetic ${name}.`,
        industry: null,
        requestId: randomUUID(),
        baseVersion: 0,
        fileMode: "upload",
        upload: { format: "docx", base64: bytes.toString("base64") },
        ...templateDetails,
      },
      editor,
    );
    assert.equal(drafted.status, 200);
    const edition = GetManualLibraryRevisionResponse.parse(await drafted.json());
    assert.equal((await call(item + "/actions", libraryAction("publish", edition), editor)).status, 200);
    const priceId = randomUUID();
    await db.insert(valoPrices).values({
      id: priceId,
      contentVersionId: edition.id,
      title: `Synthetic second look ${name} fixture`,
      amountKobo: 10000,
      licenceVersion: "fixture-1",
      licenceText: "Test use only",
      taxTreatment: "Synthetic",
      approvalReference: "LOCAL_TEST_ONLY",
      effectiveFrom: new Date(Date.now() - 1000),
    });
    return { edition: edition.id, priceId };
  };
  const agreement = await offer("agreement"),
    policy = await offer("policy");

  type Order = { id: string; reference: string; amountKobo: number };
  type Buyer = Awaited<ReturnType<typeof resolveWorkspace>>;
  const buyer = (name: string) => resolveWorkspace(`synthetic-second-look-${name}-${run}`);

  // Paystack, stood in for. It says of each order what the test last told it to, under one transaction
  // number for each reference, and cannot be asked about an order the test has marked so.
  type Said = "abandoned" | "failed" | "success";
  const said = new Map<string, { status: Said; order: Order; by: Buyer } | "down">();
  const numbers = new Map<string, string>();
  const asked: string[] = [];
  const says = (order: Order, by: Buyer, status: Said | "down") => {
    said.set(order.reference, status === "down" ? "down" : { status, order, by });
    asked.length = 0;
  };
  const verifies = (order: Order) => "/transaction/verify/" + encodeURIComponent(order.reference);
  const answer = (path: string, body: Record<string, unknown> | undefined) => {
    asked.push(path);
    if (path === "/transaction/initialize") {
      const reference = String(body?.reference);
      return {
        authorization_url: "https://checkout.paystack.com/synthetic-" + reference.slice(-8),
        reference,
      };
    }
    const reference = decodeURIComponent(path.split("/transaction/verify/")[1] ?? "");
    const known = said.get(reference);
    if (!known || known === "down") return undefined;
    if (!numbers.has(reference))
      numbers.set(reference, String(Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16)));
    return {
      id: numbers.get(reference),
      domain: "test",
      status: known.status,
      reference,
      amount: known.order.amountKobo,
      currency: "NGN",
      metadata: { valoOrderId: known.order.id, workspaceId: known.by.workspaceId },
    };
  };

  // What the customer's own requests do, through the API.
  const purchases = async (who: Buyer) => {
    const response = await call("/workspace/purchases", undefined, who.identityId);
    assert.equal(response.status, 200);
    return GetCustomerPurchasesResponse.parse(await response.json());
  };
  const ask = async (who: Buyer, of = agreement, requestKey: string = randomUUID()) =>
    call(
      "/workspace/orders",
      {
        priceId: of.priceId,
        acceptedLicenceVersion: "fixture-1",
        acceptedCarriesToLaterEditions: (await purchases(who)).purchaseCarriesToLaterEditions,
        requestKey,
      },
      who.identityId,
    );
  const order = async (who: Buyer, of = agreement, requestKey?: string) => {
    const response = await ask(who, of, requestKey);
    const body = await response.text();
    assert.equal(response.status, 201, body);
    return CreateCommerceOrderResponse.parse(JSON.parse(body));
  };
  const checkout = (made: Order, who: Buyer) =>
    call("/workspace/orders/" + made.id + "/checkout", {}, who.identityId);
  const refreshed = async (made: Order, who: Buyer) => {
    const response = await call("/workspace/orders/" + made.id + "/refresh", {}, who.identityId);
    assert.equal(response.status, 200);
    return ((await response.json()) as { status: string }).status;
  };
  const refusal = async (response: Response) => [
    response.status,
    ((await response.json()) as { error: string }).error,
  ];
  /** An order whose payment page the customer left: the provider said abandoned, or failed. */
  const ended = async (who: Buyer, how: "abandoned" | "failed" = "abandoned", of = agreement) => {
    const made = await order(who, of);
    says(made, who, how);
    assert.equal((await checkout(made, who)).status, 200);
    assert.equal(await refreshed(made, who), how);
    return made;
  };
  const stored = async (who: Buyer) =>
    (
      await db
        .select({ id: valoOrders.id, status: valoOrders.status, page: valoOrders.checkoutUrl })
        .from(valoOrders)
        .where(eq(valoOrders.workspaceId, who.workspaceId))
        .orderBy(asc(valoOrders.createdAt), asc(valoOrders.id))
    ).map((row) => [row.id, row.status, row.page !== null]);
  const granted = async (who: Buyer) =>
    (
      await db
        .select({ order: valoEntitlements.orderId, edition: valoEntitlements.contentVersionId })
        .from(valoEntitlements)
        .where(eq(valoEntitlements.workspaceId, who.workspaceId))
    ).map((row) => [row.order, row.edition]);

  const ada = await buyer("ada"),
    bola = await buyer("bola"),
    chidi = await buyer("chidi"),
    dayo = await buyer("dayo"),
    eve = await buyer("eve"),
    femi = await buyer("femi"),
    gbenga = await buyer("gbenga");
  let evesFirst: Order | undefined;
  await withStandInPaystack(answer, async () => {
    // Ada left her payment page. While the provider cannot be asked about that order, nothing new is
    // made: Valo cannot tell whether she has paid.
    const first = await ended(ada);
    says(first, ada, "down");
    assert.deepEqual(await refusal(await ask(ada)), [503, UNASKED]);
    assert.deepEqual(asked, [verifies(first)]);
    assert.deepEqual(await stored(ada), [[first.id, "abandoned", true]]);
    // Only a workspace's own orders are asked about: Dayo's order of the same edition asks nobody, and
    // is made while Ada's cannot be.
    asked.length = 0;
    const fresh = await order(dayo);
    assert.deepEqual(asked, []);

    // Asked, the provider still calls it abandoned: a second order is made, after that one question.
    says(first, ada, "abandoned");
    const secondKey = randomUUID();
    const second = await order(ada, agreement, secondKey);
    assert.notEqual(second.id, first.id);
    assert.deepEqual(asked, [verifies(first)]);
    // The same request sent again is the same order, and nobody is asked for it.
    asked.length = 0;
    assert.equal((await order(ada, agreement, secondKey)).id, second.id);
    assert.deepEqual(asked, []);

    // A payment for the second order is started only after the same question. While the provider
    // cannot be asked, none is: the provider is never asked to start one.
    says(first, ada, "down");
    assert.deepEqual(await refusal(await checkout(second, ada)), [503, UNASKED]);
    assert.deepEqual(asked, [verifies(first)]);
    assert.deepEqual(await stored(ada), [
      [first.id, "abandoned", true],
      [second.id, "created", false],
    ]);

    // She had paid for the first after all. Asking settles it, and no payment is started for the second.
    says(first, ada, "success");
    assert.deepEqual(await refusal(await checkout(second, ada)), [409, ON_RECORD]);
    assert.deepEqual(asked, [verifies(first)]);
    assert.deepEqual(await stored(ada), [
      [first.id, "verified_success", true],
      [second.id, "created", false],
    ]);
    assert.deepEqual(await granted(ada), [[first.id, agreement.edition]]);
    const download = "/workspace/manual-premium-templates/" + agreement.edition + "/download";
    assert.equal((await call(download, undefined, ada.identityId)).status, 200);

    // Bola's payment failed, as the provider told it, and went through afterwards. Asking for another
    // order settles the first one: no second order is made.
    const left = await ended(bola, "failed");
    says(left, bola, "success");
    assert.deepEqual(await refusal(await ask(bola)), [409, ON_RECORD]);
    assert.deepEqual(asked, [verifies(left)]);
    assert.deepEqual(await stored(bola), [[left.id, "verified_success", true]]);
    assert.deepEqual(await granted(bola), [[left.id, agreement.edition]]);

    // Chidi has a second order whose payment page is already saved. The page is handed out again only
    // after the question, and not at all once the first order turns out paid.
    const one = await ended(chidi);
    const two = await order(chidi);
    const page = await checkout(two, chidi);
    assert.equal(page.status, 200);
    const { url } = (await page.json()) as { url: string };
    asked.length = 0;
    const again = await checkout(two, chidi);
    assert.deepEqual([again.status, await again.json()], [200, { url }]);
    assert.deepEqual(asked, [verifies(one)]);
    says(one, chidi, "success");
    assert.deepEqual(await refusal(await checkout(two, chidi)), [409, ON_RECORD]);
    assert.deepEqual(asked, [verifies(one)]);
    assert.deepEqual(await stored(chidi), [
      [one.id, "verified_success", true],
      [two.id, "pending", true],
    ]);

    // Gbenga left two payment pages. Each is asked about, the later first, and it was the earlier one
    // he paid on.
    const older = await ended(gbenga);
    const newer = await ended(gbenga);
    says(older, gbenga, "success");
    assert.deepEqual(await refusal(await ask(gbenga)), [409, ON_RECORD]);
    assert.deepEqual(asked, [verifies(newer), verifies(older)]);
    assert.deepEqual(await stored(gbenga), [
      [older.id, "verified_success", true],
      [newer.id, "abandoned", true],
    ]);

    // An order for another edition is not asked about: Femi left the policy's payment page, and orders
    // the agreement.
    await ended(femi, "abandoned", policy);
    asked.length = 0;
    await order(femi);
    assert.deepEqual(asked, []);
    // Nor is an order that ended without the provider ever being asked for a payment.
    await db.update(valoOrders).set({ status: "abandoned" }).where(eq(valoOrders.id, fresh.id));
    const next = await order(dayo);
    assert.notEqual(next.id, fresh.id);
    assert.deepEqual(asked, []);

    evesFirst = await ended(eve);
  });
  // Without a merchant there is nobody to ask, and no payment can be started either: the order is saved.
  assert.ok(evesFirst);
  const saved = await order(eve);
  assert.notEqual(saved.id, evesFirst.id);
  assert.equal((await checkout(saved, eve)).status, 503);
  assert.deepEqual(await stored(eve), [
    [evesFirst.id, "abandoned", true],
    [saved.id, "created", false],
  ]);
}
