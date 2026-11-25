import { formatDay } from "./format";

/**
 * The staff library's words for a published entry's review (docs/architecture/guidance-currency.md,
 * slice 2). An entry other than a regulatory guide is due for review 90 days after it was published or
 * last reviewed; once overdue, it is held from new use until a Content editor reviews it. The words are
 * the owner's to confirm.
 */
type ReviewDate = { version: number; due: string };

const overdue = (review: ReviewDate, now: number) => Date.parse(review.due) <= now;

export const heldWords =
  "Customers cannot find, download or buy it until it is reviewed. What they already have is unchanged.";

/** The line under an entry in the list. */
export function reviewLine(review: ReviewDate, now = Date.now()) {
  const day = formatDay(review.due);
  return overdue(review, now) ? `Review overdue since ${day}` : `Review due ${day}`;
}

/** What the open entry says of its published version's review. */
export function reviewStatus(review: ReviewDate, now = Date.now()) {
  const day = formatDay(review.due);
  return overdue(review, now)
    ? `Published version ${review.version} was due for review on ${day}. ${heldWords}`
    : `Published version ${review.version} is due for review on ${day}.`;
}

export const dueFilterLabel = "Only entries due for review in the next 14 days, or overdue";
export const reviewNoteLabel = "What you re-read, and why it needs no change";
export const reviewNoteHint = "In 20 to 1,000 characters. If it needs a change, save a new version instead.";

/** Said once a review is recorded. */
export function reviewRecorded(due: string) {
  return `Review recorded. The next review is due on ${formatDay(due)}.`;
}

/** Whether a review is overdue, for the list's emphasis. */
export const isOverdue = (review: ReviewDate, now = Date.now()) => overdue(review, now);
