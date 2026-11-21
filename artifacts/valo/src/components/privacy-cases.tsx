import { useState, useEffect, useRef } from "react";
import {
  useListPrivacyCases,
  useGetPrivacyCase,
  useVerifyPrivacyCase,
  useCancelPrivacyCase,
  useRespondPrivacyCase,
  getDownloadPrivacyCaseResultUrl,
  type PrivacyCase,
} from "@workspace/api-client-react";
import { ErrorState } from "./states";
import { formatDateTime } from "@/lib/format";
import { useUnsavedNavigation } from "@/lib/use-unsaved-navigation";
import {
  privacyActionWords,
  privacyActorWords,
  privacyKindWords,
  privacyStatusWords,
  privacyStepStatusWords,
  privacyStepWords,
} from "@/lib/privacy-words";
export function PrivacyCases() {
  const cases = useListPrivacyCases();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const nav = useUnsavedNavigation(() => Object.values(drafts).some((text) => !!text.trim()));
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (nav.blocked) dialog.current?.showModal();
    else dialog.current?.close();
  }, [nav.blocked]);
  return (
    <section className="mt-8" aria-labelledby="privacy-cases-heading">
      <h2 id="privacy-cases-heading" className="font-display text-2xl">
        Your privacy requests
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Confirming a request, giving it to staff and carrying it out are separate steps. A request that is
        received, or partly done, is not a confirmed deletion, and is not a complete copy from every service
        Valo uses.
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        Up to 100 recent requests are shown. You can still read and answer your own requests after a deletion
        has restricted your workspace. That does not give back access to your business data.
      </p>
      {cases.isLoading && (
        <p role="status" className="mt-4">
          Loading your requests…
        </p>
      )}
      {cases.isError && <ErrorState error={cases.error} onRetry={() => cases.refetch()} />}
      {cases.data?.length === 0 && (
        <p className="mt-4 text-sm text-muted-foreground">
          No privacy requests yet. Older requests, saved only as support messages, are listed further down.
        </p>
      )}
      <ul className="mt-5 grid gap-4">
        {cases.data?.map((request) => (
          <li key={request.id}>
            <PrivacyCaseCard
              request={request}
              replyText={drafts[request.id] ?? ""}
              onReplyText={(text) => setDrafts((old) => ({ ...old, [request.id]: text }))}
              onChanged={async () => {
                await cases.refetch();
              }}
            />
          </li>
        ))}
      </ul>
      <dialog
        ref={dialog}
        className="max-w-md rounded-2xl border border-border bg-background p-6 text-foreground shadow-xl backdrop:bg-black/40"
        aria-labelledby="privacy-reply-leave-heading"
        onCancel={(e) => {
          e.preventDefault();
          nav.stay();
        }}
      >
        <h3 id="privacy-reply-leave-heading" className="font-display text-2xl">
          Leave an unsent reply?
        </h3>
        <p className="mt-3 text-sm">Your information has not been sent. Stay to send it, or discard it.</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <button className="btn btn-primary btn-sm" autoFocus onClick={nav.stay}>
            Stay
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setDrafts({});
              nav.proceed();
            }}
          >
            Discard and leave
          </button>
        </div>
      </dialog>
    </section>
  );
}
function PrivacyCaseCard({
  request,
  onChanged,
  replyText,
  onReplyText,
}: {
  request: PrivacyCase;
  onChanged: () => Promise<void>;
  replyText: string;
  onReplyText: (text: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [ack, setAck] = useState(false);
  const detail = useGetPrivacyCase(request.id, { query: { enabled: open } });
  const refresh = async () => {
    setAck(false);
    await Promise.all([detail.refetch(), onChanged()]);
  };
  const verify = useVerifyPrivacyCase({ mutation: { onSuccess: refresh } });
  const cancel = useCancelPrivacyCase({ mutation: { onSuccess: refresh } });
  const respond = useRespondPrivacyCase({
    mutation: {
      onSuccess: async () => {
        onReplyText("");
        await refresh();
      },
    },
  });
  const row = detail.data?.request ?? request,
    busy = verify.isPending || cancel.isPending || respond.isPending;
  const mayVerify = !row.verifiedAt && ["awaiting_verification", "needs_information"].includes(row.status);
  const begun = detail.data?.events.some((event) => event.action === "erasure_quarantined") ?? false;
  const mayCancel =
    !!detail.data &&
    !begun &&
    ["awaiting_verification", "verified", "assigned", "needs_information", "held", "failed"].includes(
      row.status,
    );
  return (
    <article className="surface min-w-0 p-5" data-testid="privacy-case">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="break-words font-medium">{row.reference}</h3>
          <p className="mt-1 text-sm">
            {privacyKindWords(row.kind)} · <strong>{privacyStatusWords(row.status)}</strong>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Made {formatDateTime(row.createdAt)} ·{" "}
            {row.assigned ? "With privacy staff" : "Not yet with staff"}
          </p>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          aria-expanded={open}
          aria-controls={`privacy-${row.id}`}
          onClick={() => setOpen(!open)}
        >
          {open ? "Hide request" : "View request"}
        </button>
      </div>
      {open && (
        <div id={`privacy-${row.id}`} className="mt-5 grid gap-4">
          <p className="whitespace-pre-wrap break-words text-sm">{row.message}</p>
          <p className="rounded-xl bg-accent/50 p-3 text-sm">{row.resultScope}</p>
          {begun && (
            <p className="text-sm text-muted-foreground">
              Work on this request has begun, so it cannot be cancelled as though no data had been removed.
              You can still read this request and answer a question from staff. Doing so does not give back
              workspace access, or confirm that the request is done.
            </p>
          )}
          {detail.data?.mayRespond && (
            <form
              className="grid gap-3 rounded-xl border border-border p-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (replyText.trim().length >= 10 && !busy)
                  respond.mutate({
                    id: row.id,
                    data: { expectedVersion: row.version, message: replyText.trim() },
                  });
              }}
            >
              <label className="grid gap-2 text-sm" htmlFor={`privacy-reply-${row.id}`}>
                More information for this request
                <textarea
                  id={`privacy-reply-${row.id}`}
                  className="field min-h-28"
                  value={replyText}
                  onChange={(e) => onReplyText(e.target.value)}
                  minLength={10}
                  maxLength={4000}
                  required
                  disabled={busy}
                />
              </label>
              <p className="text-xs text-muted-foreground">
                Read the question from staff in the history below. A reply does not confirm who you are, or
                that the request is done. Do not include passwords or identity documents.
              </p>
              <div className="flex flex-wrap gap-3">
                <button className="btn btn-primary btn-sm" disabled={busy || replyText.trim().length < 10}>
                  {respond.isPending ? "Sending information…" : "Send information"}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={busy}
                  onClick={() => onReplyText("")}
                >
                  Discard unsent reply
                </button>
              </div>
            </form>
          )}
          {respond.isError && <ErrorState error={respond.error} />}
          {respond.isSuccess && (
            <p role="status" className="text-sm">
              Your information is saved with this request. The request is not confirmed as done.
            </p>
          )}
          {!!detail.data?.messages?.length && (
            <ul className="grid gap-3 text-sm" aria-label="Information you supplied">
              {detail.data.messages.map((m) => (
                <li key={m.id} className="rounded-xl border border-border p-3">
                  <p className="text-xs text-muted-foreground">{formatDateTime(m.createdAt)}</p>
                  <p className="mt-2 whitespace-pre-wrap break-words">{m.body}</p>
                </li>
              ))}
            </ul>
          )}
          {detail.isError && <ErrorState error={detail.error} onRetry={() => detail.refetch()} />}
          {detail.isLoading && <p role="status">Loading this request's history…</p>}
          {detail.data?.steps.length !== 0 && (
            <ul className="grid gap-2 text-sm" aria-label="Steps of this request">
              {detail.data?.steps.map((step) => (
                <li key={step.system} className="rounded-xl border border-border p-3">
                  <strong>
                    {privacyStepWords(step.system)}: {privacyStepStatusWords(step.status)}
                  </strong>
                  <p className="mt-1 whitespace-pre-wrap break-words">{step.detail}</p>
                </li>
              ))}
            </ul>
          )}
          {mayVerify && (
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                checked={ack}
                disabled={busy}
                onChange={(e) => setAck(e.target.checked)}
              />
              <span>
                I confirm that this is my business's request, and I want Valo to check that I am the signed-in
                owner. This does not confirm that the request is done.
              </span>
            </label>
          )}
          <div className="flex flex-wrap gap-3">
            {mayVerify && (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={!ack || busy}
                onClick={() =>
                  verify.mutate({ id: row.id, data: { expectedVersion: row.version, acknowledgement: true } })
                }
              >
                {verify.isPending ? "Confirming…" : "Confirm my request"}
              </button>
            )}
            {mayCancel && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={busy}
                onClick={() =>
                  cancel.mutate({ id: row.id, data: { expectedVersion: row.version, acknowledgement: true } })
                }
              >
                Cancel before work begins
              </button>
            )}
            {row.resultAvailable && (
              <a className="btn btn-ghost btn-sm" href={getDownloadPrivacyCaseResultUrl(row.id)} download>
                Download the result
              </a>
            )}
          </div>
          {verify.isError && <ErrorState error={verify.error} />}
          {cancel.isError && <ErrorState error={cancel.error} />}
          {!!detail.data?.events.length && (
            <ol className="grid gap-2 border-t border-border pt-4 text-sm" aria-label="Request history">
              {detail.data.events.map((event) => (
                <li key={event.sequence}>
                  <strong>{privacyActionWords(event.action)}</strong> · {privacyActorWords(event.actorType)} ·{" "}
                  {formatDateTime(event.createdAt)}
                  <p className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">{event.reason}</p>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </article>
  );
}
