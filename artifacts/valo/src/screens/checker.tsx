import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useUser } from "@clerk/react";
import { ArrowLeft, ArrowRight, Check, Loader2, RotateCcw, ShieldCheck, UserRound } from "lucide-react";
import {
  usePreviewAssessment,
  usePreviewWorkspaceAssessment,
  useGetWorkspace,
  getGetWorkspaceQueryKey,
  CheckerFactsState,
  CheckerFactsTurnoverBand,
  CheckerFactsTurnoverMetric,
  CheckerFactsTurnoverCurrency,
  CheckerFactsTurnoverPeriod,
  type CheckerFacts,
  type AssessmentResult,
} from "@workspace/api-client-react";
import { AssessmentResultView } from "@/components/assessment-result";
import { AnswerOr, Choice, ListOr, known, opts, yesNo, type Change } from "@/components/checker-controls";
import { Review, SavePanel } from "@/components/checker-review";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { RichCheckerFields } from "@/components/rich-checker-fields";
import { richQuestionTarget, type RichCheckerFacts } from "@/lib/rich-checker";
import { Notice } from "@/components/states";
import { describeError } from "@/lib/api";
import {
  CHECKER_STEPS,
  EMPTY_FACTS,
  LEGAL_FORMS,
  REG_STATUSES,
  asked,
  factsFromProfile,
  finaliseFacts,
  nairaToKobo,
  koboToNaira,
  isMarker,
  live,
  stepDone,
  stepOf,
  factLabel,
} from "@/lib/checker";
import { lagosToday } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useAccountEpoch } from "@/components/account-state-boundary";
import { WorkspaceNav } from "@/components/workspace-nav";

const STEPS = CHECKER_STEPS.map((step) => step.name);
const REVIEW = STEPS.length - 1;
/** The step that asks about size and turnover, which holds the one box that can hold a mistake. */
const TURNOVER = stepOf("turnoverAmountKobo");

export default function Checker() {
  const currentAccount = useAccountEpoch();
  const { isSignedIn } = useUser();
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
  const publicPreview = usePreviewAssessment();
  const workspacePreview = usePreviewWorkspaceAssessment();
  const preview = isSignedIn ? workspacePreview : publicPreview;

  const ws = useGetWorkspace({
    query: { enabled: !!isSignedIn, queryKey: getGetWorkspaceQueryKey(), ...live },
  });
  const profile = isSignedIn ? (ws.data?.profile ?? null) : null;

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
  /** What every question takes from the page: its name, whether the visitor chose to skip it, and
   * where its answer goes. */
  const at = <K extends keyof CheckerFacts>(k: K) => ({
    name: k,
    skipped: skipped.has(k),
    onChange: ((v, chosen) => set(k, v, chosen)) as Change<CheckerFacts[K]>,
  });
  const final = useMemo(() => finaliseFacts(facts), [facts]);
  const sig = JSON.stringify(final);
  const stale = result && result.sig !== sig;
  /** Answers that only this page holds: starting over would lose them. */
  const mine = own || !!facts.rich;
  const untouched = !mine && !filledIn && !result && step === 0;

  function fillIn() {
    if (!ws.data?.profile) return;
    setFacts((current) => ({
      ...factsFromProfile(ws.data!.profile!),
      ...(current.rich ? { factsVersion: current.factsVersion, rich: current.rich } : {}),
    }));
    setSkipped(new Set());
    setOwn(false);
    setAmountText("");
    setAmountError(null);
    setFilledIn(true);
    setStep(0);
  }

  function reset() {
    setFacts(EMPTY_FACTS);
    setSkipped(new Set());
    setOwn(false);
    setAmountText("");
    setAmountError(null);
    setResult(null);
    setFilledIn(false);
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

  /** Shows a step and moves the focus to it, or to one of its optional questions. */
  function show(n: number, field?: string) {
    const target = field ? richQuestionTarget(field) : undefined;
    setStep(target?.step ?? n);
    requestAnimationFrame(() => {
      if (target) {
        const details = document.querySelector<HTMLDetailsElement>(
          `[data-testid="rich-section-${target.section}"]`,
        );
        if (details) {
          details.open = true;
          const primary = document.getElementById(target.id);
          const input =
            primary && !primary.matches(":disabled")
              ? primary
              : target.fallbackId
                ? document.getElementById(target.fallbackId)
                : null;
          if (input) {
            input.focus();
            return;
          }
        }
      }
      document.getElementById("checker-step")?.focus();
    });
  }

  function go(n: number, field?: string) {
    const nextStep = (field ? richQuestionTarget(field)?.step : undefined) ?? n;
    if (step === TURNOVER && nextStep > TURNOVER && amountText && amountError) return;
    show(n, field);
  }

  const err = preview.error ? describeError(preview.error) : null;
  const lastYear = Number(lagosToday().slice(0, 4)) - 1;

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
            You are not signed in. Your answers are not saved, and leaving this page clears them.
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
          This replaces the answers you gave on this page with the ones in your business profile. Any optional
          details you entered are kept.
        </p>
      </ConfirmDialog>

      <div className="mt-8 grid gap-8 lg:grid-cols-[14rem_1fr]">
        <ol className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible" aria-label="Steps">
          {STEPS.map((s, i) => {
            const done = stepDone(facts, skipped, i);
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
            <p className="eyebrow">
              Step {step + 1} of {STEPS.length}
            </p>
            <h2 className="font-display mt-2 text-2xl sm:text-3xl">{STEPS[step]}</h2>
            <div className="mt-6 grid gap-8">
              {step === 0 && (
                <>
                  <Choice
                    {...at("legalForm")}
                    label="How is the business set up?"
                    value={facts.legalForm}
                    options={opts(LEGAL_FORMS)}
                    markers={["unknown", "unanswered"]}
                  />
                  <Choice
                    {...at("registrationStatus")}
                    label="Is it registered with the Corporate Affairs Commission (CAC)?"
                    value={facts.registrationStatus}
                    options={opts(REG_STATUSES)}
                    markers={["unknown", "unanswered"]}
                  />
                  {!isSignedIn && <p className="hint">We never ask for your business name here.</p>}
                  {isSignedIn && (
                    <RichCheckerFields section="businessName" facts={facts} onChange={setFacts} />
                  )}
                  <RichCheckerFields section="tax" facts={facts} onChange={setFacts} />
                </>
              )}
              {step === 1 && (
                <>
                  <ListOr
                    {...at("activities")}
                    label="What does the business do?"
                    hint="In your own words. You can add up to 10."
                    value={facts.activities}
                    placeholder="e.g. Selling fabric wholesale"
                  />
                  <Choice
                    {...at("manufacturing")}
                    label="Do you manufacture or process goods?"
                    value={facts.manufacturing}
                    options={yesNo}
                    markers={["unknown", "unanswered"]}
                  />
                  <Choice
                    {...at("importing")}
                    label="Do you import goods into Nigeria?"
                    value={facts.importing}
                    options={yesNo}
                    markers={["unknown", "unanswered"]}
                  />
                  {asked(facts, "productTypes") && (
                    <ListOr
                      {...at("productTypes")}
                      label="Which kinds of product?"
                      hint="Asked because you manufacture or import goods."
                      value={facts.productTypes ?? "unanswered"}
                      placeholder="e.g. Packaged snacks"
                    />
                  )}
                  <RichCheckerFields section="product" facts={facts} onChange={setFacts} />
                </>
              )}
              {step === 2 && (
                <>
                  <Choice
                    {...at("premises")}
                    label="Do you operate from physical premises?"
                    value={facts.premises}
                    options={yesNo}
                    markers={["unknown", "unanswered"]}
                  />
                  <AnswerOr
                    {...at("state")}
                    label="Which state is the business in?"
                    value={facts.state}
                    markers={["unknown", "unanswered"]}
                    render={(v, change, labelledBy) => (
                      <select
                        id="state"
                        aria-labelledby={labelledBy}
                        className="field sm:max-w-xs"
                        value={v}
                        onChange={(e) => change(e.target.value)}
                        data-testid="select-state"
                      >
                        <option value="">Choose a state or the FCT</option>
                        {Object.values(CheckerFactsState)
                          .filter((s) => !isMarker(s))
                          .map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                      </select>
                    )}
                  />
                  {asked(facts, "lga") ? (
                    <AnswerOr
                      {...at("lga")}
                      label="Which local government area (LGA)?"
                      value={facts.lga}
                      markers={["unknown", "unanswered"]}
                      render={(v, change, labelledBy) => (
                        <input
                          id="lga"
                          aria-labelledby={labelledBy}
                          className="field sm:max-w-xs"
                          maxLength={100}
                          value={v}
                          placeholder="e.g. Ikeja"
                          onChange={(e) => change(e.target.value)}
                          data-testid="input-lga"
                        />
                      )}
                    />
                  ) : (
                    <p className="hint">The local government area is skipped because you have no premises.</p>
                  )}
                </>
              )}
              {step === 3 && (
                <>
                  <AnswerOr
                    {...at("employees")}
                    label="How many people work in the business?"
                    value={facts.employees}
                    markers={["unknown", "unanswered", "not_applicable"]}
                    render={(v, change, labelledBy) => (
                      <input
                        id="employees"
                        aria-labelledby={labelledBy}
                        inputMode="numeric"
                        className="field sm:max-w-[10rem]"
                        value={v}
                        onChange={(e) => change(e.target.value.replace(/\D/g, "").slice(0, 7))}
                        data-testid="input-employees"
                      />
                    )}
                  />
                  <Choice
                    {...at("turnoverBand")}
                    label="Roughly, what is the business's turnover?"
                    hint="Turnover is the total of the business's sales over a period."
                    value={facts.turnoverBand}
                    options={known(Object.values(CheckerFactsTurnoverBand))}
                    markers={["unknown", "unanswered", "not_applicable"]}
                  />
                  {asked(facts, "turnoverYear") ? (
                    <>
                      <div>
                        <label className="label text-base" htmlFor="amount">
                          The exact figure, if you have it{" "}
                          <span className="font-normal text-muted-foreground">(optional)</span>
                        </label>
                        <div className="flex max-w-xs items-center gap-2">
                          <span className="text-muted-foreground" aria-hidden="true">
                            ₦
                          </span>
                          <input
                            id="amount"
                            inputMode="decimal"
                            className="field"
                            value={amountText || koboToNaira(facts.turnoverAmountKobo)}
                            aria-invalid={!!amountError}
                            aria-describedby="amount-hint"
                            onChange={(e) => {
                              const t = e.target.value;
                              setAmountText(t);
                              const k = nairaToKobo(t);
                              setAmountError(
                                t.trim() && !k ? "Use digits, with up to two decimal places." : null,
                              );
                              set("turnoverAmountKobo", k);
                            }}
                            data-testid="input-amount"
                          />
                        </div>
                        <p id="amount-hint" className={cn("hint", amountError && "!text-destructive")}>
                          {amountError ?? "In naira. Leave this blank if you would rather not say."}
                        </p>
                      </div>
                      <AnswerOr
                        {...at("turnoverYear")}
                        label="Which year is that figure for?"
                        value={facts.turnoverYear}
                        markers={["unknown", "unanswered", "not_applicable"]}
                        render={(v, change, labelledBy) => (
                          <input
                            id="turnoverYear"
                            aria-labelledby={labelledBy}
                            inputMode="numeric"
                            className="field sm:max-w-[8rem]"
                            value={v}
                            placeholder={"e.g. " + lastYear}
                            onChange={(e) => change(e.target.value.replace(/\D/g, "").slice(0, 4))}
                            data-testid="input-turnover-year"
                          />
                        )}
                      />
                      <Choice
                        {...at("turnoverPeriod")}
                        label="What period does the figure cover?"
                        value={facts.turnoverPeriod ?? "unanswered"}
                        options={known(Object.values(CheckerFactsTurnoverPeriod))}
                        markers={["unknown", "unanswered", "not_applicable"]}
                      />
                      <div className="grid gap-8 sm:grid-cols-2">
                        <AnswerOr
                          {...at("turnoverPeriodStart")}
                          label="First day of that period"
                          value={facts.turnoverPeriodStart ?? "unanswered"}
                          markers={["unknown", "unanswered", "not_applicable"]}
                          render={(v, change, labelledBy) => (
                            <input
                              id="turnoverPeriodStart"
                              aria-labelledby={labelledBy}
                              type="date"
                              className="field"
                              value={v}
                              onChange={(e) => change(e.target.value)}
                            />
                          )}
                        />
                        <AnswerOr
                          {...at("turnoverPeriodEnd")}
                          label="Last day of that period"
                          value={facts.turnoverPeriodEnd ?? "unanswered"}
                          markers={["unknown", "unanswered", "not_applicable"]}
                          render={(v, change, labelledBy) => (
                            <input
                              id="turnoverPeriodEnd"
                              aria-labelledby={labelledBy}
                              type="date"
                              className="field"
                              value={v}
                              onChange={(e) => change(e.target.value)}
                            />
                          )}
                        />
                      </div>
                      <div className="grid gap-8 sm:grid-cols-2">
                        <Choice
                          {...at("turnoverMetric")}
                          label="What does the figure measure?"
                          hint="Gross revenue is all sales, before any costs are taken off."
                          value={facts.turnoverMetric}
                          options={known(Object.values(CheckerFactsTurnoverMetric))}
                          markers={["unknown", "unanswered", "not_applicable"]}
                        />
                        <Choice
                          {...at("turnoverCurrency")}
                          label="Which currency is the figure in?"
                          value={facts.turnoverCurrency}
                          options={known(Object.values(CheckerFactsTurnoverCurrency))}
                          markers={["unknown", "unanswered", "not_applicable"]}
                        />
                      </div>
                    </>
                  ) : (
                    <p className="hint">
                      The questions about that figure are skipped because turnover does not apply.
                    </p>
                  )}
                </>
              )}
              {step === 4 && (
                <>
                  <Choice
                    {...at("personalData")}
                    label="Do you collect or keep customer or staff personal data?"
                    hint="Names, phone numbers, addresses, ID numbers and similar."
                    value={facts.personalData}
                    options={yesNo}
                    markers={["unknown", "unanswered"]}
                  />
                  <RichCheckerFields section="privacy" facts={facts} onChange={setFacts} />
                </>
              )}
              {step === REVIEW && (
                <>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    You can change any answer, or leave it as it is. Where an answer is missing, your results
                    say what more is needed.
                  </p>
                  <Review facts={final} onEdit={go} />
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
                <h2 className="font-display text-3xl">Results</h2>
                {stale && (
                  <span className="pill pill-ochre" data-testid="status-stale">
                    Answers changed since this result. Check again.
                  </span>
                )}
              </div>
              <AssessmentResultView
                result={result.r}
                // oxlint-disable-next-line react/no-unstable-nested-components -- a render function the result calls, not a component
                questionAction={(field) => {
                  const target = richQuestionTarget(field);
                  return target && (target.section !== "businessName" || isSignedIn) ? (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      aria-label={`Review ${factLabel(field)}`}
                      onClick={() => go(target.step, field)}
                    >
                      Review answer
                    </button>
                  ) : null;
                }}
              />
              {isSignedIn ? (
                <SavePanel
                  facts={final}
                  profileRevision={ws.data?.profileRevision ?? 0}
                  hasProfile={!!profile}
                  stale={!!stale}
                />
              ) : (
                <Notice className="mt-6" tone="ink" title="Want to keep this?">
                  Nothing here has been saved. With an account you can save your results and turn them into
                  tasks. The answers on this page are not carried over, so you would answer again after you{" "}
                  <Link href="/sign-up" className="font-medium underline">
                    create an account
                  </Link>
                  .
                </Notice>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
