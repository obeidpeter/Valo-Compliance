import {customFetch} from '@workspace/api-client-react';

export type SupportStatus = 'open' | 'in_progress' | 'awaiting_customer' | 'resolved';
export type SupportAction = 'assign' | 'reply' | 'resolve' | 'reopen' | 'escalate_content';
export interface SupportCase {
  id: string;
  reference: string;
  sourceKind?: 'workspace' | 'access';
  category: string;
  status: SupportStatus;
  version: number;
  updatedAt: string;
  scope?: string;
  contactEmail?: string;
  sharingConsent?: boolean;
  assignedTo?: string | null;
}
export interface SupportMessage {
  id: string;
  body: string;
  createdAt: string;
  authorKind: 'customer' | 'staff';
  visibility: 'customer' | 'internal';
}
export interface SupportCaseDetail {
  case: SupportCase;
  messages: SupportMessage[];
  messagesPage: number;
  messagePageSize: number;
  moreMessages: boolean;
  eventsTruncated?: boolean;
  escalationsTruncated?: boolean;
  events?: {id: string; action: string; actorId: string; createdAt: string}[];
  escalations?: {id: string; targetKind: 'content' | 'rule'; targetId: string; status: 'queued' | 'acknowledged' | 'resolved'; reason: string; createdAt: string}[];
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
  targetKind?: 'content' | 'rule';
  targetId?: string;
}
export interface SupportReplyInput {
  idempotencyKey: string;
  expectedVersion: number;
  body: string;
}
export interface ContentEscalation {
  id: string;
  caseId: string;
  reference: string;
  targetKind: 'content' | 'rule';
  targetId: string;
  targetVersion: number;
  targetHash: string;
  status: 'queued' | 'acknowledged' | 'resolved';
  reason: string;
  sourceImpactId: string | null;
  caseVersion: number;
  createdAt: string;
}
export type ContentEscalationAction = 'acknowledge' | 'resolve' | 'hold_and_reassess';
export interface ContentEscalationInput extends SupportReplyInput {
  action: ContentEscalationAction;
}
export interface ContentEscalationList {
  escalations: ContentEscalation[];
  page: number;
  pageSize: number;
  hasMore: boolean;
  notice: string;
}
export interface ContentEscalationResult {
  escalation: ContentEscalation;
  caseVersion: number;
  notice: string;
}
const root = (staff: boolean) => `/api/${staff ? 'admin' : 'workspace'}/support-cases`;
export const supportCaseKeys = {
  list: (staff: boolean) => ['support-cases', staff ? 'staff' : 'customer'] as const,
  detail: (staff: boolean, id: string, messagesPage = 1) => ['support-case', staff ? 'staff' : 'customer', id, messagesPage] as const,
  assignees: ['support-case-assignees'] as const,
  escalations: ['support-content-escalations'] as const,
};
export function listSupportCases(staff: boolean, page: number, status: SupportStatus | 'all' = 'all', signal?: AbortSignal) {
  return customFetch<SupportCaseList>(`${root(staff)}?page=${page}${staff ? `&status=${status}` : ''}`, {signal, responseType: 'json'});
}
export function getSupportCase(staff: boolean, id: string, messagesPage = 1, signal?: AbortSignal) {
  return customFetch<SupportCaseDetail>(`${root(staff)}/${encodeURIComponent(id)}?messagesPage=${messagesPage}`, {signal, responseType: 'json'});
}
export function listSupportAssignees(signal?: AbortSignal) {
  return customFetch<{assignees: {identityId: string}[]}>(`${root(true)}/assignees`, {signal, responseType: 'json'});
}
function confirmedCaseDetail(result: SupportCaseDetail, id: string, expectedVersion: number) {
  if (!result || typeof result !== 'object' || result.case?.id !== id ||
    !Number.isSafeInteger(result.case.version) || result.case.version <= expectedVersion ||
    !['open', 'in_progress', 'awaiting_customer', 'resolved'].includes(result.case.status) || !Array.isArray(result.messages)) {
    throw new Error('The saved support result could not be verified. Retry the same operation with its existing reference.');
  }
  return result;
}
export async function replyToSupportCase(id: string, input: SupportReplyInput) {
  const result = await customFetch<SupportCaseDetail>(`${root(false)}/${encodeURIComponent(id)}/reply`, {method: 'POST', body: JSON.stringify(input), responseType: 'json'});
  return confirmedCaseDetail(result, id, input.expectedVersion);
}
export async function actOnSupportCase(id: string, input: SupportStaffInput) {
  const result = await customFetch<SupportCaseDetail>(`${root(true)}/${encodeURIComponent(id)}/action`, {method: 'POST', body: JSON.stringify(input), responseType: 'json'});
  return confirmedCaseDetail(result, id, input.expectedVersion);
}
export function listContentEscalations(page: number, signal?: AbortSignal) {
  return customFetch<ContentEscalationList>(`/api/admin/support-escalations?page=${page}`, {signal, responseType: 'json'});
}
export async function actOnContentEscalation(id: string, input: ContentEscalationInput) {
  const result = await customFetch<ContentEscalationResult>(`/api/admin/support-escalations/${encodeURIComponent(id)}/action`, {method: 'POST', body: JSON.stringify(input), responseType: 'json'});
  if (!result || typeof result !== 'object' || result.escalation?.id !== id ||
    !Number.isSafeInteger(result.caseVersion) || result.caseVersion <= input.expectedVersion ||
    !['queued', 'acknowledged', 'resolved'].includes(result.escalation.status) ||
    (input.action === 'hold_and_reassess' &&
      (typeof result.escalation.sourceImpactId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result.escalation.sourceImpactId)))) {
    throw new Error('The content triage result could not be verified. Retry the same operation with its existing reference.');
  }
  return result;
}

/** Retain one key for the same submitted payload after an uncertain response. */
export function supportAttempt<T extends object>(previous: {signature: string; input: T & {idempotencyKey: string}} | null, input: T) {
  const signature = JSON.stringify(input);
  return previous?.signature === signature ? previous : {signature, input: {...input, idempotencyKey: crypto.randomUUID()}};
}
export function supportErrorStatus(error: unknown) {
  return (error as {status?: number} | null)?.status;
}
export function uncertainSupportResult(error: unknown) {
  const status = supportErrorStatus(error);
  // A successful HTTP status with an unreadable response can follow a committed
  // write. Only explicit 4xx rejections allow editing a new operation safely.
  return !!error && (status === undefined || status < 400 || status >= 500);
}
