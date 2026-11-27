import { eq, sql } from "drizzle-orm";
import { db, valoOrders, type ValoOrderLine } from "@workspace/db";

/**
 * Puts a line on a synthetic order beneath the database's guards on orders, as a restore or a direct
 * edit of the table would put it (docs/architecture/order-safety.md). The database keeps an order's line,
 * so a test whose subject is an order with a wrong line plants it this way, in an order of its own.
 * Triggers are off for this one transaction, and only a superuser's connection can turn them off: the
 * test databases' own login is one.
 */
export async function plantOrderLine(orderId: string, line: ValoOrderLine) {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL session_replication_role = replica`);
    await tx.update(valoOrders).set({ line }).where(eq(valoOrders.id, orderId));
  });
}
