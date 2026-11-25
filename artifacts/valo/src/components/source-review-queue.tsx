import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListOwnerReviewWorkQueryKey,
  getListSourceReviewQueryKey,
  noteOwnerReviewWork,
  noteSourceReview,
  prepareSourceReview,
  useListOwnerReviewWork,
  useListSourceReview,
  type SourceReviewItem,
} from "@workspace/api-client-react";
import { describeError } from "@/lib/describe-error";
import {
  accountableLine,
  askedMessage,
  closedHeading,
  closedLine,
  emptyQueue,
  heldLine,
  noteButton,
  noteHint,
  noteLabel,
  noteLine,
  openerLine,
  ownerQueueHeading,
  prepareAgainButton,
  prepareButton,
  prepareHint,
  preparationLine,
  preparing,
  queueHeading,
  queueIntro,
  reasonsLine,
} from "@/lib/source-review";
import { ErrorState } from "./states";

const inputStyle = "mt-1 block w-full rounded-lg border border-border bg-background p-2 text-base";

/** What was checked on one open row, recorded by its accountable person. */
function NoteForm({
  item,
  mode,
  onSaved,
}: {
  item: SourceReviewItem;
  mode: "content" | "owner";
  onSaved: (message: string) => void;
}) {
  const client = useQueryClient();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const id = (field: string) => `review-${mode}-${item.id}-${field}`;
  async function save() {
    setBusy(true);
    setError("");
    try {
      const body = { note: note.trim() };
      const queue =
        mode === "owner" ? await noteOwnerReviewWork(item.id, body) : await noteSourceReview(item.id, body);
      client.setQueryData(
        mode === "owner" ? getListOwnerReviewWorkQueryKey() : getListSourceReviewQueryKey(),
        queue,
      );
      setNote("");
      onSaved(`Recorded what was checked on ${item.targetKey}, version ${item.targetVersion}.`);
    } catch (e) {
      setError(describeError(e).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="mt-3 grid gap-3 rounded-lg border border-border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      data-testid={"form-review-" + item.id}
    >
      <label className="text-sm font-medium" htmlFor={id("note")}>
        {noteLabel}
        <textarea
          id={id("note")}
          className={inputStyle}
          rows={2}
          minLength={20}
          maxLength={1000}
          aria-describedby={id("note-help")}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <span id={id("note-help")} className="mt-1 block font-normal text-muted-foreground">
          {noteHint}
        </span>
      </label>
      <button
        type="submit"
        className="btn btn-primary btn-sm justify-self-start"
        disabled={busy || note.trim().length < 20}
      >
        {busy ? "Saving…" : "Save the note"}
      </button>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

/**
 * Where the latest request to prepare a candidate from a row stands, and, on a row with a preparer, the
 * button that asks for one (docs/architecture/source-register.md, slice 4). The worker prepares it; the
 * candidate's reviews wait for an AI allocation the owner approves.
 */
function Preparation({
  item,
  hintId,
  onAsked,
}: {
  item: SourceReviewItem;
  hintId: string;
  onAsked: (message: string) => void;
}) {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const latest = item.preparation;
  async function ask() {
    setBusy(true);
    setError("");
    try {
      client.setQueryData(getListSourceReviewQueryKey(), await prepareSourceReview(item.id));
      onAsked(askedMessage(item));
    } catch (e) {
      setError(describeError(e).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-2 grid gap-1" data-testid={"preparation-" + item.id}>
      {latest && <p>{preparationLine(latest)}</p>}
      {latest && latest.reasons.length > 0 && (
        <p className="text-muted-foreground">{reasonsLine(latest.reasons)}</p>
      )}
      {item.preparable && !preparing(latest) && (
        <button
          type="button"
          className="btn btn-secondary btn-sm justify-self-start"
          aria-describedby={hintId}
          disabled={busy}
          onClick={() => void ask()}
        >
          {busy ? "Asking…" : latest ? prepareAgainButton : prepareButton}
        </button>
      )}
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Review work with its owner (docs/architecture/source-register.md, slice 3): the open rows oldest first,
 * each with the version held, why, since when, what opened it, who is accountable and what was checked,
 * and the rows closed lately. Content staff see every row; the development owner, the rows of the rules
 * the owner signed. A note closes nothing: a later release or a withdrawal does.
 */
export function ReviewQueue({ mode }: { mode: "content" | "owner" }) {
  const content = useListSourceReview({ query: { retry: false, enabled: mode === "content" } });
  const owner = useListOwnerReviewWork({ query: { retry: false, enabled: mode === "owner" } });
  const queue = mode === "owner" ? owner : content;
  const [open, setOpen] = useState("");
  const [message, setMessage] = useState("");
  const headingId = `review-queue-${mode}`;
  const hintId = `review-queue-${mode}-prepare-hint`;
  return (
    <section className="surface mt-8 p-5 sm:p-7" aria-labelledby={headingId}>
      <h2 className="font-display text-2xl" id={headingId}>
        {mode === "owner" ? ownerQueueHeading : queueHeading}
      </h2>
      <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{queueIntro}</p>
      {mode === "content" && (
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground" id={hintId}>
          {prepareHint}
        </p>
      )}
      {queue.isError ? (
        <ErrorState error={queue.error} onRetry={() => void queue.refetch()} />
      ) : !queue.data ? (
        <p className="mt-4 text-sm text-muted-foreground" role="status">
          Reading the review work…
        </p>
      ) : (
        <>
          <p className="mt-2 text-sm" role="status" aria-live="polite">
            {message}
          </p>
          {queue.data.open.length === 0 ? (
            <p className="mt-4 text-sm" data-testid={`text-review-empty-${mode}`}>
              {emptyQueue}
            </p>
          ) : (
            <ul className="mt-4 grid gap-3">
              {queue.data.open.map((item) => (
                <li
                  key={item.id}
                  className="rounded-xl border border-border p-3 text-sm"
                  data-testid={"review-work-" + item.id}
                >
                  <p className="font-medium">{heldLine(item)}</p>
                  <p className="mt-1">{item.reason}</p>
                  <p className="text-muted-foreground">{openerLine(item.opener, item.sourceId)}</p>
                  <p className="text-muted-foreground">{accountableLine(item.accountable)}</p>
                  {(item.preparable || item.preparation) && (
                    <Preparation
                      item={item}
                      hintId={hintId}
                      onAsked={(asked) => {
                        setOpen("");
                        setMessage(asked);
                      }}
                    />
                  )}
                  {item.notes.length > 0 && (
                    <ul className="mt-2 grid gap-1">
                      {item.notes.map((note, index) => (
                        <li key={`${note.createdAt}-${index}`}>{noteLine(note)}</li>
                      ))}
                    </ul>
                  )}
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm mt-2"
                    aria-expanded={open === item.id}
                    onClick={() => {
                      setMessage("");
                      setOpen(open === item.id ? "" : item.id);
                    }}
                  >
                    {open === item.id ? "Close" : noteButton}
                  </button>
                  {open === item.id && (
                    <NoteForm
                      item={item}
                      mode={mode}
                      onSaved={(saved) => {
                        setOpen("");
                        setMessage(saved);
                      }}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
          {queue.data.closed.length > 0 && (
            <>
              <h3 className="mt-6 font-medium">{closedHeading}</h3>
              <ul className="mt-2 grid gap-1 text-sm text-muted-foreground">
                {queue.data.closed.map((item) => (
                  <li key={item.id}>{closedLine(item)}</li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}
