import { formatDateTime } from "@/lib/format";
import { targetKindNames } from "@/lib/library-referrals";
import type { SupportAction, SupportCaseDetail, SupportTargetKind } from "@/lib/support-case-api";
import { LibraryEntryChooser } from "./library-entry-chooser";
import { ErrorState } from "./states";
import { SupportMessages } from "./support-cases";

export const SUPPORT_ACTION_LABELS: Record<SupportAction, string> = {
  assign: "Assign support staff",
  reply: "Save a reply",
  resolve: "Resolve with a reason",
  reopen: "Reopen with a reason",
  escalate_content: "Queue internal content triage",
};

type DetailQueryState = {
  data: SupportCaseDetail | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
};

type AssigneesQueryState = {
  data: { assignees: { identityId: string }[] } | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => Promise<unknown>;
};

export function StaffSupportCaseDetail({
  detail,
  detailDenied,
  assignees,
  messagesPage,
  onMessagesPage,
  action,
  onAction,
  body,
  onBody,
  assignee,
  onAssignee,
  targetKind,
  onTargetKind,
  targetId,
  onTargetId,
  fieldsLocked,
  operationLocked,
  actionAllowed,
  validInput,
  mutationPending,
  mutationError,
  conflict,
  uncertain,
  canRetryUncertain,
  saved,
  onReload,
  onSubmit,
  onDiscard,
  onRetryUncertain,
}: {
  detail: DetailQueryState;
  detailDenied: boolean;
  assignees: AssigneesQueryState;
  messagesPage: number;
  onMessagesPage: (page: number) => void;
  action: SupportAction;
  onAction: (action: SupportAction) => void;
  body: string;
  onBody: (body: string) => void;
  assignee: string;
  onAssignee: (assignee: string) => void;
  targetKind: SupportTargetKind;
  onTargetKind: (kind: SupportTargetKind) => void;
  targetId: string;
  onTargetId: (id: string) => void;
  fieldsLocked: boolean;
  operationLocked: boolean;
  actionAllowed: boolean;
  validInput: boolean;
  mutationPending: boolean;
  mutationError: unknown;
  conflict: boolean;
  uncertain: boolean;
  canRetryUncertain: boolean;
  saved: string;
  onReload: () => void;
  onSubmit: () => void;
  onDiscard: () => void;
  onRetryUncertain: () => void;
}) {
  const row = detail.data?.case;
  const resolved = row?.status === "resolved";
  const mayEscalate = row?.sourceKind === "workspace";

  return (
    <section className="surface mt-7 min-w-0 p-5 sm:p-7" aria-labelledby="staff-support-detail-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3 id="staff-support-detail-heading" className="font-display break-all text-2xl">
          {!detailDenied && row ? row.reference : "Support case"}
        </h3>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={detail.isFetching || mutationPending}
          onClick={onReload}
        >
          Reload latest case
        </button>
      </div>
      {detail.isLoading && (
        <p className="mt-4" role="status">
          Loading the case before enabling operations…
        </p>
      )}
      {detail.isError && (
        <div className="mt-4">
          <ErrorState error={detail.error} onRetry={onReload} />
        </div>
      )}
      {!detailDenied && detail.data && row && (
        <div className="mt-5 grid min-w-0 gap-5">
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            {(
              [
                ["Status", row.status.replaceAll("_", " ")],
                ["Version", String(row.version)],
                ["Contact email", row.contactEmail ?? "Not recorded"],
                ["Assigned staff", row.assignedTo ?? "Unassigned"],
                ["Outside-adviser sharing consent", row.sharingConsent ? "Given" : "Not given"],
                [
                  "Request source",
                  row.sourceKind === "access" ? "Anonymous account access" : "Signed-in workspace",
                ],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="mt-1 [overflow-wrap:anywhere]">{value}</dd>
              </div>
            ))}
          </dl>
          <div>
            <h4 className="text-sm font-semibold">Full original request</h4>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed [overflow-wrap:anywhere]">
              {row.scope}
            </p>
          </div>
          <p className="rounded-xl bg-secondary p-3 text-sm">{detail.data.notice}</p>
          <SupportMessages messages={detail.data.messages} staff />
          <div
            className="flex flex-wrap items-center gap-3"
            role="group"
            aria-label="Staff support conversation pages"
          >
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={messagesPage === 1 || detail.isFetching || mutationPending}
              onClick={() => onMessagesPage(messagesPage - 1)}
            >
              Newer messages
            </button>
            <span className="text-xs text-muted-foreground">
              Message page {detail.data.messagesPage}
              {messagesPage === 1 ? " · newest messages" : ""}
            </span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={!detail.data.moreMessages || detail.isFetching || mutationPending}
              onClick={() => onMessagesPage(messagesPage + 1)}
            >
              Older messages
            </button>
          </div>
          {!!detail.data.escalations?.length && (
            <section aria-label="Content review referrals">
              <h4 className="text-sm font-semibold">Content review referrals</h4>
              <ul className="mt-3 grid gap-3">
                {detail.data.escalations.map((item) => (
                  <li key={item.id} className="rounded-xl border border-border p-4 text-sm">
                    <p className="[overflow-wrap:anywhere]">
                      <strong>{item.status.replaceAll("_", " ")}</strong> · {targetKindNames[item.targetKind]}{" "}
                      · {item.targetId}
                    </p>
                    <p className="mt-2 whitespace-pre-wrap [overflow-wrap:anywhere]">{item.reason}</p>
                    <p className="mt-2 text-xs text-muted-foreground">{formatDateTime(item.createdAt)}</p>
                  </li>
                ))}
              </ul>
              {detail.data.escalationsTruncated && (
                <p className="mt-3 text-xs text-muted-foreground">
                  Only the most recent referrals are shown. Earlier referral evidence remains in the audit
                  records.
                </p>
              )}
            </section>
          )}
          {!!detail.data.events?.length && (
            <details className="border-t border-border pt-4">
              <summary className="cursor-pointer text-sm font-medium">Case operation history</summary>
              <ol className="mt-3 grid gap-3 text-sm" aria-label="Support operation history">
                {detail.data.events.map((item) => (
                  <li key={item.id}>
                    <strong>{item.action.replaceAll("_", " ")}</strong> · {formatDateTime(item.createdAt)}
                    <p className="mt-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                      Recorded actor: {item.actorId}
                    </p>
                  </li>
                ))}
              </ol>
              {detail.data.eventsTruncated && (
                <p className="mt-3 text-xs text-muted-foreground">
                  Only the most recent operation entries are shown. Earlier evidence remains in the audit
                  records.
                </p>
              )}
            </details>
          )}
          <form
            className="grid min-w-0 gap-4 border-t border-border pt-5"
            onSubmit={(e) => {
              e.preventDefault();
              onSubmit();
            }}
          >
            <div className="grid gap-2 text-sm">
              <label htmlFor="support-operation">Operation</label>
              <select
                id="support-operation"
                className="field"
                value={action}
                disabled={fieldsLocked}
                onChange={(e) => onAction(e.target.value as SupportAction)}
              >
                {(Object.keys(SUPPORT_ACTION_LABELS) as SupportAction[]).map((value) => (
                  <option
                    key={value}
                    value={value}
                    disabled={
                      value === "reopen"
                        ? !resolved
                        : value === "escalate_content"
                          ? !mayEscalate || resolved
                          : resolved
                    }
                  >
                    {SUPPORT_ACTION_LABELS[value]}
                  </option>
                ))}
              </select>
            </div>
            {resolved && action !== "reopen" && (
              <p className="text-sm">
                This case is resolved. Choose “Reopen with a reason” before further operations.
              </p>
            )}
            {action === "assign" ? (
              <div className="grid gap-3">
                <div className="grid gap-2 text-sm">
                  <label htmlFor="support-assignee">Active support staff identity</label>
                  <select
                    id="support-assignee"
                    className="field"
                    value={assignee}
                    disabled={fieldsLocked || assignees.isFetching || assignees.isError}
                    onChange={(e) => onAssignee(e.target.value)}
                    required
                  >
                    <option value="">Choose an authorised support identity</option>
                    {assignees.data?.assignees.map((item) => (
                      <option key={item.identityId} value={item.identityId}>
                        {item.identityId}
                      </option>
                    ))}
                  </select>
                </div>
                {assignees.isLoading && (
                  <p role="status" className="text-sm">
                    Loading active support staff…
                  </p>
                )}
                {assignees.isError && (
                  <ErrorState error={assignees.error} onRetry={() => void assignees.refetch()} />
                )}
                {!assignees.isLoading && !assignees.isError && !assignees.data?.assignees.length && (
                  <p className="text-sm">
                    No active support identities were returned. Assignment is unavailable.
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Only existing active support identities can be assigned. This does not grant a staff role.
                </p>
              </div>
            ) : (
              <>
                <div className="grid gap-2 text-sm">
                  <label htmlFor="support-operation-body">
                    {action === "reply"
                      ? row.sourceKind === "access"
                        ? "Reply text to save internally"
                        : "Reply for the customer portal"
                      : "Reason and relevant scope"}
                  </label>
                  <textarea
                    id="support-operation-body"
                    className="field min-h-32"
                    value={body}
                    onChange={(e) => onBody(e.target.value)}
                    disabled={fieldsLocked}
                    required
                    minLength={8}
                    maxLength={4000}
                    aria-describedby="support-operation-body-hint"
                  />
                </div>
                <p id="support-operation-body-hint" className="text-xs text-muted-foreground">
                  8–4,000 characters. Do not add passwords, payment credentials or identity documents.
                  {action === "reply" &&
                    (row.sourceKind === "access"
                      ? " This anonymous case has no customer portal. The reply is stored internally and is not sent to the email address."
                      : " This reply appears in the signed-in customer portal. It is not emailed.")}
                </p>
              </>
            )}
            {action === "escalate_content" && (
              <>
                <div className="grid gap-2 text-sm">
                  <label htmlFor="support-target-kind">Review target</label>
                  <select
                    id="support-target-kind"
                    className="field"
                    value={targetKind}
                    disabled={fieldsLocked}
                    onChange={(e) => onTargetKind(e.target.value as SupportTargetKind)}
                  >
                    {(Object.keys(targetKindNames) as SupportTargetKind[]).map((kind) => (
                      <option key={kind} value={kind}>
                        {targetKindNames[kind]}
                      </option>
                    ))}
                  </select>
                </div>
                {targetKind === "library" ? (
                  // A library entry is chosen by its title (docs/architecture/library-holds.md, slice 3).
                  <LibraryEntryChooser value={targetId} onChoose={onTargetId} disabled={fieldsLocked} />
                ) : (
                  <div className="grid gap-2 text-sm">
                    <label htmlFor="support-target-id">Existing target record UUID</label>
                    <input
                      id="support-target-id"
                      className="field font-mono text-sm"
                      value={targetId}
                      onChange={(e) => onTargetId(e.target.value)}
                      disabled={fieldsLocked}
                      required
                      autoComplete="off"
                      maxLength={36}
                      pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
                    />
                  </div>
                )}
                <p className="rounded-xl bg-secondary p-3 text-sm">
                  Internal content triage creates a queue item for authorised content staff. Include only the
                  issue and relevant version details; leave out contact details and private document text.
                  This does not share externally, contact an adviser, place a hold or change publication.
                </p>
              </>
            )}
            {!mayEscalate && (
              <p className="text-xs text-muted-foreground">
                Internal content triage is available for workspace cases. Anonymous account-access cases
                cannot use this path.
              </p>
            )}
            <div className="flex flex-wrap gap-3">
              <button
                className="btn btn-primary btn-sm"
                disabled={operationLocked || !actionAllowed || !validInput}
              >
                {mutationPending
                  ? "Saving operation…"
                  : action === "reply"
                    ? row.sourceKind === "access"
                      ? "Save internal reply · no delivery"
                      : "Save reply to customer portal"
                    : SUPPORT_ACTION_LABELS[action]}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={fieldsLocked}
                onClick={onDiscard}
              >
                Discard unsaved details
              </button>
            </div>
          </form>
        </div>
      )}
      {Boolean(mutationError) && (
        <div className="mt-4">
          <ErrorState
            error={mutationError}
            title={conflict ? "This case changed" : "Operation was not confirmed"}
          />
        </div>
      )}
      {conflict && (
        <p className="mt-3 text-sm" role="status">
          Your operation details are preserved. Reload the latest case, review its version and history, then
          apply the operation again.
        </p>
      )}
      {uncertain && (
        <div className="mt-3 rounded-xl border border-border p-4 text-sm" role="status">
          <p>
            The save result is unknown. Retry this same operation safely using its original request reference
            before editing another operation.
          </p>
          <button
            type="button"
            className="btn btn-ghost btn-sm mt-3"
            disabled={mutationPending || !canRetryUncertain}
            onClick={onRetryUncertain}
          >
            Retry the same operation
          </button>
        </div>
      )}
      {saved && (
        <p className="mt-4 text-sm" role="status">
          {saved}
        </p>
      )}
    </section>
  );
}
