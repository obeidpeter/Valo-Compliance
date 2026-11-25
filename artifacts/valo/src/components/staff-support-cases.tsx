import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccountEpoch } from "./account-state-boundary";
import { ErrorState } from "./states";
import { StaffSupportCaseDetail } from "./staff-support-case-detail";
import { SupportDraftGuard } from "./support-cases";
import { formatDateTime } from "@/lib/format";
import {
  actOnSupportCase,
  getSupportCase,
  listSupportAssignees,
  listSupportCases,
  supportAttempt,
  supportCaseKeys,
  supportErrorStatus,
  uncertainSupportResult,
  type SupportAction,
  type SupportCaseDetail,
  type SupportStaffInput,
  type SupportStatus,
  type SupportTargetKind,
} from "@/lib/support-case-api";

const statuses: (SupportStatus | "all")[] = ["all", "open", "in_progress", "awaiting_customer", "resolved"];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function StaffSupportCases({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void }) {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<SupportStatus | "all">("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [messagesPage, setMessagesPage] = useState(1);
  const [action, setAction] = useState<SupportAction>("reply");
  const [body, setBody] = useState("");
  const [assignee, setAssignee] = useState("");
  const [targetKind, setTargetKind] = useState<SupportTargetKind>("content");
  const [targetId, setTargetId] = useState("");
  const [saved, setSaved] = useState("");
  const attempt = useRef<ReturnType<typeof supportAttempt<Omit<SupportStaffInput, "idempotencyKey">>> | null>(
    null,
  );
  const accountActive = useAccountEpoch();
  const client = useQueryClient();
  const list = useQuery({
    queryKey: [...supportCaseKeys.list(true), status, page],
    queryFn: ({ signal }) => listSupportCases(true, page, status, signal),
    retry: false,
  });
  const detail = useQuery({
    queryKey: supportCaseKeys.detail(true, selected ?? "", messagesPage),
    queryFn: ({ signal }) => getSupportCase(true, selected!, messagesPage, signal),
    enabled: !!selected,
    retry: false,
  });
  const assignees = useQuery({
    queryKey: supportCaseKeys.assignees,
    queryFn: ({ signal }) => listSupportAssignees(signal),
    enabled: !!selected,
    retry: false,
  });
  const mutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: SupportStaffInput }) => actOnSupportCase(id, input),
    onSuccess: (result: SupportCaseDetail, submitted) => {
      if (!accountActive()) return;
      client.setQueryData(supportCaseKeys.detail(true, result.case.id), result);
      setMessagesPage(1);
      setBody("");
      setAssignee("");
      setTargetId("");
      attempt.current = null;
      setSaved(
        submitted.input.action === "reply"
          ? result.case.sourceKind === "access"
            ? "Reply saved as an internal record. Nothing was sent to the contact email."
            : "Reply saved in the customer portal. It was not emailed."
          : submitted.input.action === "escalate_content"
            ? "Content review was queued. No hold or publication change was made."
            : "Case operation saved.",
      );
      void client.invalidateQueries({ queryKey: supportCaseKeys.list(true) });
      void client.invalidateQueries({ queryKey: ["support-case", "staff", result.case.id] });
    },
  });
  const uncertain = uncertainSupportResult(mutation.error);
  const conflict = supportErrorStatus(mutation.error) === 409;
  const dirty = !!body.trim() || !!assignee || !!targetId.trim() || mutation.isPending || uncertain;
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(
    () => () => {
      onDirtyChange?.(false);
    },
    [onDirtyChange],
  );
  const denied = [401, 403].includes(supportErrorStatus(list.error) ?? 0);
  const detailDenied = [401, 403, 404].includes(supportErrorStatus(detail.error) ?? 0);
  const row = detail.data?.case;
  const resolved = row?.status === "resolved";
  const mayEscalate = row?.sourceKind === "workspace";
  const actionAllowed =
    !!row &&
    (action === "reopen" ? resolved : action === "escalate_content" ? mayEscalate && !resolved : !resolved);
  const fieldsLocked = mutation.isPending || uncertain;
  const operationLocked = fieldsLocked || conflict || detail.isFetching || detail.isError || !row;
  const validInput =
    action === "assign"
      ? !assignees.isError && !!assignees.data?.assignees.some((item) => item.identityId === assignee)
      : body.trim().length >= 8 && (action !== "escalate_content" || uuid.test(targetId.trim()));
  function discard() {
    setBody("");
    setAssignee("");
    setTargetId("");
    setSaved("");
    mutation.reset();
    attempt.current = null;
  }
  async function reloadDetail() {
    const result = await detail.refetch();
    if (!accountActive() || result.isError) return;
    if (!uncertain) {
      mutation.reset();
      attempt.current = null;
    }
  }
  function submit() {
    if (!selected || !row || operationLocked || !actionAllowed || !validInput) return;
    const input: Omit<SupportStaffInput, "idempotencyKey"> = {
      expectedVersion: row.version,
      action,
      ...(action === "assign" ? { assigneeId: assignee } : { body: body.trim() }),
      ...(action === "escalate_content" ? { targetKind, targetId: targetId.trim() } : {}),
    };
    attempt.current = supportAttempt(attempt.current, input);
    setSaved("");
    mutation.mutate({ id: selected, input: attempt.current.input });
  }
  return (
    <section
      className="mt-6 min-w-0"
      aria-labelledby="staff-support-heading"
      data-testid="staff-support-cases"
    >
      <h2 id="staff-support-heading" className="font-display text-3xl">
        Support case operations
      </h2>
      <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
        Assignment, portal replies, resolution and content-review referrals are recorded here. Each operation
        requires an active support role and recent multi-factor verification.
      </p>
      <div className="mt-5 flex flex-wrap items-end gap-3">
        <div className="grid gap-2 text-sm">
          <label htmlFor="support-status-filter">Case status</label>
          <select
            id="support-status-filter"
            className="field"
            value={status}
            disabled={dirty || list.isFetching}
            onChange={(e) => {
              setStatus(e.target.value as SupportStatus | "all");
              setPage(1);
              setSelected(null);
              discard();
            }}
          >
            {statuses.map((value) => (
              <option key={value} value={value}>
                {value === "all" ? "All cases" : value.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={list.isFetching || mutation.isPending}
          onClick={() => void list.refetch()}
        >
          Refresh support queue
        </button>
      </div>
      {list.isLoading && (
        <p role="status" className="mt-5">
          Loading support cases…
        </p>
      )}
      {list.isError && (
        <div className="mt-5">
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
          {supportErrorStatus(list.error) === 403 && (
            <Link href="/workspace/account" className="mt-3 inline-block text-sm underline">
              Manage sign-in security
            </Link>
          )}
        </div>
      )}
      {!denied && list.data && (
        <>
          <p className="mt-4 rounded-xl bg-secondary p-3 text-sm">{list.data.notice}</p>
          {!list.data.cases.length && (
            <p className="mt-5 text-sm">No cases match this status on this page.</p>
          )}
          <ul className="mt-5 grid gap-3 lg:grid-cols-2">
            {list.data.cases.map((item) => (
              <li key={item.id} className="surface min-w-0 p-5">
                <h3 className="break-all font-mono text-sm">{item.reference}</h3>
                <p className="mt-2 text-sm">
                  {item.sourceKind === "access" ? "Account access" : "Workspace"} ·{" "}
                  {item.category.replaceAll("_", " ")} · <strong>{item.status.replaceAll("_", " ")}</strong>
                </p>
                <p className="mt-2 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                  {item.assignedTo ? `Assigned to ${item.assignedTo}` : "Unassigned"} · Updated{" "}
                  {formatDateTime(item.updatedAt)}
                </p>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm mt-4"
                  aria-pressed={selected === item.id}
                  disabled={dirty && selected !== item.id}
                  onClick={() => {
                    if (selected !== item.id) {
                      discard();
                      setAction("reply");
                      setMessagesPage(1);
                      setSelected(item.id);
                    }
                  }}
                >
                  Open case operations
                </button>
              </li>
            ))}
          </ul>
          <div
            className="mt-4 flex flex-wrap items-center gap-3"
            role="group"
            aria-label="Staff support queue pages"
          >
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={page === 1 || dirty || list.isFetching}
              onClick={() => {
                setPage(page - 1);
                setSelected(null);
              }}
            >
              Previous
            </button>
            <span className="text-sm">Page {list.data.page}</span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={!list.data.hasMore || dirty || list.isFetching}
              onClick={() => {
                setPage(page + 1);
                setSelected(null);
              }}
            >
              Next
            </button>
          </div>
        </>
      )}
      {!denied && selected && (
        <StaffSupportCaseDetail
          detail={detail}
          detailDenied={detailDenied}
          assignees={assignees}
          messagesPage={messagesPage}
          onMessagesPage={setMessagesPage}
          action={action}
          onAction={(nextAction) => {
            setAction(nextAction);
            setSaved("");
          }}
          body={body}
          onBody={setBody}
          assignee={assignee}
          onAssignee={setAssignee}
          targetKind={targetKind}
          onTargetKind={(kind) => {
            // An identifier chosen for one kind of target never carries over to another.
            setTargetKind(kind);
            setTargetId("");
          }}
          targetId={targetId}
          onTargetId={setTargetId}
          fieldsLocked={fieldsLocked}
          operationLocked={operationLocked}
          actionAllowed={actionAllowed}
          validInput={validInput}
          mutationPending={mutation.isPending}
          mutationError={mutation.isError ? mutation.error : null}
          conflict={conflict}
          uncertain={uncertain}
          canRetryUncertain={Boolean(attempt.current && selected)}
          saved={saved}
          onReload={() => void reloadDetail()}
          onSubmit={submit}
          onDiscard={discard}
          onRetryUncertain={() => {
            if (selected && attempt.current) mutation.mutate({ id: selected, input: attempt.current.input });
          }}
        />
      )}
      {dirty && (
        <p className="mt-4 text-sm text-muted-foreground">
          Save or discard these details before changing staff areas, cases, filters or pages.
        </p>
      )}
      <SupportDraftGuard dirty={dirty} onDiscard={discard} />
    </section>
  );
}
