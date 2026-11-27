import { and, asc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { db, valoBundles, valoOrders, valoPrices, type ValoOrderLine } from "@workspace/db";
import type { WorkspaceActor } from "../workspaces";
import { ValoProblem } from "../../platform/valo-problem";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Use the same evidence as the file endpoint, including the original price, after an offer closes: the
 * database's one check of a purchase's terms, valo_order_terms_hold (docs/architecture/
 * commercial-settings.md, slice 4a). Each edition says whether its purchase carries to the template's later
 * editions, under the access rule its order recorded (slice 3b): an order made before the rule had a
 * record carries.
 */
export function verifiedEditions(actor: WorkspaceActor) {
  return sql`select e.content_version_id as edition, bool_or(o.carries_to_later_editions is not false) as carries
    from public.valo_entitlements e
    join public.valo_orders o on o.id = e.order_id and o.workspace_id = e.workspace_id
    where e.workspace_id = ${actor.workspaceId}::uuid and e.status = 'active'
      and o.status = 'verified_success' and length(o.provider_transaction_id) > 0
      and public.valo_order_terms_hold(o.id, e.content_version_id)
    group by e.content_version_id`;
}

export async function lockCheckoutWorkspace(tx: Tx, workspaceId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${workspaceId}))`);
}

/**
 * The editions an order grants, each with the title its line copied: a template's order its one edition, a
 * bundle's order the released edition of each of its templates (docs/architecture/commercial-settings.md,
 * slice 4c).
 */
export function orderLineEditions(line: ValoOrderLine) {
  return line.editions ?? [{ contentVersionId: line.contentVersionId, title: line.title }];
}
export const orderEditions = (line: ValoOrderLine) =>
  orderLineEditions(line).map((edition) => edition.contentVersionId);

/** What an order buys: a template's price or a bundle's version. */
export type OrderOffer = { priceId: string | null; bundleId: string | null };

/** Whether an order's line names any of these editions. */
const namesAny = (editions: string[]) =>
  sql`(${valoOrders.line}->>'contentVersionId' in ${editions} or exists (
    select from jsonb_array_elements(coalesce(${valoOrders.line}->'editions', '[]'::jsonb)) as named(edition)
     where named.edition->>'contentVersionId' in ${editions}))`;

/** Prefer a recorded payment, then the order already sent to the provider, then the oldest open order
 * that covers any of these editions. A saved order whose price or bundle has closed can be replaced if it
 * never left Valo. */
export async function openEditionOrder(tx: Tx, actor: WorkspaceActor, editions: string[], offer: OrderOffer) {
  const closesAt = sql`coalesce(${valoPrices.effectiveTo}, ${valoBundles.effectiveTo})`;
  const [row] = await tx
    .select({ order: valoOrders })
    .from(valoOrders)
    .leftJoin(valoPrices, eq(valoPrices.id, valoOrders.priceId))
    .leftJoin(valoBundles, eq(valoBundles.id, valoOrders.bundleId))
    .where(
      and(
        eq(valoOrders.workspaceId, actor.workspaceId),
        namesAny(editions),
        or(
          inArray(valoOrders.status, ["verified_success", "needs_review", "pending"]),
          and(
            eq(valoOrders.status, "created"),
            or(
              offer.priceId ? eq(valoOrders.priceId, offer.priceId) : undefined,
              offer.bundleId ? eq(valoOrders.bundleId, offer.bundleId) : undefined,
              isNotNull(valoOrders.checkoutUrl),
              sql`${closesAt} is null`,
              sql`${closesAt} > now()`,
            ),
          ),
        ),
      ),
    )
    .orderBy(
      sql`case when ${valoOrders.status} in ('verified_success','needs_review') then 0
      when ${valoOrders.status} = 'pending' or ${valoOrders.checkoutUrl} is not null then 1 else 2 end`,
      asc(valoOrders.createdAt),
      asc(valoOrders.id),
    )
    .limit(1);
  if (row?.order.status === "verified_success" || row?.order.status === "needs_review") {
    throw new ValoProblem(
      409,
      editions.length > 1
        ? "A payment for a template in this bundle is already on record. Check your purchases before paying again."
        : "A payment for this edition is already on record. Check your purchases before paying again.",
    );
  }
  return row?.order;
}

export async function assertPayableOrder(
  tx: Tx,
  actor: WorkspaceActor,
  order: typeof valoOrders.$inferSelect,
) {
  if (!["created", "pending"].includes(order.status))
    throw new ValoProblem(409, "This order can no longer start a payment. Check your purchases.");
  const existing = await openEditionOrder(tx, actor, orderEditions(order.line), order);
  if (existing?.id !== order.id)
    throw new ValoProblem(
      409,
      "Another order already covers this edition. Open your purchases to check its status.",
    );
}
