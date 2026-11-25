import {
  actOnContentEscalation as postContentEscalationAction,
  actOnSupportCase as postSupportCaseAction,
  getCustomerSupportCase,
  getStaffSupportCase,
  listContentEscalations as getContentEscalations,
  listCustomerSupportCases,
  listStaffSupportCases,
  listSupportAssignees as getSupportAssignees,
  replyToSupportCase as postSupportReply,
  type ContentEscalation as GeneratedContentEscalation,
  type ContentEscalationActionInput,
  type ContentEscalationList as GeneratedContentEscalationList,
  type ContentEscalationResult as GeneratedContentEscalationResult,
  type SupportCaseAction,
  type SupportCaseStatus,
  type SupportMessage as GeneratedSupportMessage,
  type SupportReplyInput as GeneratedSupportReplyInput,
} from "@workspace/api-client-react";

// Requests and response types come from the API contract. The view types below let one
// component render both the customer and the staff shape of a case.
export type SupportStatus = SupportCaseStatus;
export type SupportAction = "assign" | "reply" | "resolve" | "reopen" | "escalate_content";
/** What a referral points at: a reviewed content version, a rule release, or a staff-library edition. */
export type SupportTargetKind = "content" | "rule" | "library";
export interface SupportCase {
  id: string;
  reference: string;
  sourceKind?: "workspace" | "access";
  category: string;
  status: SupportStatus;
  version: number;
  updatedAt: string;
  scope?: string;
  contactEmail?: string;
  sharingConsent?: boolean;
  assignedTo?: string | null;
}
export type SupportMessage = GeneratedSupportMessage;
export interface SupportCaseDetail {
  case: SupportCase;
  messages: SupportMessage[];
  messagesPage: number;
  messagePageSize: number;
  moreMessages: boolean;
  eventsTruncated?: boolean;
  escalationsTruncated?: boolean;
  events?: { id: string; action: string; actorId: string; createdAt: string }[];
  escalations?: {
    id: string;
    targetKind: SupportTargetKind;
    targetId: string;
    status: "queued" | "acknowledged" | "resolved";
    reason: string;
    createdAt: string;
  }[];
  notice: string;
}
export interface SupportCaseList {
  cases: SupportCase[];
  page: number;
  pageSize: number;
  hasMore: boolean;
  notice: string;
}
export interface SupportStaffInput {
  idempotencyKey: string;
  expectedVersion: number;
  action: SupportAction;
  body?: string;
  assigneeId?: string;
  targetKind?: SupportTargetKind;
  targetId?: string;
}
export type SupportReplyInput = GeneratedSupportReplyInput;
export type ContentEscalation = GeneratedContentEscalation;
export type ContentEscalationAction = ContentEscalationActionInput["action"];
export type ContentEscalationInput = ContentEscalationActionInput;
export type ContentEscalationList = GeneratedContentEscalationList;
export type ContentEscalationResult = GeneratedContentEscalationResult;
export const supportCaseKeys = {
  list: (staff: boolean) => ["support-cases", staff ? "staff" : "customer"] as const,
  detail: (staff: boolean, id: string, messagesPage = 1) =>
    ["support-case", staff ? "staff" : "customer", id, messagesPage] as const,
  assignees: ["support-case-assignees"] as const,
  escalations: ["support-content-escalations"] as const,
};
// A successful status with an unreadable body stays uncertain instead of clearing a draft.
const json = { responseType: "json" } as const;
/** Request options with the abort signal only when there is one. */
const request = (signal?: AbortSignal) => (signal ? { ...json, signal } : json);
export function listSupportCases(
  staff: boolean,
  page: number,
  status: SupportStatus | "all" = "all",
  signal?: AbortSignal,
): Promise<SupportCaseList> {
  return staff
    ? listStaffSupportCases({ page, status }, request(signal))
    : listCustomerSupportCases({ page }, request(signal));
}
export function getSupportCase(
  staff: boolean,
  id: string,
  messagesPage = 1,
  signal?: AbortSignal,
): Promise<SupportCaseDetail> {
  return staff
    ? getStaffSupportCase(id, { messagesPage }, request(signal))
    : getCustomerSupportCase(id, { messagesPage }, request(signal));
}
export function listSupportAssignees(signal?: AbortSignal) {
  return getSupportAssignees(request(signal));
}
function confirmedCaseDetail(result: SupportCaseDetail, id: string, expectedVersion: number) {
  if (
    !result ||
    typeof result !== "object" ||
    result.case?.id !== id ||
    !Number.isSafeInteger(result.case.version) ||
    result.case.version <= expectedVersion ||
    !["open", "in_progress", "awaiting_customer", "resolved"].includes(result.case.status) ||
    !Array.isArray(result.messages)
  ) {
    throw new Error(
      "The saved support result could not be verified. Retry the same operation with its existing reference.",
    );
  }
  return result;
}
export async function replyToSupportCase(id: string, input: SupportReplyInput) {
  return confirmedCaseDetail(await postSupportReply(id, input, json), id, input.expectedVersion);
}
export async function actOnSupportCase(id: string, input: SupportStaffInput) {
  return confirmedCaseDetail(
    await postSupportCaseAction(id, input as SupportCaseAction, json),
    id,
    input.expectedVersion,
  );
}
export function listContentEscalations(page: number, signal?: AbortSignal): Promise<ContentEscalationList> {
  return getContentEscalations({ page }, request(signal));
}
export async function actOnContentEscalation(id: string, input: ContentEscalationInput) {
  const result: ContentEscalationResult = await postContentEscalationAction(id, input, json);
  if (
    !result ||
    typeof result !== "object" ||
    result.escalation?.id !== id ||
    !Number.isSafeInteger(result.caseVersion) ||
    result.caseVersion <= input.expectedVersion ||
    !["queued", "acknowledged", "resolved"].includes(result.escalation.status) ||
    (input.action === "hold_and_reassess" && !heldRecord(result))
  ) {
    throw new Error(
      "The content triage result could not be verified. Retry the same operation with its existing reference.",
    );
  }
  return result;
}

/** The record a hold left: the staff-library hold of a library referral, or the source controls'
 * reassessment of a reviewed version or rule release. */
function heldRecord(result: ContentEscalationResult) {
  const record =
    result.escalation.targetKind === "library"
      ? result.escalation.libraryHoldId
      : result.escalation.sourceImpactId;
  return (
    typeof record === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(record)
  );
}
/** Retain one key for the same submitted payload after an uncertain response. */
export function supportAttempt<T extends object>(
  previous: { signature: string; input: T & { idempotencyKey: string } } | null,
  input: T,
) {
  const signature = JSON.stringify(input);
  return previous?.signature === signature
    ? previous
    : { signature, input: { ...input, idempotencyKey: crypto.randomUUID() } };
}
export function supportErrorStatus(error: unknown) {
  return (error as { status?: number } | null)?.status;
}
export function uncertainSupportResult(error: unknown) {
  const status = supportErrorStatus(error);
  // A successful HTTP status with an unreadable response can follow a committed
  // write. Only explicit 4xx rejections allow editing a new operation safely.
  return !!error && (status === undefined || status < 400 || status >= 500);
}
