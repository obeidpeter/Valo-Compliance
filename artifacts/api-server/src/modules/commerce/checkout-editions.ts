import { and, asc, eq, gt, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db, valoOrders, valoPrices } from "@workspace/db";
import type { WorkspaceActor } from "../workspaces";
import { ValoProblem } from "../../platform/valo-problem";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Use the same evidence as the file endpoint, including the original price, after an offer closes. Each
 * edition says whether its purchase carries to the template's later editions, under the access rule its
 * order recorded (docs/architecture/commercial-settings.md, slice 3b): an order made before the rule had
 * a record carries.
 */
export function verifiedEditions(actor: WorkspaceActor) {
  return sql`select e.content_version_id as edition, bool_or(o.carries_to_later_editions is not false) as carries
    from public.valo_entitlements e
    join public.valo_orders o on o.id = e.order_id and o.workspace_id = e.workspace_id
    join public.valo_prices p on p.id = o.price_id and p.content_version_id = e.content_version_id
    where e.workspace_id = ${actor.workspaceId}::uuid and e.status = 'active'
      and o.status = 'verified_success' and length(o.provider_transaction_id) > 0
      and o.line->>'contentVersionId' = e.content_version_id::text
      and o.line->>'licenceVersion' = p.licence_version and length(p.approval_reference) > 0
    group by e.content_version_id`;
}

export async function lockCheckoutWorkspace(tx: Tx, workspaceId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${workspaceId}))`);
}

/** Prefer a recorded payment, then the order already sent to the provider, then the oldest
 * open order. A saved order whose price has closed can be replaced if it never left Valo. */
export async function openEditionOrder(tx: Tx, actor: WorkspaceActor, edition: string, priceId: string) {
  const [row] = await tx
    .select({ order: valoOrders })
    .from(valoOrders)
    .innerJoin(valoPrices, eq(valoPrices.id, valoOrders.priceId))
    .where(
      and(
        eq(valoOrders.workspaceId, actor.workspaceId),
        eq(valoPrices.contentVersionId, edition),
        or(
          inArray(valoOrders.status, ["verified_success", "needs_review", "pending"]),
          and(
            eq(valoOrders.status, "created"),
            or(
              eq(valoPrices.id, priceId),
              isNotNull(valoOrders.checkoutUrl),
              isNull(valoPrices.effectiveTo),
              gt(valoPrices.effectiveTo, sql`now()`),
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
      "A payment for this edition is already on record. Check your purchases before paying again.",
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
  const existing = await openEditionOrder(tx, actor, order.line.contentVersionId, order.priceId);
  if (existing?.id !== order.id)
    throw new ValoProblem(
      409,
      "Another order already covers this edition. Open your purchases to check its status.",
    );
}
