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
