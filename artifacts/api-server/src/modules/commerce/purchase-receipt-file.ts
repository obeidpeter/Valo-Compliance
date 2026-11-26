import type { WorkspaceActor } from "../workspaces";
import { purchaseReceiptOrder } from "./valo-commerce";
import { renderPurchaseReceipt } from "./valo-dispute-actions";

/**
 * The order's receipt as a PDF (docs/architecture/messages.md, part 5): the rendering Valo keeps as dispute
 * evidence, under its notice of what it is not. The order is read, and the caller's access to its receipt
 * checked, in a transaction that ends before the file is made: making it takes seconds, and no connection
 * is held meanwhile. Nothing is stored: each download is made afresh from the order's record, so there is
 * no file to keep, expire or erase.
 */
export async function purchaseReceiptFile(
  actor: WorkspaceActor,
  id: string,
  render: typeof renderPurchaseReceipt = renderPurchaseReceipt,
) {
  const order = await purchaseReceiptOrder(actor, id);
  // The file is named by the receipt's reference, kept to characters safe in a file name and a header.
  const reference = order.reference.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 100);
  return { filename: `VALO-TEST-${reference}.pdf`, bytes: await render(order) };
}
