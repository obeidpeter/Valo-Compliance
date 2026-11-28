import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearch } from "wouter";
import { useUser } from "@clerk/react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  Loader2,
  Printer,
  RotateCcw,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import {
  useGetAssessment,
  useListCheckerRulesInUse,
  usePreviewAssessment,
  usePreviewWorkspaceAssessment,
  useGetWorkspace,
  getGetAssessmentQueryKey,
  getGetWorkspaceQueryKey,
  getListCheckerRulesInUseQueryKey,
  type CheckerFacts,
  type AssessmentResult,
} from "@workspace/api-client-react";
import {
  CHECKER_QUESTIONNAIRE,
  RULE_FAMILIES,
  RULE_STEPS,
  checkerQuestion,
  questionsAsked,
  withoutFilledAnswers,
  type RuleFamily,
} from "@workspace/valo-core/checker-questionnaire";
import { AssessmentResultView } from "@/components/assessment-result";
import { StepQuestions, type QuestionContext } from "@/components/checker-question";
import { Review, SavePanel } from "@/components/checker-review";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { NameQuestionsNeedSignIn, RuleQuestions } from "@/components/rule-questions";
import { UnsavedNavigationDialog } from "@/components/unsaved-navigation-dialog";
import { richQuestionTarget, type RichCheckerFacts } from "@/lib/rich-checker";
import { Notice } from "@/components/states";
import { describeError } from "@/lib/api";
import {
  clearCheckerHandoff,
  peekCheckerHandoff,
  stashCheckerHandoff,
  type CheckerHandoff,
} from "@/lib/checker-handoff";
import { CHECKER_START, signUpFor } from "@/lib/start";
import { useUnsavedNavigation } from "@/lib/use-unsaved-navigation";
import {
  CHECKER_STEPS,
  EMPTY_FACTS,
  asked,
  factsFromProfile,
  finaliseFacts,
  nairaToKobo,
  koboToNaira,
  live,
  progressOf,
  stepOf,
  factLabel,
} from "@/lib/checker";
import { lagosToday } from "@/lib/format";
import { followedResult } from "@/lib/recheck";
import { formatRequirementsBrief } from "@/lib/requirements-brief";
import { cn } from "@/lib/utils";
import { useAccountEpoch } from "@/components/account-state-boundary";
import { WorkspaceNav } from "@/components/workspace-nav";

const STEPS = CHECKER_STEPS.map((step) => step.name);
const REVIEW = STEPS.length - 1;
/** The step that asks about size and turnover, which holds the one box that can hold a mistake. */
const TURNOVER = stepOf("turnoverAmountKobo");
/** The steps that ask rules' questions. */
const RULE_STEP_NUMBERS: ReadonlySet<number> = new Set(Object.values(RULE_STEPS));
/** The control a link to one of the check's own questions moves the focus to: its first answer. */
const questionControl = (answer: string) => (checkerQuestion(answer)?.kind === "amount" ? "amount" : answer);

export default function Checker() {
  const currentAccount = useAccountEpoch();
  const search = useSearch();
  const { isSignedIn } = useUser();
  const autoPrefillRequested = useMemo(
    () => new URLSearchParams(search).get("prefill") === "profile",
    [search],
  );
  const fromAssessmentId = useMemo(
    () => new URLSearchParams(search).get("fromAssessment")?.trim() ?? "",
    [search],
  );
  // PRO-003: a check offered after the profile changed says which saved result it follows.
  const follows = useMemo(() => followedResult(search), [search]);
  const autoPrefilled = useRef(false);
  const loadedFromAssessment = useRef<string | null>(null);
  const [loadedPreviousCheck, setLoadedPreviousCheck] = useState(false);
  const [copiedLiveBrief, setCopiedLiveBrief] = useState(false);
  const [facts, setFacts] = useState<RichCheckerFacts>(EMPTY_FACTS);
  /** The questions the visitor chose "Skip for now" on. A question nobody has touched holds the same
   * "unanswered", and shows nothing chosen. */
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set());
  /** Whether the visitor has answered a question themselves since the page opened, was cleared or
   * was filled in from the profile. */
  const [own, setOwn] = useState(false);
  const [asking, setAsking] = useState<"start-over" | "fill-in" | null>(null);
  const [step, setStep] = useState(0);
  const [result, setResult] = useState<{ r: AssessmentResult; sig: string } | null>(null);
  const [filledIn, setFilledIn] = useState(false);
  const [amountText, setAmountText] = useState("");
  const [amountError, setAmountError] = useState<string | null>(null);
  const [pendingHandoff, setPendingHandoff] = useState<CheckerHandoff | null>(() =>
    isSignedIn ? peekCheckerHandoff() : null,
  );
  const leavingForAuth = useRef(false);
  const publicPreview = usePreviewAssessment();
  const workspacePreview = usePreviewWorkspaceAssessment();
  const preview = isSignedIn ? workspacePreview : publicPreview;

  const ws = useGetWorkspace({
    query: { enabled: !!isSignedIn, queryKey: getGetWorkspaceQueryKey(), ...live },
  });
  const sourceAssessment = useGetAssessment(fromAssessmentId, {
    query: {
      enabled: Boolean(fromAssessmentId && isSignedIn),
      queryKey: getGetAssessmentQueryKey(fromAssessmentId),
    },
  });
  const profile = isSignedIn ? (ws.data?.profile ?? null) : null;
  // The released rules the check uses today, read once: only their questions are asked (RUL-001).
  const rulesInUse = useListCheckerRulesInUse({
    query: {
      queryKey: getListCheckerRulesInUseQueryKey(),
      staleTime: Infinity,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  });
  const rules = rulesInUse.data?.rules;
  /** The kinds of rule in use, each with its rules' titles. */
  const inUse = useMemo(() => {
    const titles = new Map<RuleFamily, string[]>();
    for (const rule of rules ?? [])
      if (rule.family) titles.set(rule.family, [...(titles.get(rule.family) ?? []), rule.title]);
    return titles;
  }, [rules]);
  /** The kinds of rule whose questions this visitor is asked: the business-name questions ask for
   * names, so only a signed-in visitor is asked them. */
  const families = useMemo(
    () =>
      new Set<RuleFamily>([...inUse.keys()].filter((family) => family !== "businessName" || !!isSignedIn)),
    [inUse, isSignedIn],
  );

  const set = <K extends keyof CheckerFacts>(k: K, v: CheckerFacts[K], chosen = true) => {
    setFacts((o) => ({ ...o, [k]: v }));
    setOwn(true);
    setSkipped((old) => {
      const skip = chosen && v === "unanswered";
      if (skip === old.has(k)) return old;
      const next = new Set(old);
      if (skip) next.add(k);
      else next.delete(k);
      return next;
    });
  };
  const final = useMemo(() => finaliseFacts(facts, families), [facts, families]);
  /** The questions the check asks now, in order, and how many of them the visitor has dealt with. */
  const askedNow = useMemo(() => questionsAsked(final, families), [final, families]);
  const progress = useMemo(
    () => progressOf(facts, skipped, final, askedNow),
    [facts, skipped, final, askedNow],
  );
  const sig = JSON.stringify(final);
  const stale = result && result.sig !== sig;
  /** Answers that only this page holds: starting over would lose them. */
  const mine = own || !!facts.rich;
  const untouched = !mine && !filledIn && !result && step === 0;
  const navigation = useUnsavedNavigation(() => !leavingForAuth.current && mine && (!result || !!stale));

  function loadHandoff() {
    if (!pendingHandoff) return;
    setFacts(pendingHandoff.facts);
    setSkipped(new Set(pendingHandoff.skipped));
    setAmountText(pendingHandoff.amountText);
    const k = nairaToKobo(pendingHandoff.amountText);
    setAmountError(
      pendingHandoff.amountText.trim() && !k ? "Use digits, with up to two decimal places." : null,
    );
    setOwn(true);
    setFilledIn(false);
    setPendingHandoff(null);
    clearCheckerHandoff();
    show(REVIEW);
  }

  function dismissHandoff() {
    setPendingHandoff(null);
    clearCheckerHandoff();
  }

  function stashForAuth() {
    stashCheckerHandoff({ facts, skipped: [...skipped], amountText });
    leavingForAuth.current = true;
  }

  const fillIn = useCallback(() => {
    if (!profile) return;
    setFacts((current) => ({
      ...factsFromProfile(profile),
      ...(current.rich ? { factsVersion: current.factsVersion, rich: current.rich } : {}),
    }));
    setSkipped(new Set());
    setOwn(false);
    setAmountText("");
    setAmountError(null);
    setFilledIn(true);
    setStep(0);
  }, [profile]);

  useEffect(() => {
    if (!autoPrefillRequested || autoPrefilled.current || !profile || own || filledIn || fromAssessmentId)
      return;
    autoPrefilled.current = true;
    fillIn();
  }, [autoPrefillRequested, fromAssessmentId, profile, own, filledIn, fillIn]);

  useEffect(() => {
    if (
      !fromAssessmentId ||
      !isSignedIn ||
      !sourceAssessment.data ||
      loadedFromAssessment.current === fromAssessmentId
    )
      return;
    loadedFromAssessment.current = fromAssessmentId;
    const savedFacts = sourceAssessment.data.facts as RichCheckerFacts;
    // A rule's saved answer that an earlier answer fills is read as filled, so it follows that answer.
    setFacts(withoutFilledAnswers({ ...EMPTY_FACTS, ...savedFacts }));
    setSkipped(new Set());
    setAmountText(koboToNaira(savedFacts.turnoverAmountKobo ?? null));
    setAmountError(null);
    setOwn(true);
    setFilledIn(false);
    setLoadedPreviousCheck(true);
    setStep(REVIEW);
  }, [fromAssessmentId, isSignedIn, sourceAssessment.data]);

  function reset() {
    setFacts(EMPTY_FACTS);
    setSkipped(new Set());
    setOwn(false);
    setAmountText("");
    setAmountError(null);
    setResult(null);
    setFilledIn(false);
    setPendingHandoff(null);
    clearCheckerHandoff();
    publicPreview.reset();
    workspacePreview.reset();
    show(0);
  }

  function run() {
    const body = { facts: final, asOfDate: lagosToday() };
    preview.mutate(
      { data: body },
      {
        onSuccess: (r) => {
          if (currentAccount()) setResult({ r, sig: JSON.stringify(final) });
        },
      },
    );
  }

  /** Moves the focus to the first of these elements that can take it, or else to the step. */
  function focusFirst(ids: readonly (string | undefined)[]) {
    requestAnimationFrame(() => {
      for (const id of ids) {
        const element = id ? document.getElementById(id) : null;
        if (element && !element.matches(":disabled")) {
          element.focus();
          return;
        }
      }
      document.getElementById("checker-step")?.focus();
    });
  }

  /** Shows a step and moves the focus to it, or to one of its questions. */
  function show(n: number, field?: string) {
    const target = field ? richQuestionTarget(field) : undefined;
    setStep(target?.step ?? n);
    focusFirst(
      target
        ? [target.id, target.fallbackId]
        : field && checkerQuestion(field)
          ? [questionControl(field)]
          : [],
    );
  }

  /** Shows one of the check's own questions, from a rule's answer that it fills. */
  function goToQuestion(answer: string) {
    show(stepOf(answer), answer);
  }

  function go(n: number, field?: string) {
    const nextStep = (field ? richQuestionTarget(field)?.step : undefined) ?? n;
    if (step === TURNOVER && nextStep > TURNOVER && amountText && amountError) {
      const amountInput = document.getElementById("amount");
      amountInput?.scrollIntoView({ behavior: "smooth", block: "center" });
      amountInput?.focus();
      return;
    }
    show(n, field);
  }

  const err = preview.error ? describeError(preview.error) : null;
  const lastYear = Number(lagosToday().slice(0, 4)) - 1;
  /** What every question takes from the page: the answers, which were skipped, and where an answer
   * goes. */
  const questions: QuestionContext = {
    facts,
    skipped,
    asked: (answer) => asked(facts, answer),
    onAnswer: (answer, value, chosen) => set(answer as keyof CheckerFacts, value as never, chosen),
    amount: {
      text: amountText,
      error: amountError,
      onChange: (text) => {
        setAmountText(text);
        const kobo = nairaToKobo(text);
        setAmountError(text.trim() && !kobo ? "Use digits, with up to two decimal places." : null);
        set("turnoverAmountKobo", kobo);
      },
    },
    lastYear,
  };

  return (
    <div className="mx-auto max-w-6xl px-5 py-12 lg:px-8">
      {/* Inside the workspace this is a page of its Requirements section; elsewhere it shows nothing. */}
      <WorkspaceNav />
      <header className="reveal max-w-3xl">
        <p className="eyebrow">Requirements</p>
        <h1 className="font-display mt-3 text-4xl leading-[1.08] sm:text-5xl">Check your requirements</h1>
        <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
          Answer a few questions about your business to see which requirements may apply, and why.
        </p>
        <p className="mt-3 leading-relaxed text-muted-foreground">
          If you are not sure of an answer, choose "I do not know". To leave a question for later, choose
          "Skip for now". Neither is taken to mean "No". Results come only from published rules that have been
          checked against an official source.
        </p>
      </header>
      {loadedPreviousCheck && (
        <Notice className="mt-6" tone="forest" title="Loaded from your earlier saved check">
          Edit any answer below, then select <strong>Check my requirements</strong> to see what changes. Your
          earlier saved result stays untouched so you can compare both afterward.
        </Notice>
      )}

      <UnsavedNavigationDialog
        open={navigation.blocked}
        busy={preview.isPending}
        title="Leave your requirements answers?"
        description="You have answers on this page that have not been checked yet. Stay here to finish, or leave and discard them."
        onStay={navigation.stay}
        onDiscard={navigation.proceed}
      />
      {isSignedIn && pendingHandoff && !mine && !filledIn && (
        <div className="mt-6" data-testid="notice-checker-handoff">
          <Notice tone="ink" title="Your earlier answers are ready to load">
            You answered these questions before signing in. Load them here to check and save your result, or
            dismiss them to start fresh.
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={loadHandoff}
                data-testid="button-load-handoff"
              >
                Load my answers
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={dismissHandoff}
                data-testid="button-dismiss-handoff"
              >
                Dismiss
              </button>
            </div>
          </Notice>
        </div>
      )}
      <div className="mt-8">
        <div className="flex flex-wrap items-center gap-2">
          {isSignedIn &&
            (ws.isLoading ? (
              <span className="pill pill-ink">
                <Loader2 className="h-3 w-3 animate-spin" />
                Loading your business profile
              </span>
            ) : profile ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm !h-auto !whitespace-normal py-2 text-left"
                onClick={() => (own ? setAsking("fill-in") : fillIn())}
                data-testid="button-prefill"
              >
                <UserRound className="h-4 w-4 shrink-0" />
                {filledIn ? "Fill in again from my business profile" : "Fill in from my business profile"}
              </button>
            ) : (
              <Link
                href="/workspace/profile"
                className="btn btn-ghost btn-sm !h-auto !whitespace-normal py-2 text-left"
              >
                Add a business profile to fill these in for you
              </Link>
            ))}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => (mine ? setAsking("start-over") : reset())}
            disabled={untouched}
            data-testid="button-reset"
          >
            <RotateCcw className="h-4 w-4" />
            Start over
          </button>
        </div>
        {!isSignedIn && (
          <p
            className="mt-3 flex items-start gap-2 text-sm text-muted-foreground"
            data-testid="text-anonymous"
          >
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
            You are not signed in. Your answers are not saved unless you choose to carry them into sign-up
            after checking.
          </p>
        )}
        <p
          role="status"
          className="text-sm text-muted-foreground [&:not(:empty)]:mt-3"
          data-testid="status-filled-in"
        >
          {filledIn && !own ? "Filled in from your business profile." : ""}
        </p>
      </div>

      <ConfirmDialog
        open={asking === "start-over"}
        title="Start over?"
        keep="Keep my answers"
        confirm="Clear my answers"
        onKeep={() => setAsking(null)}
        onConfirm={() => {
          setAsking(null);
          reset();
        }}
      >
        <p>
          This clears every answer on this page{result ? " and the results below it" : ""}. It cannot be
          undone.
        </p>
        {isSignedIn && <p className="mt-2">Anything you have already saved stays in your workspace.</p>}
      </ConfirmDialog>
      <ConfirmDialog
        open={asking === "fill-in"}
        title="Replace your answers?"
        keep="Keep my answers"
        confirm="Use my profile's answers"
        onKeep={() => setAsking(null)}
        onConfirm={() => {
          setAsking(null);
          fillIn();
        }}
      >
        <p>
          This replaces the answers you gave on this page with the ones in your business profile. Your answers
          to the questions asked for particular requirements are kept.
        </p>
      </ConfirmDialog>

      <div className="mt-8 grid gap-8 lg:grid-cols-[14rem_1fr]">
        <ol className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible" aria-label="Steps">
          {STEPS.map((s, i) => {
            const done = progress.stepsDone[i] ?? false;
            return (
              <li key={s}>
                <button
                  type="button"
                  onClick={() => go(i)}
                  aria-current={i === step ? "step" : undefined}
                  // Positioned, so that the tick's hidden words stay inside the strip of steps, which
                  // scrolls sideways on a phone. Otherwise they widen the page.
                  className={cn(
                    "relative flex w-full items-center gap-3 whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm transition-colors",
                    i === step
                      ? "bg-accent font-medium text-accent-foreground"
                      : "text-muted-foreground hover:bg-secondary",
                  )}
                  data-testid={"button-step-" + i}
                >
                  <span
                    className={cn(
                      "grid h-6 w-6 shrink-0 place-items-center rounded-full border font-mono text-[0.7rem]",
                      done ? "border-primary bg-primary text-primary-foreground" : "border-border",
                    )}
                  >
                    {done ? <Check className="h-3 w-3" /> : i + 1}
                  </span>
                  {s}
                  {done && <span className="sr-only"> (answered)</span>}
                </button>
              </li>
            );
          })}
        </ol>

        <div className="min-w-0">
          <section
            id="checker-step"
            tabIndex={-1}
            className="surface p-5 outline-none sm:p-8"
            aria-label={STEPS[step]}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="eyebrow">
                Step {step + 1} of {STEPS.length}
              </p>
              <span className="text-xs text-muted-foreground" data-testid="status-checker-progress">
                {progress.answered} of {progress.asked} questions answered
              </span>
            </div>
            <h2 className="font-display mt-2 text-2xl sm:text-3xl">{STEPS[step]}</h2>
            <div className="mt-6 grid gap-8">
              {step === 0 && (
                <p className="rounded-xl border border-border bg-sidebar/50 px-3.5 py-2.5 text-xs leading-relaxed text-muted-foreground">
                  <strong className="font-medium text-foreground">Quick guide to answer choices:</strong>{" "}
                  &ldquo;I do not know&rdquo; tells Valo which extra facts a rule needs; &ldquo;Skip for
                  now&rdquo; leaves a question open for later; &ldquo;Not applicable&rdquo; skips follow-up
                  questions that do not fit your business.
                </p>
              )}
              <StepQuestions questions={CHECKER_QUESTIONNAIRE[step]?.questions ?? []} context={questions} />
              {step === 0 && !isSignedIn && !inUse.has("businessName") && (
                <p className="hint">We never ask for your business name here.</p>
              )}
              {RULE_FAMILIES.filter((family) => RULE_STEPS[family] === step && inUse.has(family)).map(
                (family) =>
                  families.has(family) ? (
                    <RuleQuestions
                      key={family}
                      family={family}
                      titles={inUse.get(family) ?? []}
                      facts={facts}
                      sent={final}
                      onChange={setFacts}
                      onGoTo={goToQuestion}
                    />
                  ) : (
                    <NameQuestionsNeedSignIn
                      key={family}
                      titles={inUse.get(family) ?? []}
                      onKeep={stashForAuth}
                    />
                  ),
              )}
              {rulesInUse.isError && RULE_STEP_NUMBERS.has(step) && (
                <Notice title="Some questions could not be loaded">
                  Some requirements ask questions of their own, and they could not be loaded just now. You can
                  still check your requirements: those requirements will say what more they need. Reload the
                  page to try again.
                </Notice>
              )}
              {step === REVIEW && (
                <>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    You can change any answer, or leave it as it is. Where an answer is missing, your results
                    say what more is needed.
                  </p>
                  <Review sent={final} asked={askedNow} onEdit={go} />
                </>
              )}
            </div>

            <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => go(step - 1)}
                disabled={step === 0}
                data-testid="button-back"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </button>
              {step < REVIEW ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => go(step + 1)}
                  disabled={step === TURNOVER && !!amountError}
                  data-testid="button-next"
                >
                  Continue
                  <ArrowRight className="h-4 w-4" />
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={run}
                  disabled={preview.isPending || !!amountError}
                  data-testid="button-run"
                >
                  {preview.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  {result ? "Check again" : "Check my requirements"}
                </button>
              )}
            </div>
          </section>

          {err && (
            <p
              role="alert"
              className="mt-4 rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive"
              data-testid="status-preview-error"
            >
              {err.message}
            </p>
          )}

          {preview.isPending && !result && (
            <div className="mt-8 grid gap-3" aria-live="polite">
              <div className="h-28 animate-pulse rounded-2xl bg-muted" />
              <div className="h-28 animate-pulse rounded-2xl bg-muted" />
            </div>
          )}

          {result && (
            <section className="mt-10" aria-live="polite" aria-label="Results">
              <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="font-display text-3xl">Results</h2>
                  {stale && (
                    <span className="pill pill-ochre" data-testid="status-stale">
                      Answers changed since this result. Check again.
                    </span>
                  )}
                </div>
                <div className="no-print flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={async () => {
                      const brief = formatRequirementsBrief({
                        result: result.r,
                        facts: final as unknown as Record<string, unknown>,
                      });
                      try {
                        await navigator.clipboard.writeText(brief);
                        setCopiedLiveBrief(true);
                        setTimeout(() => setCopiedLiveBrief(false), 2500);
                      } catch {
                        // Clipboard access may be unavailable; print stays available.
                      }
                    }}
                    data-testid="button-copy-live-brief"
                  >
                    {copiedLiveBrief ? (
                      <Check className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <Copy className="h-4 w-4" aria-hidden="true" />
                    )}
                    {copiedLiveBrief ? "Copied summary" : "Copy summary"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => window.print()}
                    data-testid="button-print-live-result"
                  >
                    <Printer className="h-4 w-4" aria-hidden="true" />
                    Print / PDF
                  </button>
                </div>
              </div>
              <AssessmentResultView
                result={result.r}
                // oxlint-disable-next-line react/no-unstable-nested-components -- a render function the result calls, not a component
                questionAction={(field) => {
                  const target = richQuestionTarget(field);
                  const step = target
                    ? families.has(target.section)
                      ? target.step
                      : null
                    : checkerQuestion(field)
                      ? stepOf(field)
                      : null;
                  return step === null ? null : (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      aria-label={`Review ${factLabel(field)}`}
                      onClick={() => go(step, field)}
                    >
                      Review answer
                    </button>
                  );
                }}
                onQuestion={(field) => go(stepOf(field), field)}
              />
              {isSignedIn ? (
                <SavePanel
                  facts={final}
                  profileRevision={ws.data?.profileRevision ?? 0}
                  hasProfile={!!profile}
                  stale={!!stale}
                  follows={follows}
                />
              ) : (
                <Notice className="mt-6" tone="ink" title="Want to keep this?">
                  Nothing here has been saved yet. With an account you can save this result and turn it into
                  tasks. Choose a button below to keep your answers in this browser tab while you sign in, so
                  you do not have to enter them again.
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link
                      href={signUpFor(CHECKER_START)}
                      className="btn btn-primary btn-sm"
                      onClick={stashForAuth}
                      data-testid="link-signup-keep-answers"
                    >
                      Create account and keep these answers
                    </Link>
                    <Link
                      href={`/sign-in?start=${CHECKER_START}`}
                      className="btn btn-ghost btn-sm"
                      onClick={stashForAuth}
                      data-testid="link-signin-keep-answers"
                    >
                      Sign in and keep these answers
                    </Link>
                  </div>
                </Notice>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
