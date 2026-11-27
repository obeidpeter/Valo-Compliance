import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccountEpoch } from "./account-state-boundary";
import { ErrorState } from "./states";
import { formatDateTime } from "@/lib/format";
import { useUnsavedNavigation } from "@/lib/use-unsaved-navigation";
import { supportStatusWords, supportTopic } from "@/lib/support-words";
import {
  getSupportCase,
  listSupportCases,
  replyToSupportCase,
  supportAttempt,
  supportCaseKeys,
  supportErrorStatus,
  uncertainSupportResult,
  type SupportCaseDetail,
  type SupportMessage,
  type SupportReplyInput,
} from "@/lib/support-case-api";

export function SupportDraftGuard({ dirty, onDiscard }: { dirty: boolean; onDiscard: () => void }) {
  const nav = useUnsavedNavigation(() => dirty);
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  useEffect(() => {
    if (nav.blocked && !dialog.current?.open) dialog.current?.showModal();
    else if (!nav.blocked) dialog.current?.close();
  }, [nav.blocked]);
  return (
    <dialog
      ref={dialog}
      className="max-w-md rounded-2xl border border-border bg-background p-6 text-foreground shadow-xl backdrop:bg-black/40"
      aria-labelledby={heading}
      onCancel={(e) => {
        e.preventDefault();
        nav.stay();
      }}
    >
      <h2 id={heading} className="font-display text-2xl">
        Leave unsaved support details?
      </h2>
      <p className="mt-3 text-sm">
        Your draft is kept in this tab. Stay to review it, or discard it before leaving. Leaving does not
        cancel a request already being saved.
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        <button type="button" className="btn btn-primary btn-sm" autoFocus onClick={nav.stay}>
          Stay and review
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => {
            onDiscard();
            nav.proceed();
          }}
        >
          Discard draft and leave
        </button>
      </div>
    </dialog>
  );
}

export function SupportMessages({
  messages,
  staff = false,
}: {
  messages: SupportMessage[];
  staff?: boolean;
}) {
  // The customer endpoint excludes internal messages; this also prevents an
  // unexpected internal message from being rendered by the customer component.
  const visible = staff ? messages : messages.filter((message) => message.visibility === "customer");
  return (
    <section aria-label={staff ? "Case conversation and saved notes" : "Case conversation"}>
      <h3 className="text-sm font-semibold">Conversation</h3>
      {!visible.length ? (
        <p className="mt-2 text-sm text-muted-foreground">
          {staff ? "No replies have been saved yet." : "No replies yet."}
        </p>
      ) : (
        <ol className="mt-3 grid gap-3">
          {visible.map((message) => (
            <li key={message.id} className="min-w-0 rounded-xl border border-border p-4">
              <p className="text-xs text-muted-foreground">
                {message.authorKind === "staff" ? "Valo staff" : staff ? "Customer" : "You"} ·{" "}
                {formatDateTime(message.createdAt)}
                {staff &&
                  ` · ${message.visibility === "internal" ? "Internal record · not sent" : "Customer portal"}`}
              </p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed [overflow-wrap:anywhere]">
                {message.body}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function CustomerSupportCases() {
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [messagesPage, setMessagesPage] = useState(1);
  const [body, setBody] = useState("");
  const [saved, setSaved] = useState(false);
  const attempt = useRef<ReturnType<typeof supportAttempt<Omit<SupportReplyInput, "idempotencyKey">>> | null>(
    null,
  );
  const accountActive = useAccountEpoch();
  const client = useQueryClient();
  const list = useQuery({
    queryKey: [...supportCaseKeys.list(false), page],
    queryFn: ({ signal }) => listSupportCases(false, page, "all", signal),
    retry: false,
  });
  const detail = useQuery({
    queryKey: supportCaseKeys.detail(false, selected ?? "", messagesPage),
    queryFn: ({ signal }) => getSupportCase(false, selected!, messagesPage, signal),
    enabled: !!selected,
    retry: false,
  });
  const mutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: SupportReplyInput }) => replyToSupportCase(id, input),
    onSuccess: (result: SupportCaseDetail) => {
      if (!accountActive()) return;
      client.setQueryData(supportCaseKeys.detail(false, result.case.id), result);
      setMessagesPage(1);
      setBody("");
      setSaved(true);
      attempt.current = null;
      void client.invalidateQueries({ queryKey: ["support-case", "customer", result.case.id] });
      void client.invalidateQueries({ queryKey: supportCaseKeys.list(false) });
    },
  });
  const uncertain = uncertainSupportResult(mutation.error);
  const conflict = supportErrorStatus(mutation.error) === 409;
  const dirty = !!body.trim() || mutation.isPending || uncertain;
  const row = detail.data?.case;
  const denied = [401, 403].includes(supportErrorStatus(list.error) ?? 0);
  const detailDenied = [401, 403, 404].includes(supportErrorStatus(detail.error) ?? 0);
  const locked = mutation.isPending || uncertain || conflict || detail.isFetching || detail.isError || !row;
  const discard = () => {
    setBody("");
    setSaved(false);
    mutation.reset();
    attempt.current = null;
  };
  async function reloadDetail() {
    const result = await detail.refetch();
    if (!accountActive() || result.isError) return;
    // A conflict requires review of the new version before another write.
    if (!uncertain) {
      mutation.reset();
      attempt.current = null;
    }
  }
  function submit() {
    if (!selected || !row || locked || body.trim().length < 8) return;
    attempt.current = supportAttempt(attempt.current, { expectedVersion: row.version, body: body.trim() });
    setSaved(false);
    mutation.mutate({ id: selected, input: attempt.current.input });
  }
  return (
    <section
      className="min-w-0 lg:col-span-2"
      aria-labelledby="customer-support-heading"
      data-testid="customer-support-cases"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="customer-support-heading" className="font-display text-3xl">
            Your support requests
          </h2>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            Read staff replies and add to a request here. Replies are kept on this page. Valo does not email
            them yet, so come back here to read them.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={list.isFetching || mutation.isPending}
          onClick={() => void list.refetch()}
        >
          Refresh requests
        </button>
      </div>
      {list.isLoading && (
        <p role="status" className="mt-5">
          Loading your support requests…
        </p>
      )}
      {list.isError && (
        <div className="mt-5">
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        </div>
      )}
      {!denied && list.data && (
        <>
          {!list.data.cases.length && (
            <p className="mt-5 text-sm">
              No requests on this page. To make one, use the form above, then refresh this list.
            </p>
          )}
          <ul className="mt-5 grid gap-3 sm:grid-cols-2">
            {list.data.cases.map((item) => (
              <li key={item.id} className="surface min-w-0 p-5">
                <h3 className="break-all font-mono text-sm">{item.reference}</h3>
                <p className="mt-2 text-sm">
                  {supportTopic(item.category)} · <strong>{supportStatusWords(item.status)}</strong>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">Updated {formatDateTime(item.updatedAt)}</p>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm mt-4"
                  aria-pressed={selected === item.id}
                  disabled={dirty && selected !== item.id}
                  onClick={() => {
                    if (selected !== item.id) {
                      discard();
                      setMessagesPage(1);
                      setSelected(item.id);
                    }
                  }}
                >
                  View conversation
                </button>
              </li>
            ))}
          </ul>
          <div
            className="mt-4 flex flex-wrap items-center gap-3"
            role="group"
            aria-label="Support request pages"
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
        <section
          className="surface mt-6 min-w-0 p-5 sm:p-7"
          aria-labelledby="customer-support-detail-heading"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h3 id="customer-support-detail-heading" className="font-display break-all text-2xl">
              {!detailDenied && row ? row.reference : "Support conversation"}
            </h3>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={detail.isFetching || mutation.isPending}
              onClick={() => void reloadDetail()}
            >
              Reload latest conversation
            </button>
          </div>
          {detail.isLoading && (
            <p className="mt-4" role="status">
              Loading the conversation…
            </p>
          )}
          {detail.isError && (
            <div className="mt-4">
              <ErrorState error={detail.error} onRetry={() => void reloadDetail()} />
            </div>
          )}
          {!detailDenied && detail.data && row && (
            <div className="mt-4 grid gap-5">
              <p className="text-sm">
                <strong>{supportStatusWords(row.status)}</strong>
              </p>
              <div>
                <h4 className="text-sm font-semibold">Original request</h4>
                <p className="mt-2 whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{row.scope}</p>
              </div>
              <p className="rounded-xl bg-secondary p-3 text-sm">
                A reply here is not an appointment or a professional review. Nothing is emailed, and your
                request is not passed to anyone outside Valo.
              </p>
              <SupportMessages messages={detail.data.messages} />
              <div
                className="flex flex-wrap items-center gap-3"
                role="group"
                aria-label="Customer support conversation pages"
              >
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={messagesPage === 1 || detail.isFetching || mutation.isPending}
                  onClick={() => setMessagesPage(messagesPage - 1)}
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
                  disabled={!detail.data.moreMessages || detail.isFetching || mutation.isPending}
                  onClick={() => setMessagesPage(messagesPage + 1)}
                >
                  Older messages
                </button>
              </div>
              <form
                className="grid gap-3 border-t border-border pt-5"
                onSubmit={(e) => {
                  e.preventDefault();
                  submit();
                }}
              >
                <label htmlFor="support-customer-reply" className="text-sm font-medium">
                  Add information to this request
                </label>
                <textarea
                  id="support-customer-reply"
                  className="field min-h-32"
                  value={body}
                  onChange={(e) => {
                    setBody(e.target.value);
                    setSaved(false);
                  }}
                  disabled={mutation.isPending || uncertain}
                  minLength={8}
                  maxLength={4000}
                  required
                  aria-describedby="support-customer-reply-hint"
                />
                <p id="support-customer-reply-hint" className="text-xs text-muted-foreground">
                  8 to 4,000 characters. Do not include passwords, card or bank details, or identity
                  documents.
                  {row.status === "resolved" && " Adding information opens this resolved request again."}
                </p>
                <div className="flex flex-wrap gap-3">
                  <button className="btn btn-primary btn-sm" disabled={locked || body.trim().length < 8}>
                    {mutation.isPending ? "Saving reply…" : "Save reply"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={mutation.isPending || uncertain || !body}
                    onClick={discard}
                  >
                    Discard unsaved reply
                  </button>
                </div>
              </form>
            </div>
          )}
          {mutation.isError && (
            <div className="mt-4">
              <ErrorState
                error={mutation.error}
                title={conflict ? "This request changed" : "Your reply was not confirmed"}
              />
            </div>
          )}
          {conflict && (
            <p className="mt-3 text-sm" role="status">
              Your reply is still here. Reload the conversation, read what changed, then save again.
            </p>
          )}
          {uncertain && (
            <div className="mt-3 rounded-xl border border-border p-4 text-sm" role="status">
              <p>
                Valo could not confirm whether your reply was saved. Try the same reply again: it is saved
                once, not twice.
              </p>
              <button
                type="button"
                className="btn btn-ghost btn-sm mt-3"
                disabled={mutation.isPending || !attempt.current || !selected}
                onClick={() => {
                  if (selected && attempt.current)
                    mutation.mutate({ id: selected, input: attempt.current.input });
                }}
              >
                Retry the same reply
              </button>
            </div>
          )}
          {saved && (
            <p className="mt-4 text-sm" role="status">
              Your reply is saved with this request. It was not emailed.
            </p>
          )}
        </section>
      )}
      {dirty && (
        <p className="mt-3 text-sm text-muted-foreground">
          Save or discard your reply before you open another request or change pages.
        </p>
      )}
      <SupportDraftGuard dirty={dirty} onDiscard={discard} />
    </section>
  );
}
