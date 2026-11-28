import { formatDateTime } from "./format";

/**
 * The words for review work with its owner (docs/architecture/source-register.md, slice 3): each hold
 * on a version opens review work, which closes when a later release replaces the version or when the
 * version is withdrawn. The words are the owner's to confirm.
 */
export const queueHeading = "Review work";
export const ownerQueueHeading = "Review work on the rules you signed";
export const queueIntro =
  "Each hold on a version opens review work, oldest first here. It closes when a later release replaces the version, or when the version is withdrawn. Say what you checked as you go.";
export const emptyQueue = "No review work is open.";
export const closedHeading = "Closed lately";
export const noteLabel = "What you checked";
export const noteHint = "Say what you checked on this version, in 20 to 1,000 characters.";
export const noteButton = "Record what was checked";

type Opener =
  | "daily_check"
  | "check_overdue"
  | "source_retired"
  | "staff"
  | "review_due"
  | "lifecycle"
  | "publisher"
  | "derived"
  | "other";
/** What opened a row, in words. */
export function openerLine(opener: Opener, sourceId: string | null) {
  const source = sourceId ?? "its source";
  switch (opener) {
    case "daily_check":
      return `Opened by the daily check of ${source}`;
    case "check_overdue":
      return `Opened because the daily check of ${source} is overdue`;
    case "source_retired":
      return `Opened when ${source} was retired from the register`;
    case "staff":
      return "Opened by a staff hold";
    case "review_due":
      return "Opened when its review date passed";
    case "lifecycle":
      return "Opened by the editorial lifecycle";
    case "publisher":
      return "Opened by the publisher's withdrawal";
    case "derived":
      return "Opened by a hold on the rule it rests on";
    default:
      return "Opened by a hold";
  }
}
export function accountableLine(accountable: "content" | "owner") {
  return accountable === "owner" ? "Accountable: the development owner" : "Accountable: a Content editor";
}
/** The version a row holds, and since when. */
export function heldLine(item: {
  targetKind: "content" | "rule";
  targetKey: string;
  targetVersion: number;
  createdAt: string;
}) {
  return `${item.targetKind === "rule" ? "Rule" : "Template or guide"} ${item.targetKey}, version ${item.targetVersion} · held since ${formatDateTime(item.createdAt)}`;
}
export function noteLine(note: { note: string; recordedBy: string; createdAt: string }) {
  return `${formatDateTime(note.createdAt)}, ${note.recordedBy}: ${note.note}`;
}
/** How a row closed. */
export function closedLine(item: {
  targetKey: string;
  targetVersion: number;
  outcome: "superseded" | "withdrawn";
  completedAt: string | null;
}) {
  const how = item.outcome === "withdrawn" ? "closed, withdrawn" : "closed, replaced by a later release";
  return `${item.targetKey}, version ${item.targetVersion}: ${how}${item.completedAt ? ` ${formatDateTime(item.completedAt)}` : ""}`;
}

/**
 * A candidate prepared from review work (docs/architecture/source-register.md, slice 4): a Content
 * editor asks, from an open row on a held template or guide that has a preparer, for its next
 * candidate, and the worker prepares it with its mechanical checks. Its two reviews run only under an
 * AI allocation the owner approves. The words are the owner's to confirm.
 */
export const prepareButton = "Prepare a new candidate";
export const prepareAgainButton = "Prepare again";
export const prepareHint =
  "Prepares the next version from its retained draft, today's source captures and a fresh copy of the AI provider's terms, with its mechanical checks. Its two reviews run only under an AI allocation the owner approves. Nothing is sent or published from here.";

type Preparation = {
  status: "pending" | "running" | "prepared" | "held" | "not_ready" | "failed" | "closed";
  requestedBy: string;
  requestedAt: string;
  completedAt: string | null;
  candidateVersion: number | null;
  reasons: string[];
};
/** Whether a request is still with the worker. */
export const preparing = (preparation: Preparation | null) =>
  preparation?.status === "pending" || preparation?.status === "running";
/** Where the latest request to prepare a candidate from a row stands. */
export function preparationLine(preparation: Preparation) {
  const asked = `asked by ${preparation.requestedBy} on ${formatDateTime(preparation.requestedAt)}`;
  const when = preparation.completedAt ? formatDateTime(preparation.completedAt) : "";
  const version =
    preparation.candidateVersion === null ? "The candidate" : `Version ${preparation.candidateVersion}`;
  switch (preparation.status) {
    case "pending":
      return `A new candidate waits for the worker, ${asked}.`;
    case "running":
      return `A new candidate is being prepared, ${asked}.`;
    case "prepared":
      return `${version} was prepared on ${when}. It waits for its two reviews, under "Templates, guides and rules awaiting their reviews"; they run only under an AI allocation the owner approves.`;
    case "held":
      return `${version} failed a check on ${when} and was saved as held.`;
    case "not_ready":
      return `${version} was not ready on ${when}, so nothing was kept.`;
    case "failed":
      return `The preparation stopped on ${when}, so nothing was kept.`;
    default:
      return "The review work closed before a candidate was prepared.";
  }
}
/** What the checks named, or the code the preparation stopped with. */
export function reasonsLine(reasons: readonly string[]) {
  return reasons.length ? `What the checks named: ${reasons.join(", ")}.` : "";
}
export function askedMessage(item: { targetKey: string; targetVersion: number }) {
  return `Asked for a new candidate of ${item.targetKey}, after version ${item.targetVersion}. The worker prepares it next.`;
}
