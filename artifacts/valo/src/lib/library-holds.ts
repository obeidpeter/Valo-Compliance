import { formatDay } from "./format";

/**
 * The staff library's words for a hold on a published entry, short of a withdrawal
 * (docs/architecture/library-holds.md, slice 2, ADM-007). A held version leaves new use as an overdue one
 * does, while what customers already have stays, and they are not told. A Content editor lifts a hold on
 * any entry but a regulatory guide, whose hold only the owner lifts. The words are the owner's to confirm.
 */
type Hold = { reason: string; placedAt: string; workspaces: number };

export const holdLabel = "Why is this version held?";
export const holdHint =
  "Customers cannot find, download or buy it while it is held, and are not told. What they already have is unchanged. Staff see your reason. In 20 to 1,000 characters.";
export const liftLabel = "Why is the hold lifted?";
export const liftHint =
  "Customers can find, download and buy it again once it is lifted. In 20 to 1,000 characters.";
export const ownerLiftsWords = "Only the owner lifts a regulatory guide's hold, from the owner's panel.";

/** What the open entry, or the owner's panel, says of a hold on its published version. */
export function heldLine(version: number, hold: Hold) {
  const reason = hold.reason.trim();
  return `Version ${version} is held since ${formatDay(hold.placedAt)}: ${reason}${/[.!?]$/.test(reason) ? "" : "."} Customers cannot find, download or buy it. What they already have is unchanged.`;
}

/** Said once a hold is placed or lifted. */
export const heldMessage =
  "Held. Customers cannot find, download or buy this version until the hold is lifted.";
export const liftedMessage = "Hold lifted. Customers can find, download and buy this version again.";

/** The list's mark for an entry whose published version is held. */
export const heldMark = "Held";
