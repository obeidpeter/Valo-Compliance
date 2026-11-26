import { randomUUID, createHash } from "node:crypto";
import { syntheticReceiptBlockers } from "./valo-receipt-provenance";
import { premiumEditions, type PremiumEdition } from "./premium-editions";
import { and, desc, eq, sql, inArray } from "drizzle-orm";
import {
  db,
  valoContentVersions,
  valoPrices,
  valoOrders,
  valoEntitlements,
  valoPurchaseOutbox,
  valoRefundRequests,
  valoPaymentEvents,
  valoEvents,
  valoPaymentReconciliations,
  valoPaymentDisputes,
  valoWorkspaces,
} from "@workspace/db";
import { z } from "zod";
import { activeTemplatePrices, isFreeBaselineTemplate, liveOperationalVersions } from "../catalogue";
import { authorizeWorkspaceRead, authorizeWorkspaceWrite, type WorkspaceActor } from "../workspaces";
import { commercialSettingChoice } from "../commercial-settings";
import { ValoProblem } from "../../platform/valo-problem";
import { consumeQuota, quotaPolicy, quotaSubjectHash } from "../../lib/valo-quota";
import {
  assertOrderMatch,
  paystack,
  paystackEventFamily,
  verifiedTransaction,
  sandboxPaymentsConfigured,
  type VerifiedTransaction,
} from "./valo-paystack-contract";
import { trustedSiteOrigin } from "../../lib/valo-site-origin";
import { assertDevelopmentRuntime, isDevelopmentRuntime } from "../../platform/valo-development-runtime";
import { CreateCommerceOrderBody } from "@workspace/api-zod";
import { requestOrderRefund, refundView, handleRefundEvent } from "./valo-refunds";
import { syncDispute } from "./valo-payment-disputes";
import { refundBalance, TEST_REFUND_POLICY } from "./valo-refund-provider";
import { setting } from "../../platform/settings";
import { assertSafetyActive, withSafetyDispatch } from "../sources";
import { singleRow } from "../../platform/rows";
import {
  assertPayableOrder,
  lockCheckoutWorkspace,
  openEditionOrder,
  orderEditions,
  orderLineEditions,
  verifiedEditions,
} from "./checkout-editions";
import { bundleForOrder, bundleOffers } from "./bundle-orders";
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const originalReceiptActions = ["payment.verified_success", "payment.synthetic_receipt_recovered"];
function audit(tx: Tx, workspaceId: string, actorId: string, action: string, id: string) {
  return tx.insert(valoEvents).values({ id: randomUUID(), workspaceId, actorId, action, entityId: id });
}
async function limit(tx: Tx, actor: WorkspaceActor) {
  const hash = quotaSubjectHash(setting("SESSION_SECRET"), "user", actor.identityId);
  // SEC-005: ten a minute and an account limit of a hundred a day, each in a counter of its own. One
  // counter for both would carry the day's count, which the alerts read against the minute's
  // ceiling, and in each day's first minute both windows would share one row.
  for (const [bucket, window] of [
    ["checkout-create", "minute"],
    ["checkout-create-day", "day"],
  ] as const) {
    const q = await consumeQuota(bucket, hash, quotaPolicy[bucket], window, tx);
    if (!q.allowed)
      throw new ValoProblem(
        429,
        `Purchase request limit reached. Retry in ${q.retryAfter} seconds; saved orders are unchanged.`,
        undefined,
        q.retryAfter,
      );
  }
}
function display(
  order: typeof valoOrders.$inferSelect,
  refunds: (typeof valoRefundRequests.$inferSelect)[] = [],
  disputeStatus: string | null = null,
  originalReceipt = false,
) {
  return {
    id: order.id,
    reference: order.reference,
    title: order.line.title,
    amountKobo: order.amountKobo,
    currency: order.currency,
    status: order.status,
    createdAt: order.createdAt.toISOString(),
    lastCheckedAt: order.lastCheckedAt?.toISOString() ?? null,
    licenceVersion: order.line.licenceVersion,
    licenceText: order.line.licenceText,
    taxTreatment: order.line.taxTreatment,
    // A template's order names its edition; a bundle's order names none of its own, and lists each it grants.
    contentVersionId: order.line.contentVersionId ?? null,
    editions: orderLineEditions(order.line),
    // The access rule the order recorded when it was made; one made before the rule had a record carries.
    carriesToLaterEditions: order.carriesToLaterEditions ?? true,
    refundStatus: refunds[0]?.status ?? null,
    refunds: refunds.map(refundView),
    ...refundBalance(order.amountKobo, refunds),
    refundPolicy: TEST_REFUND_POLICY,
    disputeStatus,
    receiptReference:
      order.providerTransactionId && (order.status === "verified_success" || originalReceipt)
        ? `VALO-TEST-${order.reference}`
        : null,
  };
}
async function originalReceiptExists(tx: Tx, orderId: string, workspaceId: string) {
  const [row] = await tx
    .select({ id: valoEvents.id })
    .from(valoEvents)
    .where(
      and(
        eq(valoEvents.workspaceId, workspaceId),
        eq(valoEvents.entityId, orderId),
        inArray(valoEvents.action, originalReceiptActions),
      ),
    )
    .limit(1);
  return !!row;
}
async function presentOrder(tx: Tx, order: typeof valoOrders.$inferSelect) {
  const [dispute] = await tx
    .select()
    .from(valoPaymentDisputes)
    .where(eq(valoPaymentDisputes.orderId, order.id))
    .orderBy(desc(valoPaymentDisputes.checkedAt));
  return display(
    order,
    await tx
      .select()
      .from(valoRefundRequests)
      .where(eq(valoRefundRequests.orderId, order.id))
      .orderBy(desc(valoRefundRequests.createdAt)),
    dispute?.status ?? null,
    await originalReceiptExists(tx, order.id, order.workspaceId),
  );
}
/** The released catalogue. It reads publication artifacts from storage and takes its own
 * pooled connections, so call it outside transactions: a caller that holds a transaction's
 * connection while it waits for another lets enough concurrent requests exhaust the pool. */
type OwnedPrice = { offerId: string; edition: string; title: string; carries: boolean };
async function commercialCatalogue(ownedPrices: OwnedPrice[] = []) {
  const [released, prices] = await Promise.all([liveOperationalVersions(), activeTemplatePrices()]);
  const reviewedIds = new Set(released.filter((v) => !isFreeBaselineTemplate(v.templateId)).map((v) => v.id));
  // The staff library's published premium editions download for their buyers; one held for its review
  // is not offered (docs/architecture/guidance-currency.md, slice 2).
  const manualIds = new Set<string>();
  const offeredManualIds = new Set<string>();
  if ((prices.length || ownedPrices.length) && isDevelopmentRuntime()) {
    const { rows } = await db.execute<PremiumEdition>(premiumEditions(null));
    for (const { edition, held } of rows) {
      manualIds.add(edition);
      if (!held) offeredManualIds.add(edition);
    }
  }
  const offers = prices
    .filter(({ edition }) => reviewedIds.has(edition) || offeredManualIds.has(edition))
    .map(({ edition, product }) => ({ manual: manualIds.has(edition), product }));
  // A purchase whose edition was replaced carries to its template's released edition at no further
  // charge (docs/architecture/editions.md, slice 2): it downloads that edition instead.
  const carried = new Map<
    string,
    { edition: string; version: number; boughtVersion: number; manual: boolean }
  >();
  const replaced = ownedPrices.filter(({ edition }) => !reviewedIds.has(edition) && !manualIds.has(edition));
  if (replaced.length && isDevelopmentRuntime()) {
    const { rows } = await db.execute<{
      bought: string;
      bought_version: number;
      edition: string;
      version: number;
    }>(sql`select bought, bought_version, edition, version from public.valo_workspace_carried_editions()`);
    for (const row of rows)
      carried.set(row.bought, {
        edition: row.edition,
        version: row.version,
        boughtVersion: row.bought_version,
        manual: true,
      });
    const live = new Map(released.map((version) => [version.templateId, version]));
    // On the reviewed route, only a purchase whose order recorded that it carries reaches the template's
    // released version (docs/architecture/commercial-settings.md, slice 3b).
    const carrying = replaced.filter(({ carries }) => carries).map(({ edition }) => edition);
    const bought = carrying.length
      ? await db
          .select({
            id: valoContentVersions.id,
            templateId: valoContentVersions.templateId,
            version: valoContentVersions.version,
          })
          .from(valoContentVersions)
          .where(inArray(valoContentVersions.id, carrying))
      : [];
    for (const row of bought) {
      const now = live.get(row.templateId);
      if (now && now.id !== row.id && reviewedIds.has(now.id))
        carried.set(row.id, {
          edition: now.id,
          version: now.version,
          boughtVersion: row.version,
          manual: false,
        });
    }
  }
  const download = (edition: string, manual: boolean) => ({
    downloadPath: manual
      ? "/api/workspace/manual-premium-templates/" + edition + "/download"
      : "/api/workspace/templates/" + edition + "/files/docx",
    ...(!manual && { pdfDownloadPath: "/api/workspace/templates/" + edition + "/files/pdf" }),
  });
  const ownedDownloads = ownedPrices.flatMap((price) => {
    if (reviewedIds.has(price.edition) || manualIds.has(price.edition))
      return [{ ...price, ...download(price.edition, manualIds.has(price.edition)) }];
    const next = carried.get(price.edition);
    return next
      ? [
          {
            ...price,
            ...download(next.edition, next.manual),
            carried: { boughtVersion: next.boughtVersion, version: next.version },
          },
        ]
      : [];
  });
  return { offers, ownedDownloads };
}
export async function commerceProducts() {
  return (await commercialCatalogue()).offers.map((offer) => offer.product);
}
/** Ownership follows the edition and the terms originally purchased, even after its sale price changes. */
export async function ownedTemplateEditions(actor: WorkspaceActor) {
  const { owned, reviewed } = await db.transaction(async (tx) => {
    await authorizeWorkspaceRead(tx, actor);
    const { rows } = await tx.execute<{ edition: string; carries: boolean }>(
      sql`${verifiedEditions(actor)} order by edition`,
    );
    // A purchase carries to its template's released edition (docs/architecture/editions.md, slice 2)
    // under the access rule its order recorded (docs/architecture/commercial-settings.md, slice 3b): the
    // staff library's through its owner's function, the reviewed route's by its template.
    const { rows: carried } = await tx.execute<{ edition: string }>(
      sql`select edition from public.valo_workspace_carried_editions()`,
    );
    const editions = rows.map((row) => row.edition);
    const carrying = rows.filter((row) => row.carries).map((row) => row.edition);
    const reviewed = carrying.length
      ? await tx
          .select({ templateId: valoContentVersions.templateId })
          .from(valoContentVersions)
          .where(inArray(valoContentVersions.id, carrying))
      : [];
    return { owned: [...editions, ...carried.map((row) => row.edition)], reviewed };
  });
  if (reviewed.length) {
    // The released catalogue takes its own connections, so it is read after the transaction.
    const templates = new Set(reviewed.map((row) => row.templateId));
    for (const version of await liveOperationalVersions())
      if (templates.has(version.templateId)) owned.push(version.id);
  }
  return [...new Set(owned)].sort();
}
export async function purchases(actor: WorkspaceActor) {
  const { ownedPrices, heldEditions, ...listing } = await db.transaction(async (tx) => {
    await authorizeWorkspaceRead(tx, actor);
    const orderRows = await tx
      .select()
      .from(valoOrders)
      .where(eq(valoOrders.workspaceId, actor.workspaceId))
      .orderBy(desc(valoOrders.createdAt))
      .limit(101);
    const hasMoreOrders = orderRows.length > 100;
    const orders = orderRows.slice(0, 100);
    const orderIds = orders.map((o) => o.id);
    const refundsByOrder = new Map<string, (typeof valoRefundRequests.$inferSelect)[]>();
    const disputeByOrder = new Map<string, string>();
    const originalReceipts = new Set<string>();
    if (orderIds.length) {
      const refunds = await tx
        .select()
        .from(valoRefundRequests)
        .where(
          and(
            eq(valoRefundRequests.workspaceId, actor.workspaceId),
            inArray(valoRefundRequests.orderId, orderIds),
          ),
        )
        .orderBy(desc(valoRefundRequests.createdAt));
      const disputes = await tx
        .select({ orderId: valoPaymentDisputes.orderId, status: valoPaymentDisputes.status })
        .from(valoPaymentDisputes)
        .where(
          and(
            eq(valoPaymentDisputes.workspaceId, actor.workspaceId),
            inArray(valoPaymentDisputes.orderId, orderIds),
          ),
        )
        .orderBy(desc(valoPaymentDisputes.checkedAt));
      const receiptEvents = await tx
        .select({ id: valoEvents.entityId })
        .from(valoEvents)
        .where(
          and(
            eq(valoEvents.workspaceId, actor.workspaceId),
            inArray(valoEvents.entityId, orderIds),
            inArray(valoEvents.action, originalReceiptActions),
          ),
        );
      for (const refund of refunds) {
        const list = refundsByOrder.get(refund.orderId);
        if (list) list.push(refund);
        else refundsByOrder.set(refund.orderId, [refund]);
      }
      for (const dispute of disputes) {
        if (!disputeByOrder.has(dispute.orderId)) disputeByOrder.set(dispute.orderId, dispute.status);
      }
      for (const event of receiptEvents) originalReceipts.add(event.id);
    }
    // A template a bundle granted that has no price of its own is listed by its edition, with the title its
    // order copied (docs/architecture/commercial-settings.md, slice 4c).
    const ownedPrices = await tx.execute<OwnedPrice>(sql`
      select p.id as "offerId", p.content_version_id as edition, p.title, owned.carries
      from public.valo_prices p join (${verifiedEditions(actor)}) owned on owned.edition=p.content_version_id
      where p.effective_from<=now() and length(p.approval_reference)>0
      union all
      select owned.edition, owned.edition, named.title, owned.carries
      from (${verifiedEditions(actor)}) owned
      cross join lateral (
        select x.granted->>'title' as title
          from public.valo_entitlements e
          join public.valo_orders o on o.id = e.order_id and o.workspace_id = e.workspace_id
          cross join lateral jsonb_array_elements(o.line->'editions') as x(granted)
         where e.workspace_id = ${actor.workspaceId}::uuid and e.content_version_id = owned.edition
           and o.bundle_id is not null and x.granted->>'contentVersionId' = owned.edition::text
         limit 1) named
      where not exists (
        select from public.valo_prices p where p.content_version_id = owned.edition
           and p.effective_from <= now() and length(p.approval_reference) > 0)
      order by 1`);
    // The editions the workspace holds, bought or carried to: a bundle that includes one is not offered.
    const { rows: carried } = await tx.execute<{ edition: string }>(
      sql`select edition from public.valo_workspace_carried_editions()`,
    );
    return {
      ownedPrices: ownedPrices.rows,
      heldEditions: new Set([
        ...ownedPrices.rows.map((row) => row.edition),
        ...carried.map((row) => row.edition),
      ]),
      // The access rule a purchase made now records (slice 3b), which the buyer accepts with the licence.
      purchaseCarriesToLaterEditions: await commercialSettingChoice(tx, "purchase_carries_to_later_editions"),
      available: true,
      livePaymentsEnabled: false,
      hasMoreOrders,
      message:
        "No live payments. Only server-verified Paystack test transactions can grant test purchases. Saved orders do not prove payment.",
      orders: orders.map((o) =>
        display(
          o,
          refundsByOrder.get(o.id) ?? [],
          disputeByOrder.get(o.id) ?? null,
          originalReceipts.has(o.id),
        ),
      ),
    };
  });
  // After the transaction: the catalogue takes its own connections. It holds no tenant data.
  const catalogue = await commercialCatalogue(ownedPrices);
  const bundles = (await bundleOffers()).filter(
    (offer) => !offer.templates.some((template) => heldEditions.has(template.edition)),
  );
  return {
    ...listing,
    products: catalogue.offers.map((offer) => offer.product),
    bundles,
    ownedDownloads: catalogue.ownedDownloads,
  };
}
export async function createOrder(actor: WorkspaceActor, raw: unknown) {
  const input = CreateCommerceOrderBody.strict().parse(raw);
  // An order buys one template's price or one bundle's version (docs/architecture/commercial-settings.md,
  // slice 4c).
  if ((input.priceId === undefined) === (input.bundleId === undefined))
    throw new ValoProblem(422, "Choose one template or one bundle to buy. No order was created.");
  if (input.bundleId !== undefined) return createBundleOrder(actor, { ...input, bundleId: input.bundleId });
  const priceId = input.priceId!;
  // Before the transaction: see commerceProducts.
  const offer = (await commercialCatalogue()).offers.find((entry) => entry.product.id === priceId);
  return db.transaction(async (tx) => {
    await assertSafetyActive(tx, "checkout");
    // Serialize one tenant's idempotency/price selection without trusting browser prices.
    await lockCheckoutWorkspace(tx, actor.workspaceId);
    // The access rule a new order records (docs/architecture/commercial-settings.md, slice 3b), held to the
    // end of this transaction: the buyer accepted it, and the database records the same rule on the order.
    const carries = await commercialSettingChoice(tx, "purchase_carries_to_later_editions", { hold: true });
    const [old] = await tx
      .select()
      .from(valoOrders)
      .where(and(eq(valoOrders.workspaceId, actor.workspaceId), eq(valoOrders.requestKey, input.requestKey)));
    if (old) {
      await authorizeWorkspaceWrite(tx, actor);
      if (
        old.priceId !== priceId ||
        old.line.licenceVersion !== input.acceptedLicenceVersion ||
        (old.carriesToLaterEditions ?? true) !== input.acceptedCarriesToLaterEditions
      )
        throw new ValoProblem(
          409,
          "This request key belongs to another choice. Your original order is unchanged.",
        );
      return presentOrder(tx, old);
    }
    const [price] = await tx.select().from(valoPrices).where(eq(valoPrices.id, priceId)).for("share");
    await authorizeWorkspaceWrite(tx, actor);
    if (
      !price ||
      !price.approvalReference ||
      +price.effectiveFrom > Date.now() ||
      (price.effectiveTo && +price.effectiveTo <= Date.now()) ||
      !offer
    )
      throw new ValoProblem(
        409,
        "This product is not currently released with an approved price and licence. No order was created.",
      );
    if (offer.manual) {
      // Checked again under the edition's lock: it may have been withdrawn, fallen due for its review
      // or been held by staff since the offer was read.
      const { rows } = await tx.execute<PremiumEdition>(premiumEditions(price.contentVersionId));
      if (!rows[0] || rows[0].held)
        throw new ValoProblem(409, "This template version is no longer available for purchase.");
    }
    if (input.acceptedLicenceVersion !== price.licenceVersion)
      throw new ValoProblem(409, "The licence changed. Review the current licence before continuing.");
    if (input.acceptedCarriesToLaterEditions !== carries)
      throw new ValoProblem(
        409,
        "What a purchase includes has changed. Review it before continuing. No order was created.",
      );
    const existing = await openEditionOrder(tx, actor, [price.contentVersionId], {
      priceId: price.id,
      bundleId: null,
    });
    if (existing) {
      if (
        existing.priceId !== price.id ||
        existing.line.licenceVersion !== input.acceptedLicenceVersion ||
        (existing.carriesToLaterEditions ?? true) !== carries
      )
        throw new ValoProblem(
          409,
          "An earlier order for this edition has different terms. Check it in your purchases.",
        );
      return presentOrder(tx, existing);
    }
    await limit(tx, actor);
    const id = randomUUID();
    const order = singleRow(
      await tx
        .insert(valoOrders)
        .values({
          id,
          workspaceId: actor.workspaceId,
          requestedBy: actor.identityId,
          requestKey: input.requestKey,
          reference: `valo-test-${id}`,
          priceId: price.id,
          amountKobo: price.amountKobo,
          currency: price.currency,
          // The database refuses any rule but the one in effect, which this transaction holds.
          carriesToLaterEditions: carries,
          line: {
            title: price.title,
            contentVersionId: price.contentVersionId,
            licenceVersion: price.licenceVersion,
            licenceText: price.licenceText,
            taxTreatment: price.taxTreatment,
          },
        })
        .returning(),
    );
    await audit(tx, actor.workspaceId, actor.identityId, "order.created", id);
    return presentOrder(tx, order);
  });
}
/** Whether the workspace already holds any of these editions: bought, or carried to under its order's rule. */
async function holdsAny(tx: Tx, actor: WorkspaceActor, editions: string[]) {
  const { rows } = await tx.execute<{ edition: string }>(sql`
    select owned.edition from (${verifiedEditions(actor)}) owned where owned.edition in ${editions}
    union all
    select c.edition from public.valo_workspace_carried_editions() c where c.edition in ${editions}
    limit 1`);
  return rows.length > 0;
}
/**
 * A bundle's order (docs/architecture/commercial-settings.md, slice 4c): the bundle version's amount, licence
 * and tax treatment and, for each of its templates, the released edition it grants, with its title. It is
 * made under the same locks and checks as a template's order, and refused while the workspace already holds
 * one of those editions or another order covers one.
 */
async function createBundleOrder(
  actor: WorkspaceActor,
  input: {
    bundleId: string;
    acceptedLicenceVersion: string;
    acceptedCarriesToLaterEditions: boolean;
    requestKey: string;
  },
) {
  return db.transaction(async (tx) => {
    await assertSafetyActive(tx, "checkout");
    await lockCheckoutWorkspace(tx, actor.workspaceId);
    const carries = await commercialSettingChoice(tx, "purchase_carries_to_later_editions", { hold: true });
    const [old] = await tx
      .select()
      .from(valoOrders)
      .where(and(eq(valoOrders.workspaceId, actor.workspaceId), eq(valoOrders.requestKey, input.requestKey)));
    if (old) {
      await authorizeWorkspaceWrite(tx, actor);
      if (
        old.bundleId !== input.bundleId ||
        old.line.licenceVersion !== input.acceptedLicenceVersion ||
        (old.carriesToLaterEditions ?? true) !== input.acceptedCarriesToLaterEditions
      )
        throw new ValoProblem(
          409,
          "This request key belongs to another choice. Your original order is unchanged.",
        );
      return presentOrder(tx, old);
    }
    const { version, templates } = await bundleForOrder(tx, input.bundleId);
    await authorizeWorkspaceWrite(tx, actor);
    if (input.acceptedLicenceVersion !== version.licenceVersion)
      throw new ValoProblem(409, "The licence changed. Review the current licence before continuing.");
    if (input.acceptedCarriesToLaterEditions !== carries)
      throw new ValoProblem(
        409,
        "What a purchase includes has changed. Review it before continuing. No order was created.",
      );
    const editions = templates.map((template) => template.edition);
    if (await holdsAny(tx, actor, editions))
      throw new ValoProblem(
        409,
        "Your workspace already owns a template in this bundle. Check your purchases. No order was created.",
      );
    const existing = await openEditionOrder(tx, actor, editions, { priceId: null, bundleId: version.id });
    if (existing) {
      if (
        existing.bundleId !== version.id ||
        existing.line.licenceVersion !== input.acceptedLicenceVersion ||
        (existing.carriesToLaterEditions ?? true) !== carries
      )
        throw new ValoProblem(
          409,
          "An earlier order covers a template in this bundle. Check it in your purchases.",
        );
      return presentOrder(tx, existing);
    }
    await limit(tx, actor);
    const id = randomUUID();
    const order = singleRow(
      await tx
        .insert(valoOrders)
        .values({
          id,
          workspaceId: actor.workspaceId,
          requestedBy: actor.identityId,
          requestKey: input.requestKey,
          reference: `valo-test-${id}`,
          bundleId: version.id,
          amountKobo: version.amountKobo,
          currency: version.currency,
          // The database refuses any rule but the one in effect, which this transaction holds.
          carriesToLaterEditions: carries,
          line: {
            title: version.title,
            bundle: version.bundleKey,
            licenceVersion: version.licenceVersion,
            licenceText: version.licenceText,
            taxTreatment: version.taxTreatment,
            editions: templates.map((template) => ({
              contentVersionId: template.edition,
              title: template.title,
            })),
          },
        })
        .returning(),
    );
    await audit(tx, actor.workspaceId, actor.identityId, "order.created", id);
    return presentOrder(tx, order);
  });
}
/** Whether an order's price or bundle is on sale now: a new payment is started only for one. */
async function stillOnSale(order: typeof valoOrders.$inferSelect) {
  return order.bundleId
    ? (await bundleOffers()).some((offer) => offer.id === order.bundleId)
    : (await commerceProducts()).some((product) => product.id === order.priceId);
}
async function ownedOrder(tx: Tx, actor: WorkspaceActor, id: string) {
  const [order] = await tx
    .select()
    .from(valoOrders)
    .where(and(eq(valoOrders.id, id), eq(valoOrders.workspaceId, actor.workspaceId)))
    .for("update");
  if (!order) throw new ValoProblem(404, "Order not found.");
  await authorizeWorkspaceWrite(tx, actor);
  return order;
}
export async function startCheckout(actor: WorkspaceActor, id: string, email: string) {
  // Before the transaction: see commerceProducts. It is read again just before the
  // merchant call, outside any transaction.
  const products = await commerceProducts();
  const bundles = await bundleOffers();
  const origin = trustedSiteOrigin();
  const order = await db.transaction(async (tx) => {
    await assertSafetyActive(tx, "checkout");
    await lockCheckoutWorkspace(tx, actor.workspaceId);
    const order = await ownedOrder(tx, actor, id);
    if (order.status === "verified_success")
      throw new ValoProblem(409, "This purchase is already verified. Do not pay again.");
    if (order.status === "needs_review" || order.status === "reversed")
      throw new ValoProblem(409, "This order needs staff reconciliation before any new payment.");
    if (
      !(order.bundleId
        ? bundles.some((offer) => offer.id === order.bundleId)
        : products.some((p) => p.id === order.priceId))
    )
      throw new ValoProblem(
        409,
        "This product is unavailable for new checkout. Your order history and drafts are unchanged.",
      );
    await assertPayableOrder(tx, actor, order);
    if (order.checkoutUrl) return order;
    if (!origin) throw new ValoProblem(503, "The trusted checkout return address is not configured.");
    if (!sandboxPaymentsConfigured())
      throw new ValoProblem(503, "Sandbox checkout needs a configured test merchant.");
    const recent = await tx
      .select({ id: valoEvents.id })
      .from(valoEvents)
      .where(
        and(
          eq(valoEvents.workspaceId, actor.workspaceId),
          eq(valoEvents.entityId, id),
          eq(valoEvents.action, "checkout.starting"),
          sql`${valoEvents.createdAt} > clock_timestamp() - interval '1 minute'`,
        ),
      )
      .limit(1);
    if (recent.length)
      throw new ValoProblem(
        409,
        "Checkout is already starting for this order. Check its status before retrying.",
      );
    await limit(tx, actor);
    await tx.update(valoOrders).set({ status: "pending" }).where(eq(valoOrders.id, id));
    await audit(tx, actor.workspaceId, actor.identityId, "checkout.starting", id);
    return order;
  });
  if (order.checkoutUrl) return { url: order.checkoutUrl };
  // No membership lock across provider I/O. Stable provider reference prevents
  // a retry from becoming a different order; never mint another reference on error.
  const url = await withSafetyDispatch("checkout", async () => {
    if (!(await stillOnSale(order)))
      throw new ValoProblem(409, "This product is no longer available for new checkout.");
    return paystack.initialise(order, email, `${origin}/workspace/purchases`);
  });
  return db.transaction(async (tx) => {
    await assertSafetyActive(tx, "checkout");
    await lockCheckoutWorkspace(tx, actor.workspaceId);
    const current = await ownedOrder(tx, actor, id);
    await assertPayableOrder(tx, actor, current);
    if (current.checkoutUrl) return { url: current.checkoutUrl };
    await tx.update(valoOrders).set({ checkoutUrl: url, status: "pending" }).where(eq(valoOrders.id, id));
    await audit(tx, actor.workspaceId, actor.identityId, "checkout.initialised", id);
    return { url };
  });
}
/** Called ONLY with schema-validated data obtained by the server's verify API adapter.
 * Callback/status and durable webhook workers converge on this locked transaction. */
export async function settleVerifiedOrder(id: string, data: VerifiedTransaction, actor?: WorkspaceActor) {
  data = verifiedTransaction.parse(data);
  return db.transaction(async (tx) => {
    // Take the same lock as order creation and checkout before locking the order. The stored
    // workspace also covers verified events that arrive without a signed-in customer.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(workspace_id::text)) from public.valo_orders
      where id = ${id}::uuid ${actor ? sql`and workspace_id = ${actor.workspaceId}::uuid` : sql``}`);
    const [order] = await tx
      .select()
      .from(valoOrders)
      .where(and(eq(valoOrders.id, id), ...(actor ? [eq(valoOrders.workspaceId, actor.workspaceId)] : [])))
      .for("update");
    if (!order) throw new ValoProblem(404, "Order not found.");
    if (actor) await authorizeWorkspaceWrite(tx, actor);
    assertOrderMatch(order, data);
    if (order.status === "reversed" && data.status !== "reversed")
      throw new ValoProblem(
        409,
        "A reversed payment requires audited staff reconciliation; it cannot be reactivated by a replay.",
      );
    if (order.providerTransactionId && order.providerTransactionId !== data.id)
      throw new ValoProblem(
        409,
        "A different provider transaction is already attached. Staff reconciliation is required.",
      );
    if (order.status === "verified_success" && data.status === "success") {
      await repairVerifiedFulfilment(tx, order, actor?.identityId ?? "service:paystack-verifier");
      return presentOrder(tx, order);
    }
    const status =
      data.status === "success"
        ? "verified_success"
        : data.status === "reversed"
          ? "reversed"
          : ["failed", "abandoned"].includes(data.status)
            ? data.status
            : "pending";
    // Never silently downgrade a completed purchase on a transient/pending response.
    if (order.status === "verified_success" && status !== "reversed") return presentOrder(tx, order);
    const updated = singleRow(
      await tx
        .update(valoOrders)
        .set({ status, lastCheckedAt: new Date(), providerTransactionId: data.id })
        .where(eq(valoOrders.id, id))
        .returning(),
    );
    if (status === "verified_success") {
      // PAY-005: one grant for each edition the order grants, a bundle's for each of its templates, once.
      await tx
        .insert(valoEntitlements)
        .values(
          orderEditions(order.line).map((edition) => ({
            id: randomUUID(),
            workspaceId: order.workspaceId,
            orderId: id,
            contentVersionId: edition,
          })),
        )
        .onConflictDoNothing();
      await tx
        .insert(valoPurchaseOutbox)
        .values({ id: randomUUID(), workspaceId: order.workspaceId, orderId: id })
        .onConflictDoNothing();
    }
    if (status === "reversed")
      await tx.update(valoEntitlements).set({ status: "suspended" }).where(eq(valoEntitlements.orderId, id));
    await audit(
      tx,
      order.workspaceId,
      actor?.identityId ?? "service:paystack-verifier",
      `payment.${status}`,
      id,
    );
    return presentOrder(tx, updated);
  });
}
export async function refreshOrder(actor: WorkspaceActor, id: string) {
  const order = await db.transaction(async (tx) => {
    const row = await ownedOrder(tx, actor, id);
    await limit(tx, actor);
    return row;
  });
  const data = await paystack.verify(order.reference);
  // Revalidates membership AFTER the network wait and resource lock.
  return settleVerifiedOrder(id, data, actor);
}
export async function purchaseReceipt(actor: WorkspaceActor, id: string) {
  return db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(valoOrders)
      .where(and(eq(valoOrders.id, id), eq(valoOrders.workspaceId, actor.workspaceId)));
    if (!order) throw new ValoProblem(404, "Order not found.");
    await authorizeWorkspaceRead(tx, actor);
    if (
      !order.providerTransactionId ||
      (order.status !== "verified_success" && !(await originalReceiptExists(tx, id, order.workspaceId)))
    )
      throw new ValoProblem(409, "There is no recorded verified original purchase receipt for this order.");
    const [delivery] = await tx
      .select()
      .from(valoPurchaseOutbox)
      .where(and(eq(valoPurchaseOutbox.orderId, id), eq(valoPurchaseOutbox.kind, "purchase_receipt")));
    return {
      ...(await presentOrder(tx, order)),
      notice:
        "Paystack test-mode Valo purchase receipt. Not a live payment, customer-generated business invoice, government receipt or official tax invoice.",
      deliveryStatus: delivery?.status ?? "not_queued",
    };
  });
}
/** Called only after canonical transaction verification under the order lock.
 * Never unsuspend an existing grant or bypass refund/dispute decisions. */
async function repairVerifiedFulfilment(
  tx: Tx,
  order: typeof valoOrders.$inferSelect,
  actorId: string,
  receiptStatus: "pending" | "held_synthetic_recovery" = "pending",
) {
  const grants = await tx
    .select({ edition: valoEntitlements.contentVersionId })
    .from(valoEntitlements)
    .where(eq(valoEntitlements.orderId, order.id));
  const missing = orderEditions(order.line).filter(
    (edition) => !grants.some((grant) => grant.edition === edition),
  );
  const [receipt] = await tx
    .select()
    .from(valoPurchaseOutbox)
    .where(and(eq(valoPurchaseOutbox.orderId, order.id), eq(valoPurchaseOutbox.kind, "purchase_receipt")));
  let repaired = false;
  if (missing.length) {
    const [refund] = await tx
      .select({ id: valoRefundRequests.id })
      .from(valoRefundRequests)
      .where(eq(valoRefundRequests.orderId, order.id))
      .limit(1);
    const [dispute] = await tx
      .select({ id: valoPaymentDisputes.id })
      .from(valoPaymentDisputes)
      .where(eq(valoPaymentDisputes.orderId, order.id))
      .limit(1);
    if (!refund && !dispute) {
      await tx
        .insert(valoEntitlements)
        .values(
          missing.map((edition) => ({
            id: randomUUID(),
            workspaceId: order.workspaceId,
            orderId: order.id,
            contentVersionId: edition,
          })),
        )
        .onConflictDoNothing();
      repaired = true;
    }
  }
  if (!receipt) {
    await tx
      .insert(valoPurchaseOutbox)
      .values({
        id: randomUUID(),
        workspaceId: order.workspaceId,
        orderId: order.id,
        kind: "purchase_receipt",
        status: receiptStatus,
      })
      .onConflictDoNothing();
    repaired = true;
  }
  if (repaired) await audit(tx, order.workspaceId, actorId, "payment.fulfilment_repaired", order.id);
}
/** Explicit maintenance of retained synthetic refund fixtures, not provider
 * verification. Uses the same locked, unique, audited fulfilment repair but
 * refuses to manufacture a missing grant or an actual settlement. No HTTP route.
 * Recovered messages stay held even if delivery is configured later. */
export async function recoverSyntheticPurchaseReceipt(id: string) {
  assertDevelopmentRuntime();
  if (setting("VALO_SYNTHETIC_RECEIPT_RECOVERY") !== "owned-recorded-fixtures-only")
    throw new ValoProblem(403, "Explicit synthetic receipt maintenance is required.");
  return db.transaction(async (tx) => {
    const [order] = await tx.select().from(valoOrders).where(eq(valoOrders.id, id)).for("update");
    if (!order) throw new ValoProblem(404, "Order not found.");
    const [workspace] = await tx
      .select()
      .from(valoWorkspaces)
      .where(eq(valoWorkspaces.id, order.workspaceId));
    // Retained synthetic fixtures are template orders: a bundle's order names no single edition, and none of
    // its grants is a matching one.
    const edition = order.line.contentVersionId;
    const [grant] = edition
      ? await tx
          .select()
          .from(valoEntitlements)
          .where(
            and(
              eq(valoEntitlements.orderId, id),
              eq(valoEntitlements.workspaceId, order.workspaceId),
              eq(valoEntitlements.contentVersionId, edition),
            ),
          )
      : [];
    const blockers = syntheticReceiptBlockers({
      owner: workspace?.ownerIdentityId ?? null,
      requester: order.requestedBy,
      reference: order.reference,
      title: order.line.title,
      licence: order.line.licenceVersion,
      currency: order.currency,
      amount: order.amountKobo,
      status: order.status,
      providerReference: !!order.providerTransactionId,
      matchingGrant: !!grant,
    });
    if (blockers.length)
      throw Object.assign(
        new ValoProblem(
          409,
          "This row is not an eligible retained synthetic fixture. No receipt, entitlement or payment state was changed.",
        ),
        { code: "SYNTHETIC_RECEIPT_INELIGIBLE", blockers },
      );
    const [prior] = await tx
      .select()
      .from(valoPurchaseOutbox)
      .where(and(eq(valoPurchaseOutbox.orderId, id), eq(valoPurchaseOutbox.kind, "purchase_receipt")));
    if (prior)
      return {
        repaired: false,
        receiptId: prior.id,
        deliveryStatus: prior.status,
        realProviderVerification: false,
      };
    await repairVerifiedFulfilment(
      tx,
      order,
      "service:synthetic-receipt-recovery",
      "held_synthetic_recovery",
    );
    const [receipt] = await tx
      .select()
      .from(valoPurchaseOutbox)
      .where(and(eq(valoPurchaseOutbox.orderId, id), eq(valoPurchaseOutbox.kind, "purchase_receipt")));
    if (!receipt) throw Error("PURCHASE_RECEIPT_MISSING_AFTER_SHARED_REPAIR");
    await audit(
      tx,
      order.workspaceId,
      "service:synthetic-receipt-recovery",
      "payment.synthetic_receipt_recovered",
      id,
    );
    return {
      repaired: true,
      receiptId: receipt.id,
      deliveryStatus: receipt.status,
      realProviderVerification: false,
    };
  });
}
export async function requestRefund(actor: WorkspaceActor, id: string, raw: unknown) {
  return requestOrderRefund(actor, id, raw);
}
/** Persist only the minimum authenticated event facts, never card/customer payloads. */
export async function recordPaymentEvent(raw: Buffer) {
  const event = z
    .object({
      event: z.string().min(1).max(80),
      data: z
        .object({
          id: z
            .union([z.string().max(150), z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)])
            .optional(),
          reference: z.string().max(150).optional(),
          refund_reference: z.string().max(150).nullable().optional(),
          transaction_reference: z.string().max(150).optional(),
        })
        .optional(),
    })
    .parse(JSON.parse(raw.toString("utf8")));
  const family = paystackEventFamily(event.event);
  const charge = family === "charge",
    refund = family === "refund",
    dispute = family === "dispute";
  const supported = family !== undefined;
  if (charge && (!event.data?.id || !event.data.reference))
    throw new ValoProblem(422, "A charge event requires its transaction ID and reference.");
  const reference = refund
    ? (event.data?.refund_reference ?? undefined)
    : dispute
      ? String(event.data?.id ?? "")
      : event.data?.reference;
  const bodyHash = createHash("sha256").update(raw).digest("hex");
  const id = randomUUID(),
    eventKey = `test:${event.event}:${event.data?.id ?? (refund ? reference : undefined) ?? bodyHash}`;
  const [inserted] = await db
    .insert(valoPaymentEvents)
    .values({
      id,
      eventKey,
      bodyHash,
      eventType: event.event,
      reference,
      status: supported ? "pending" : "ignored",
    })
    .onConflictDoNothing()
    .returning();
  return { received: true, duplicate: !inserted };
}
export async function processPaymentEvents() {
  if (!sandboxPaymentsConfigured()) return;
  const events = await db
    .select()
    .from(valoPaymentEvents)
    .where(eq(valoPaymentEvents.status, "pending"))
    .limit(20);
  for (const event of events) {
    try {
      if (!event.reference) throw new ValoProblem(409, "Missing reference");
      if (event.eventType.startsWith("refund.")) {
        if (!(await handleRefundEvent(event.reference))) continue;
        await db
          .update(valoPaymentEvents)
          .set({ status: "processed", failure: null })
          .where(eq(valoPaymentEvents.id, event.id));
        continue;
      }
      if (event.eventType.startsWith("charge.dispute.")) {
        if (!(await syncDispute(event.reference))) continue;
        await db
          .update(valoPaymentEvents)
          .set({ status: "processed", failure: null })
          .where(eq(valoPaymentEvents.id, event.id));
        continue;
      }
      const [order] = await db.select().from(valoOrders).where(eq(valoOrders.reference, event.reference));
      if (!order) throw new ValoProblem(409, "Unmatched reference");
      await settleVerifiedOrder(order.id, await paystack.verify(order.reference));
      await db
        .update(valoPaymentEvents)
        .set({ status: "processed", failure: null })
        .where(eq(valoPaymentEvents.id, event.id));
    } catch (error) {
      // Atomic attempts bound retries even across multiple worker processes.
      await db.execute(sql`update valo_payment_events set attempts=LEAST(attempts+1,5),
        status=case when attempts>=4 or ${error instanceof ValoProblem && error.status === 409} then 'needs_review' else 'pending' end,
        failure='SERVER_VERIFICATION_REQUIRED' where id=${event.id} and status='pending'`);
    }
  }
}
/** Durable daily reconciliation queue. A worker restart cannot erase the day/order key.
 * Missing credentials do not consume attempts or manufacture matched results. */
export async function reconcilePayments() {
  if (!sandboxPaymentsConfigured()) return;
  await db.execute(sql`insert into valo_payment_reconciliations(id,workspace_id,order_id,day)
    select gen_random_uuid(),workspace_id,id,to_char(now() at time zone 'UTC','YYYY-MM-DD')
    from valo_orders where status <> 'created'
    on conflict(order_id,day) do nothing`);
  const pending = await db
    .select()
    .from(valoPaymentReconciliations)
    .where(eq(valoPaymentReconciliations.status, "pending"))
    .limit(10);
  for (const job of pending) {
    try {
      const [order] = await db
        .select()
        .from(valoOrders)
        .where(and(eq(valoOrders.id, job.orderId), eq(valoOrders.workspaceId, job.workspaceId)));
      if (!order) throw new Error("ORDER_MISSING");
      await settleVerifiedOrder(order.id, await paystack.verify(order.reference));
      const [grant] = await db.select().from(valoEntitlements).where(eq(valoEntitlements.orderId, order.id));
      const [receipt] = await db
        .select()
        .from(valoPurchaseOutbox)
        .where(
          and(eq(valoPurchaseOutbox.orderId, order.id), eq(valoPurchaseOutbox.kind, "purchase_receipt")),
        );
      const current = singleRow(await db.select().from(valoOrders).where(eq(valoOrders.id, order.id)));
      const gaps =
        current.status === "verified_success"
          ? [
              ...(grant?.status !== "active" ? ["ENTITLEMENT_DIFFERENCE"] : []),
              ...(!receipt ? ["RECEIPT_OUTBOX_MISSING"] : []),
            ]
          : [];
      await db
        .update(valoPaymentReconciliations)
        .set({ status: gaps.length ? "needs_review" : "matched", finding: gaps.join(";") || null })
        .where(eq(valoPaymentReconciliations.id, job.id));
    } catch {
      await db.execute(sql`update valo_payment_reconciliations set attempts=LEAST(attempts+1,3),
        status=case when attempts>=2 then 'needs_review' else 'pending' end,
        finding='VERIFICATION_OR_FULFILMENT_DIFFERENCE' where id=${job.id} and status='pending'`);
    }
  }
}
