import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { KeyRound, Lock, ShieldAlert } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListAcceptanceCasesQueryKey,
  recordAcceptanceDecision,
  useListAcceptanceCases,
  type AcceptanceCase,
} from "@workspace/api-client-react";
import { EmptyState, ErrorState, Skel } from "@/components/states";
import { MfaVerification } from "@/components/mfa-verification";
import { UnsavedNavigationDialog } from "@/components/unsaved-navigation-dialog";
import { describeError } from "@/lib/describe-error";
import { useUnsavedNavigation } from "@/lib/use-unsaved-navigation";
import { cn } from "@/lib/utils";
import {
  answerLegend,
  caseFilters,
  claimHeading,
  confirmLabel,
  corpusNames,
  criticalHeading,
  decideButton,
  decisionLine,
  expectedHeading,
  leaveDescription,
  noDecision,
  pageHeading,
  pageIntro,
  reasonHint,
  reasonLabel,
  recordedMessage,
  rejectLabel,
  roleNote,
  saveButton,
  shownUnder,
  sourcesHeading,
  tallyLine,
  type AcceptanceCorpusName,
  type CaseFilter,
} from "@/lib/acceptance-review";

const toggle = (pressed: boolean) =>
  cn(
    "rounded-full border px-4 py-1.5 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
    pressed ? "border-foreground bg-foreground text-background" : "border-border hover:bg-secondary",
  );

type Answer = "confirmed" | "rejected";

/** One case as the reviewer reads it, with the latest decision on its current words. */
function CaseItem({
  item,
  opened,
  locked,
  onOpen,
  children,
}: {
  item: AcceptanceCase;
  opened: boolean;
  locked: boolean;
  onOpen: () => void;
  children: React.ReactNode;
}) {
  return (
    <li className="rounded-xl border border-border p-4 text-sm" data-testid={"acceptance-case-" + item.id}>
      <h3 className="font-medium">{item.id}</h3>
      <p className="mt-1">{item.title}</p>
      <dl className="mt-3 grid gap-2">
        <div>
          <dt className="font-medium">{expectedHeading}</dt>
          <dd>
            <ul className="mt-1 list-disc pl-5">
              {item.expected.map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>
          </dd>
        </div>
        <div>
          <dt className="font-medium">{criticalHeading}</dt>
          <dd>
            <ul className="mt-1 list-disc pl-5">
              {item.critical.map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>
          </dd>
        </div>
        <div>
          <dt className="font-medium">{sourcesHeading}</dt>
          <dd className="mt-1 break-words">{item.sources.join(" · ")}</dd>
        </div>
      </dl>
      <p className="mt-3" data-testid={"acceptance-decision-" + item.id}>
        {item.decision ? decisionLine(item.decision, item.decisions) : noDecision}
      </p>
      {item.decision && <p className="mt-1 text-muted-foreground">{item.decision.reason}</p>}
      {!opened && (
        <button
          type="button"
          className="btn btn-ghost btn-sm mt-2"
          aria-expanded={false}
          disabled={locked}
          onClick={onOpen}
        >
          {decideButton}
        </button>
      )}
      {children}
    </li>
  );
}

/**
 * The acceptance cases page (decision 0016, docs/architecture/reviewer-record.md, slice 1): an active
 * reviewer reads a corpus's cases and confirms or rejects a case's expected outcome, with why, for the
 * case's words as read. The server binds each decision to the case's hash and keeps every one.
 */
export default function AcceptanceReview() {
  const client = useQueryClient();
  const [corpus, setCorpus] = useState<AcceptanceCorpusName>("editorial");
  const [filter, setFilter] = useState<CaseFilter>("all");
  const [opened, setOpened] = useState("");
  const [answer, setAnswer] = useState<Answer | "">("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const status = useRef<HTMLParagraphElement>(null);
  const dirty = opened !== "" && (answer !== "" || reason.trim() !== "");
  const navigation = useUnsavedNavigation(() => dirty || busy);
  const params = { corpus };
  const q = useListAcceptanceCases(params, {
    query: { queryKey: getListAcceptanceCasesQueryKey(params), retry: false, refetchOnWindowFocus: !dirty },
  });
  const failed = (q.error as { status?: number } | null)?.status;
  const refusal = (q.error as { data?: { error?: string; code?: string } } | null)?.data;
  const mfa = failed === 403 && /mfa|factor|reverif/i.test(`${refusal?.code ?? ""} ${refusal?.error ?? ""}`);
  const close = () => {
    setOpened("");
    setAnswer("");
    setReason("");
    setError("");
  };
  useEffect(() => {
    if (message) status.current?.focus();
  }, [message]);
  async function save(item: AcceptanceCase) {
    if (!answer || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await recordAcceptanceDecision({
        corpus,
        caseId: item.id,
        caseHash: item.hash,
        answer,
        reason: reason.trim(),
      });
      client.setQueryData(getListAcceptanceCasesQueryKey(params), result);
      close();
      setMessage(recordedMessage(item.id, answer));
    } catch (e) {
      setError(describeError(e).message);
    } finally {
      setBusy(false);
    }
  }
  const shown = q.data?.cases.filter((item) => shownUnder(filter, item.decision)) ?? [];
  return (
    <div className="mx-auto max-w-5xl px-5 py-10 lg:px-8">
      <Link href="/staff" className="text-sm underline underline-offset-4">
        All staff operations
      </Link>
      <p className="eyebrow mt-6">Acceptance review</p>
      <h1 className="font-display mt-2 text-4xl">{pageHeading}</h1>
      <p className="mt-3 max-w-3xl text-sm text-muted-foreground">{pageIntro}</p>
      <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{roleNote}</p>
      <div className="mt-6 flex flex-wrap gap-2" role="group" aria-label="Sets of acceptance cases">
        {corpusNames.map((item) => (
          <button
            key={item.value}
            type="button"
            aria-pressed={corpus === item.value}
            disabled={dirty && corpus !== item.value}
            onClick={() => {
              close();
              setMessage("");
              setCorpus(item.value);
            }}
            className={toggle(corpus === item.value)}
            data-testid={"tab-acceptance-" + item.value}
          >
            {item.label}
          </button>
        ))}
      </div>
      {dirty && (
        <p
          role="status"
          className="mt-3 rounded-xl border border-[hsl(var(--ochre-border))] bg-[hsl(var(--ochre-soft))] px-4 py-2.5 text-sm text-[hsl(var(--ochre-foreground))]"
        >
          Save or discard the decision you started on {opened} before reading other cases.
        </p>
      )}
      <div className="mt-8">
        {q.isLoading ? (
          <Skel className="h-48" />
        ) : failed === 401 ? (
          <EmptyState
            mark={<Lock className="h-5 w-5 text-muted-foreground" />}
            title="Sign in required"
            action={
              <Link href="/sign-in" className="btn btn-primary">
                Sign in
              </Link>
            }
          >
            Acceptance cases need a signed-in staff account.
          </EmptyState>
        ) : mfa ? (
          <EmptyState
            mark={<KeyRound className="h-5 w-5 text-muted-foreground" />}
            title="Recent verification needed"
            action={<MfaVerification onVerified={() => void q.refetch()} />}
          >
            Acceptance cases need both sign-in factors to have been verified recently.
          </EmptyState>
        ) : failed === 403 ? (
          <EmptyState
            mark={<ShieldAlert className="h-5 w-5 text-muted-foreground" />}
            title="Not an acceptance reviewer"
            action={
              <Link href="/staff" className="btn btn-ghost">
                Back to staff operations
              </Link>
            }
          >
            Your account does not have the reviewer role. Roles are assigned on the server; there is no way to
            request one here.
          </EmptyState>
        ) : !q.data ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : (
          <section aria-labelledby="acceptance-cases-heading">
            <h2 className="font-display text-2xl" id="acceptance-cases-heading">
              {corpusNames.find((item) => item.value === corpus)?.label}
            </h2>
            <div className="mt-3 rounded-2xl border border-border bg-sidebar p-4 text-sm">
              <p className="font-medium">{claimHeading}</p>
              <p className="mt-1" data-testid="text-acceptance-claim">
                {q.data.claim}
              </p>
            </div>
            <p className="mt-3 text-sm" data-testid="text-acceptance-tally">
              {tallyLine(q.data.cases.length, q.data.confirmed, q.data.rejected)}
            </p>
            <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Show cases">
              {caseFilters.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  aria-pressed={filter === item.value}
                  disabled={dirty}
                  onClick={() => setFilter(item.value)}
                  className={toggle(filter === item.value)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <p ref={status} tabIndex={-1} className="mt-3 text-sm" role="status" aria-live="polite">
              {message}
            </p>
            {shown.length === 0 ? (
              <p className="mt-4 text-sm">No case matches this choice.</p>
            ) : (
              <ul className="mt-4 grid gap-3">
                {shown.map((item) => (
                  <CaseItem
                    key={item.id}
                    item={item}
                    opened={opened === item.id}
                    locked={dirty || busy}
                    onOpen={() => {
                      close();
                      setMessage("");
                      setOpened(item.id);
                    }}
                  >
                    {opened === item.id && (
                      <form
                        className="mt-3 grid gap-3 rounded-lg border border-border p-3"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void save(item);
                        }}
                        data-testid={"form-acceptance-" + item.id}
                      >
                        <fieldset className="grid gap-2">
                          <legend className="font-medium">{answerLegend}</legend>
                          {(
                            [
                              ["confirmed", confirmLabel],
                              ["rejected", rejectLabel],
                            ] as const
                          ).map(([value, label]) => (
                            <label key={value} className="flex items-start gap-2">
                              <input
                                type="radio"
                                name={"answer-" + item.id}
                                value={value}
                                className="mt-1"
                                checked={answer === value}
                                onChange={() => setAnswer(value)}
                              />
                              <span>{label}</span>
                            </label>
                          ))}
                        </fieldset>
                        <label className="font-medium" htmlFor={"reason-" + item.id}>
                          {reasonLabel}
                        </label>
                        <textarea
                          id={"reason-" + item.id}
                          className="block w-full rounded-lg border border-border bg-background p-2 text-base"
                          rows={4}
                          minLength={20}
                          maxLength={2000}
                          aria-describedby={"reason-hint-" + item.id}
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                        />
                        <p id={"reason-hint-" + item.id} className="text-muted-foreground">
                          {reasonHint}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="submit"
                            className="btn btn-primary btn-sm"
                            disabled={busy || !answer || reason.trim().length < 20}
                          >
                            {busy ? "Saving…" : saveButton}
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            disabled={busy}
                            onClick={close}
                          >
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
                  </CaseItem>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
      <UnsavedNavigationDialog
        open={navigation.blocked}
        busy={busy}
        onDiscard={navigation.proceed}
        onStay={navigation.stay}
        description={leaveDescription}
      />
    </div>
  );
}
