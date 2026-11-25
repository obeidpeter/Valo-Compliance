import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListAcceptanceRunQueryKey,
  recordAcceptanceRunDecision,
  useListAcceptanceRun,
  type AcceptanceRunCase,
} from "@workspace/api-client-react";
import { ErrorState, Skel } from "@/components/states";
import { describeError } from "@/lib/describe-error";
import {
  decideButton,
  keptRunLine,
  metLabel,
  noDecision,
  noRun,
  notMetLabel,
  nothingKept,
  reasonLabel,
  recordedRunMessage,
  runAnswerLegend,
  runCaseStatusLine,
  runDecisionLine,
  runIntro,
  runReasonHint,
  runStatusesLine,
  runTallyLine,
  saveButton,
  staleCase,
  type AcceptanceCorpusName,
} from "@/lib/acceptance-review";

type Answer = "met" | "not_met";

/**
 * The latest run of a corpus's suite kept for a reviewer (docs/architecture/reviewer-record.md, slice 2):
 * who kept it and when, the suite's own results, and each case it left for a reviewer with what it kept,
 * the latest decision on the case as kept, and a form to record whether the run met it.
 */
export function AcceptanceKeptRun({
  corpus,
  onDirty,
}: {
  corpus: AcceptanceCorpusName;
  onDirty: (dirty: boolean) => void;
}) {
  const client = useQueryClient();
  const params = { corpus };
  const q = useListAcceptanceRun(params, {
    query: { queryKey: getListAcceptanceRunQueryKey(params), retry: false },
  });
  const [opened, setOpened] = useState("");
  const [answer, setAnswer] = useState<Answer | "">("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const status = useRef<HTMLParagraphElement>(null);
  const dirty = opened !== "" && (answer !== "" || reason.trim() !== "");
  useEffect(() => onDirty(dirty || busy), [dirty, busy, onDirty]);
  useEffect(() => {
    if (message) status.current?.focus();
  }, [message]);
  const close = () => {
    setOpened("");
    setAnswer("");
    setReason("");
    setError("");
  };
  async function save(runId: string, item: AcceptanceRunCase) {
    if (!answer || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await recordAcceptanceRunDecision({
        corpus,
        runId,
        caseId: item.caseId,
        caseHash: item.caseHash,
        resultHash: item.resultHash,
        answer,
        reason: reason.trim(),
      });
      client.setQueryData(getListAcceptanceRunQueryKey(params), result);
      close();
      setMessage(recordedRunMessage(item.caseId, answer));
    } catch (e) {
      setError(describeError(e).message);
    } finally {
      setBusy(false);
    }
  }
  if (q.isLoading) return <Skel className="mt-4 h-32" />;
  if (!q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const run = q.data.run;
  return (
    <div className="mt-3" data-testid="acceptance-kept-run">
      <p className="max-w-3xl text-sm text-muted-foreground">{runIntro}</p>
      {!run ? (
        <p className="mt-4 text-sm" data-testid="text-acceptance-no-run">
          {noRun}
        </p>
      ) : (
        <>
          <div className="mt-3 rounded-2xl border border-border bg-sidebar p-4 text-sm">
            <p className="font-medium">{keptRunLine(run)}</p>
            {run.summary.map((line, index) => (
              <p key={index} className="mt-1">
                {line}
              </p>
            ))}
            <p className="mt-1">{runStatusesLine(run.statuses)}</p>
          </div>
          <p className="mt-3 text-sm" data-testid="text-acceptance-run-tally">
            {runTallyLine(run.left.length, run.met, run.notMet)}
          </p>
          <p ref={status} tabIndex={-1} className="mt-3 text-sm" role="status" aria-live="polite">
            {message}
          </p>
          <ul className="mt-4 grid gap-3">
            {run.left.map((item) => (
              <li
                key={item.caseId}
                className="rounded-xl border border-border p-4 text-sm"
                data-testid={"run-case-" + item.caseId}
              >
                <h3 className="font-medium">{item.caseId}</h3>
                <p className="mt-1">{item.title}</p>
                <p className="mt-1 text-muted-foreground">{runCaseStatusLine(item.status, item.reason)}</p>
                {item.sections ? (
                  <dl className="mt-3 grid gap-2">
                    {item.sections.map((section, index) => (
                      <div key={index}>
                        <dt className="font-medium">{section.heading}</dt>
                        <dd>
                          <ul className="mt-1 list-disc pl-5 break-words">
                            {section.lines.map((line, n) => (
                              <li key={n}>{line}</li>
                            ))}
                          </ul>
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="mt-3">{nothingKept}</p>
                )}
                <p className="mt-3" data-testid={"run-decision-" + item.caseId}>
                  {item.decision ? runDecisionLine(item.decision, item.decisions) : noDecision}
                </p>
                {item.decision && <p className="mt-1 text-muted-foreground">{item.decision.reason}</p>}
                {!item.current && <p className="mt-1">{staleCase}</p>}
                {item.sections && item.current && opened !== item.caseId && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm mt-2"
                    aria-expanded={false}
                    disabled={dirty || busy}
                    onClick={() => {
                      close();
                      setMessage("");
                      setOpened(item.caseId);
                    }}
                  >
                    {decideButton}
                  </button>
                )}
                {opened === item.caseId && (
                  <form
                    className="mt-3 grid gap-3 rounded-lg border border-border p-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void save(run.id, item);
                    }}
                    data-testid={"form-run-" + item.caseId}
                  >
                    <fieldset className="grid gap-2">
                      <legend className="font-medium">{runAnswerLegend}</legend>
                      {(
                        [
                          ["met", metLabel],
                          ["not_met", notMetLabel],
                        ] as const
                      ).map(([value, label]) => (
                        <label key={value} className="flex items-start gap-2">
                          <input
                            type="radio"
                            name={"run-answer-" + item.caseId}
                            value={value}
                            className="mt-1"
                            checked={answer === value}
                            onChange={() => setAnswer(value)}
                          />
                          <span>{label}</span>
                        </label>
                      ))}
                    </fieldset>
                    <label className="font-medium" htmlFor={"run-reason-" + item.caseId}>
                      {reasonLabel}
                    </label>
                    <textarea
                      id={"run-reason-" + item.caseId}
                      className="block w-full rounded-lg border border-border bg-background p-2 text-base"
                      rows={4}
                      minLength={20}
                      maxLength={2000}
                      aria-describedby={"run-reason-hint-" + item.caseId}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                    <p id={"run-reason-hint-" + item.caseId} className="text-muted-foreground">
                      {runReasonHint}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="submit"
                        className="btn btn-primary btn-sm"
                        disabled={busy || !answer || reason.trim().length < 20}
                      >
                        {busy ? "Saving…" : saveButton}
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={close}>
                        Discard
                      </button>
                    </div>
                    {error && (
                      <p className="text-sm text-destructive" role="alert">
                        {error}
                      </p>
                    )}
                  </form>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
