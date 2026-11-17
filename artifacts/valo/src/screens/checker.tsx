import { useMemo, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useUser } from "@clerk/react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Loader2,
  Plus,
  RotateCcw,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";
import {
  usePreviewAssessment,
  usePreviewWorkspaceAssessment,
  useCreateAssessment,
  useGetWorkspace,
  getGetWorkspaceQueryKey,
  getListAssessmentsQueryKey,
  CheckerFactsState,
  CheckerFactsTurnoverBand,
  CheckerFactsTurnoverMetric,
  CheckerFactsTurnoverCurrency,
  CheckerFactsTurnoverPeriod,
  type CheckerFacts,
  type AssessmentResult,
  type Answer,
} from "@workspace/api-client-react";
import { AssessmentResultView } from "@/components/assessment-result";
import { RichCheckerFields } from "@/components/rich-checker-fields";
import { richQuestionTarget, richStep, type RichCheckerFacts } from "@/lib/rich-checker";
import { Notice } from "@/components/states";
import { describeError } from "@/lib/api";
import {
  EMPTY_FACTS,
  MARKER_LABEL,
  LEGAL_FORMS,
  REG_STATUSES,
  ANSWER_OPTIONS,
  reviewFacts,
  factsFromProfile,
  finaliseFacts,
  needsProducts,
  nairaToKobo,
  koboToNaira,
  isMarker,
  lagosToday,
  live,
  valueLabel,
  factLabel,
  displayFact,
  type Marker,
} from "@/lib/checker";
import { cn } from "@/lib/utils";
import { useAccountEpoch } from "@/components/account-state-boundary";

const STEPS = ["Business", "Activities", "Location", "Size and turnover", "Data", "Review"];

type Opt = { value: string; label: string };
const m = (...ks: Marker[]): Opt[] => ks.map((k) => ({ value: k, label: MARKER_LABEL[k] }));
const opts = (vals: string[]): Opt[] => vals.map((v) => ({ value: v, label: valueLabel(v) }));

export default function Checker() {
  const currentAccount = useAccountEpoch();
  const { isSignedIn } = useUser();
  const [facts, setFacts] = useState<RichCheckerFacts>(EMPTY_FACTS);
  const [step, setStep] = useState(0);
  const [result, setResult] = useState<{ r: AssessmentResult; sig: string } | null>(null);
  const [prefilledRev, setPrefilledRev] = useState<number | null>(null);
  const [amountText, setAmountText] = useState("");
  const [amountError, setAmountError] = useState<string | null>(null);
  const publicPreview = usePreviewAssessment();
  const workspacePreview = usePreviewWorkspaceAssessment();
  const preview = isSignedIn ? workspacePreview : publicPreview;

  const ws = useGetWorkspace({
    query: { enabled: !!isSignedIn, queryKey: getGetWorkspaceQueryKey(), ...live },
  });
  const profile = isSignedIn ? (ws.data?.profile ?? null) : null;

  const set = <K extends keyof CheckerFacts>(k: K, v: CheckerFacts[K]) => setFacts((o) => ({ ...o, [k]: v }));
  const final = useMemo(() => finaliseFacts(facts), [facts]);
  const sig = JSON.stringify(final);
  const stale = result && result.sig !== sig;

  function prefill() {
    if (!ws.data?.profile) return;
    setFacts((current) => ({
      ...factsFromProfile(ws.data!.profile!),
      ...(current.rich ? { factsVersion: current.factsVersion, rich: current.rich } : {}),
    }));
    setAmountText("");
    setAmountError(null);
    setPrefilledRev(ws.data.profileRevision);
    setStep(0);
  }

  function reset() {
    setFacts(EMPTY_FACTS);
    setAmountText("");
    setAmountError(null);
    setResult(null);
    setPrefilledRev(null);
    setStep(0);
    publicPreview.reset();
    workspacePreview.reset();
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

  function go(n: number, field?: string) {
    const target = field ? richQuestionTarget(field) : undefined;
    const nextStep = target?.step ?? n;
    if (step === 3 && nextStep > 3 && amountText && amountError) return;
    setStep(nextStep);
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

  const err = preview.error ? describeError(preview.error) : null;

  return (
    <div className="mx-auto max-w-6xl px-5 py-12 lg:px-8">
      <header className="reveal max-w-3xl">
        <p className="eyebrow">Requirements checker</p>
        <h1 className="font-display mt-3 text-4xl leading-[1.08] sm:text-5xl">
          What might apply to your business, and why.
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
          Answer what you know. "I do not know" and "Skip for now" are recorded differently, and both are
          fine. Results only come from released, source-checked rules.
        </p>
      </header>

      <div className="mt-8 flex flex-wrap items-center gap-2">
        {isSignedIn ? (
          ws.isLoading ? (
            <span className="pill pill-ink">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading your profile
            </span>
          ) : profile ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={prefill}
              data-testid="button-prefill"
            >
              <UserRound className="h-4 w-4" />
              {prefilledRev
                ? "Prefilled from profile rev " + prefilledRev + " · reload"
                : "Prefill from my profile (rev " + ws.data?.profileRevision + ")"}
            </button>
          ) : (
            <Link href="/workspace/profile" className="btn btn-ghost btn-sm">
              Set up a profile to prefill
            </Link>
          )
        ) : (
          <span className="pill pill-ink" data-testid="text-anonymous">
            <ShieldCheck className="h-3.5 w-3.5" />
            Anonymous. Answers stay in this tab only and are never saved.
          </span>
        )}
        <button type="button" className="btn btn-ghost btn-sm" onClick={reset} data-testid="button-reset">
          <RotateCcw className="h-4 w-4" />
          Start over
        </button>
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[13rem_1fr]">
        <ol
          className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible"
          aria-label="Questionnaire steps"
        >
          {STEPS.map((s, i) => (
            <li key={s}>
              <button
                type="button"
                onClick={() => go(i)}
                aria-current={i === step ? "step" : undefined}
                className={cn(
                  "flex w-full items-center gap-3 whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm transition-colors",
                  i === step
                    ? "bg-accent font-medium text-accent-foreground"
                    : "text-muted-foreground hover:bg-secondary",
                )}
                data-testid={"button-step-" + i}
              >
                <span
                  className={cn(
                    "grid h-6 w-6 shrink-0 place-items-center rounded-full border font-mono text-[0.7rem]",
                    i < step ? "border-primary bg-primary text-primary-foreground" : "border-border",
                  )}
                >
                  {i < step ? <Check className="h-3 w-3" /> : i + 1}
                </span>
                {s}
              </button>
            </li>
          ))}
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
            <div className="mt-6 grid gap-7">
              {step === 0 && (
                <>
                  <Choice
                    name="legalForm"
                    label="How is the business set up?"
                    value={facts.legalForm}
                    options={[...opts(LEGAL_FORMS), ...m("unknown", "unanswered")]}
                    onChange={(v) => set("legalForm", v)}
                  />
                  <Choice
                    name="registrationStatus"
                    label="Is it registered with the CAC?"
                    value={facts.registrationStatus}
                    options={[...opts(REG_STATUSES), ...m("unknown", "unanswered")]}
                    onChange={(v) => set("registrationStatus", v)}
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
                  <ListOrMarker
                    name="activities"
                    label="What does the business do?"
                    hint="In your own words, up to 10."
                    value={facts.activities}
                    onChange={(v) => set("activities", v)}
                    placeholder="e.g. Selling fabric wholesale"
                  />
                  <Choice
                    name="manufacturing"
                    label="Do you manufacture or process goods?"
                    value={facts.manufacturing}
                    options={ansOpts()}
                    onChange={(v) => set("manufacturing", v as Answer)}
                  />
                  <Choice
                    name="importing"
                    label="Do you import goods into Nigeria?"
                    value={facts.importing}
                    options={ansOpts()}
                    onChange={(v) => set("importing", v as Answer)}
                  />
                  {needsProducts(facts) && (
                    <ListOrMarker
                      name="productTypes"
                      label="Which product types?"
                      hint="Asked because you manufacture or import."
                      value={facts.productTypes ?? "unanswered"}
                      onChange={(v) => set("productTypes", v)}
                      placeholder="e.g. Packaged snacks"
                    />
                  )}
                  <RichCheckerFields section="product" facts={facts} onChange={setFacts} />
                </>
              )}
              {step === 2 && (
                <>
                  <Choice
                    name="premises"
                    label="Do you operate from physical premises?"
                    value={facts.premises}
                    options={ansOpts()}
                    onChange={(v) => set("premises", v as Answer)}
                  />
                  <div>
                    <label className="label" htmlFor="state">
                      State or FCT
                    </label>
                    <select
                      id="state"
                      className="field sm:max-w-xs"
                      value={facts.state}
                      onChange={(e) => set("state", e.target.value as CheckerFacts["state"])}
                      data-testid="select-state"
                    >
                      <option value="unanswered">{MARKER_LABEL.unanswered}</option>
                      <option value="unknown">{MARKER_LABEL.unknown}</option>
                      {Object.values(CheckerFactsState)
                        .filter((s) => !isMarker(s))
                        .map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                    </select>
                  </div>
                  {facts.premises === "no" ? (
                    <p className="hint">Local government area skipped because you have no premises.</p>
                  ) : (
                    <ValueOrMarker
                      name="lga"
                      label="Local government area"
                      value={facts.lga}
                      markers={["unknown", "unanswered"]}
                      onChange={(v) => set("lga", v)}
                      render={(v, s) => (
                        <input
                          id="lga"
                          className="field sm:max-w-xs"
                          maxLength={100}
                          value={v}
                          placeholder="e.g. Ikeja"
                          onChange={(e) => s(e.target.value)}
                          data-testid="input-lga"
                        />
                      )}
                    />
                  )}
                </>
              )}
              {step === 3 && (
                <>
                  <ValueOrMarker
                    name="employees"
                    label="How many people work in the business?"
                    value={facts.employees}
                    markers={["unknown", "unanswered", "not_applicable"]}
                    defaultValue="0"
                    onChange={(v) => set("employees", v)}
                    render={(v, s) => (
                      <input
                        id="employees"
                        inputMode="numeric"
                        className="field sm:max-w-[10rem]"
                        value={v}
                        onChange={(e) => s(e.target.value.replace(/\D/g, "").slice(0, 7))}
                        data-testid="input-employees"
                      />
                    )}
                  />
                  <Choice
                    name="turnoverBand"
                    label="Turnover band"
                    value={facts.turnoverBand}
                    options={mixOpts(Object.values(CheckerFactsTurnoverBand))}
                    onChange={(v) => set("turnoverBand", v as CheckerFacts["turnoverBand"])}
                  />
                  <ValueOrMarker
                    name="turnoverYear"
                    label="Turnover year"
                    value={facts.turnoverYear}
                    markers={["unknown", "unanswered", "not_applicable"]}
                    defaultValue={String(new Date().getFullYear() - 1)}
                    onChange={(v) => set("turnoverYear", v)}
                    render={(v, s) => (
                      <input
                        id="turnoverYear"
                        inputMode="numeric"
                        className="field sm:max-w-[8rem]"
                        value={v}
                        onChange={(e) => s(e.target.value.replace(/\D/g, "").slice(0, 4))}
                        data-testid="input-turnover-year"
                      />
                    )}
                  />
                  <div className="grid gap-7 sm:grid-cols-2">
                    <Choice
                      name="turnoverMetric"
                      label="Measured as"
                      value={facts.turnoverMetric}
                      options={mixOpts(Object.values(CheckerFactsTurnoverMetric))}
                      onChange={(v) => set("turnoverMetric", v as CheckerFacts["turnoverMetric"])}
                    />
                    <Choice
                      name="turnoverCurrency"
                      label="Currency"
                      value={facts.turnoverCurrency}
                      options={mixOpts(Object.values(CheckerFactsTurnoverCurrency))}
                      onChange={(v) => set("turnoverCurrency", v as CheckerFacts["turnoverCurrency"])}
                    />
                  </div>
                  <Choice
                    name="turnoverPeriod"
                    label="Period"
                    value={facts.turnoverPeriod ?? "unanswered"}
                    options={mixOpts(Object.values(CheckerFactsTurnoverPeriod))}
                    onChange={(v) => set("turnoverPeriod", v as CheckerFacts["turnoverPeriod"])}
                  />
                  <div>
                    <label className="label" htmlFor="amount">
                      Exact turnover in naira{" "}
                      <span className="font-normal text-muted-foreground">(optional)</span>
                    </label>
                    <div className="flex max-w-xs items-center gap-2">
                      <span className="font-mono text-sm text-muted-foreground">NGN</span>
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
                      {amountError ?? "Leave blank if you prefer not to say. Stored as whole kobo."}
                    </p>
                  </div>
                  <div className="grid gap-7 sm:grid-cols-2">
                    <ValueOrMarker
                      name="turnoverPeriodStart"
                      label="Period start"
                      value={facts.turnoverPeriodStart ?? "unanswered"}
                      markers={["unknown", "unanswered", "not_applicable"]}
                      defaultValue=""
                      onChange={(v) => set("turnoverPeriodStart", v)}
                      render={(v, s) => (
                        <input
                          id="turnoverPeriodStart"
                          type="date"
                          className="field"
                          value={v}
                          onChange={(e) => s(e.target.value || "unanswered")}
                        />
                      )}
                    />
                    <ValueOrMarker
                      name="turnoverPeriodEnd"
                      label="Period end"
                      value={facts.turnoverPeriodEnd ?? "unanswered"}
                      markers={["unknown", "unanswered", "not_applicable"]}
                      defaultValue=""
                      onChange={(v) => set("turnoverPeriodEnd", v)}
                      render={(v, s) => (
                        <input
                          id="turnoverPeriodEnd"
                          type="date"
                          className="field"
                          value={v}
                          onChange={(e) => s(e.target.value || "unanswered")}
                        />
                      )}
                    />
                  </div>
                </>
              )}
              {step === 4 && (
                <>
                  <Choice
                    name="personalData"
                    label="Do you collect or keep customer or staff personal data?"
                    hint="Names, phone numbers, addresses, ID numbers and similar."
                    value={facts.personalData}
                    options={ansOpts()}
                    onChange={(v) => set("personalData", v as Answer)}
                  />
                  <RichCheckerFields section="privacy" facts={facts} onChange={setFacts} />
                </>
              )}
              {step === 5 && <Review facts={final} onEdit={go} />}
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
              {step < 5 ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => go(step + 1)}
                  disabled={step === 3 && !!amountError}
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
                  {result ? "Check again" : "Check these answers"}
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
                  Nothing here has been saved.{" "}
                  <Link href="/sign-up" className="font-medium underline">
                    Open a workspace
                  </Link>{" "}
                  to save a consented copy and turn items into tasks.
                </Notice>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function ansOpts(): Opt[] {
  return [...opts(["yes", "no"]), ...m("unknown", "unanswered")].filter((o) =>
    (ANSWER_OPTIONS as string[]).includes(o.value),
  );
}
function mixOpts(vals: string[]): Opt[] {
  return vals.map((v) => ({ value: v, label: isMarker(v) ? MARKER_LABEL[v] : valueLabel(v) }));
}

function Choice({
  name,
  label,
  hint,
  value,
  options,
  onChange,
}: {
  name: string;
  label: string;
  hint?: string;
  value: string;
  options: Opt[];
  onChange: (v: string) => void;
}) {
  return (
    <fieldset>
      <legend className="label">{label}</legend>
      {hint && <p className="hint !mt-0 mb-2">{hint}</p>}
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const on = value === o.value;
          return (
            <label
              key={o.value}
              className={cn(
                "cursor-pointer rounded-full border px-3.5 py-2 text-sm transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring",
                on
                  ? "border-primary bg-primary text-primary-foreground"
                  : isMarker(o.value)
                    ? "border-dashed border-input text-muted-foreground hover:bg-secondary"
                    : "border-input hover:bg-secondary",
              )}
            >
              <input
                type="radio"
                className="sr-only"
                name={name}
                value={o.value}
                checked={on}
                onChange={() => onChange(o.value)}
                data-testid={"radio-" + name + "-" + o.value}
              />
              {o.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function ValueOrMarker({
  name,
  label,
  value,
  markers,
  defaultValue = "",
  onChange,
  render,
}: {
  name: string;
  label: string;
  value: string;
  markers: Marker[];
  defaultValue?: string;
  onChange: (v: string) => void;
  render: (v: string, set: (v: string) => void) => ReactNode;
}) {
  const mode = isMarker(value) ? value : "value";
  return (
    <fieldset>
      <legend className="label">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {(["value", ...markers] as const).map((k) => (
          <label
            key={k}
            className={cn(
              "cursor-pointer rounded-full border px-3.5 py-2 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring",
              mode === k
                ? "border-primary bg-primary text-primary-foreground"
                : "border-dashed border-input text-muted-foreground hover:bg-secondary",
            )}
          >
            <input
              type="radio"
              className="sr-only"
              name={name + "-mode"}
              checked={mode === k}
              onChange={() => onChange(k === "value" ? defaultValue : k)}
              data-testid={"radio-" + name + "-" + k}
            />
            {k === "value" ? "I can answer" : MARKER_LABEL[k]}
          </label>
        ))}
      </div>
      {mode === "value" && <div className="mt-3">{render(value, onChange)}</div>}
    </fieldset>
  );
}

function ListOrMarker({
  name,
  label,
  hint,
  value,
  onChange,
  placeholder,
}: {
  name: string;
  label: string;
  hint: string;
  value: string[] | Marker;
  onChange: (v: string[] | Marker) => void;
  placeholder: string;
}) {
  const list = Array.isArray(value) ? value : null;
  return (
    <fieldset>
      <legend className="label">{label}</legend>
      <p className="hint !mt-0 mb-2">{hint}</p>
      <div className="flex flex-wrap gap-2">
        {(["list", "unknown", "unanswered"] as const).map((k) => {
          const on = k === "list" ? !!list : value === k;
          return (
            <label
              key={k}
              className={cn(
                "cursor-pointer rounded-full border px-3.5 py-2 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring",
                on
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-dashed border-input text-muted-foreground hover:bg-secondary",
              )}
            >
              <input
                type="radio"
                className="sr-only"
                name={name + "-mode"}
                checked={on}
                onChange={() => onChange(k === "list" ? [""] : k)}
                data-testid={"radio-" + name + "-" + k}
              />
              {k === "list" ? "List them" : MARKER_LABEL[k]}
            </label>
          );
        })}
      </div>
      {list && (
        <div className="mt-3 grid gap-2">
          {list.map((a, i) => (
            <div key={i} className="flex gap-2">
              <input
                aria-label={label + " " + (i + 1)}
                className="field"
                maxLength={120}
                value={a}
                placeholder={placeholder}
                onChange={(e) => onChange(list.map((x, j) => (j === i ? e.target.value : x)))}
                data-testid={"input-" + name + "-" + i}
              />
              {list.length > 1 && (
                <button
                  type="button"
                  aria-label={"Remove item " + (i + 1)}
                  className="btn btn-ghost !px-3"
                  onClick={() => onChange(list.filter((_, j) => j !== i))}
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
          {list.length < 10 && (
            <button
              type="button"
              className="btn btn-ghost btn-sm w-fit"
              onClick={() => onChange([...list, ""])}
            >
              <Plus className="h-4 w-4" />
              Add another
            </button>
          )}
        </div>
      )}
    </fieldset>
  );
}

const STEP_OF: Record<string, number> = {
  legalForm: 0,
  registrationStatus: 0,
  activities: 1,
  productTypes: 1,
  manufacturing: 1,
  importing: 1,
  premises: 2,
  state: 2,
  lga: 2,
  personalData: 4,
};

function Review({ facts, onEdit }: { facts: RichCheckerFacts; onEdit: (n: number, field?: string) => void }) {
  return (
    <dl className="grid gap-0 text-sm" data-testid="list-review">
      {reviewFacts(facts).map(([k, value]) => (
        <div
          key={k}
          className="grid grid-cols-[1fr_auto] items-baseline gap-x-4 border-t border-border py-2.5 sm:grid-cols-[14rem_1fr_auto]"
        >
          <dt className="text-muted-foreground">{factLabel(k)}</dt>
          <dd
            className={cn(
              "col-start-1 row-start-2 break-words sm:col-start-2 sm:row-start-1",
              isMarker(value) || value === null ? "italic text-muted-foreground" : "",
            )}
          >
            {displayFact(k, value)}
          </dd>
          <button
            type="button"
            aria-label={"Edit " + factLabel(k)}
            className="col-start-2 row-span-2 row-start-1 text-xs font-medium text-primary underline-offset-2 hover:underline sm:col-start-3 sm:row-span-1"
            onClick={() => onEdit(k.startsWith("rich.") ? richStep(k) : (STEP_OF[k] ?? 3), k)}
          >
            Edit
          </button>
        </div>
      ))}
    </dl>
  );
}

function SavePanel({
  facts,
  profileRevision,
  hasProfile,
  stale,
}: {
  facts: RichCheckerFacts;
  profileRevision: number;
  hasProfile: boolean;
  stale: boolean;
}) {
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const [consent, setConsent] = useState(false);
  const [mode, setMode] = useState<"answers" | "profile">("answers");
  const create = useCreateAssessment();
  const e = create.error ? describeError(create.error) : null;

  function save() {
    const data =
      mode === "answers"
        ? { facts, asOfDate: lagosToday(), saveConsent: true as const }
        : {
            asOfDate: lagosToday(),
            saveConsent: true as const,
            ...(profileRevision >= 1 ? { expectedProfileRevision: profileRevision } : {}),
          };
    create.mutate(
      { data },
      {
        onSuccess: (a) => {
          void qc.invalidateQueries({ queryKey: getListAssessmentsQueryKey() });
          setLocation("/workspace/assessments/" + a.id);
        },
        onError: (er) => {
          if (describeError(er).kind === "conflict")
            void qc.invalidateQueries({ queryKey: getGetWorkspaceQueryKey() });
        },
      },
    );
  }

  return (
    <div className="surface mt-8 p-5 sm:p-7" data-testid="panel-save">
      <p className="eyebrow">Save to your workspace</p>
      <fieldset className="mt-4 grid gap-2">
        <legend className="sr-only">What to save</legend>
        <label
          className={cn(
            "flex cursor-pointer gap-3 rounded-xl border p-4 text-sm",
            mode === "answers" ? "border-primary bg-accent/50" : "border-border",
          )}
        >
          <input
            type="radio"
            name="save-mode"
            className="mt-0.5 accent-[hsl(155_42%_21%)]"
            checked={mode === "answers"}
            onChange={() => setMode("answers")}
            data-testid="radio-save-answers"
          />
          <span>
            <span className="font-medium">These questionnaire answers</span>
            <span className="block text-muted-foreground">
              Saved as a snapshot. Your business profile is not changed.
            </span>
          </span>
        </label>
        <label
          className={cn(
            "flex gap-3 rounded-xl border p-4 text-sm",
            !hasProfile ? "cursor-not-allowed opacity-60" : "cursor-pointer",
            mode === "profile" ? "border-primary bg-accent/50" : "border-border",
          )}
        >
          <input
            type="radio"
            name="save-mode"
            className="mt-0.5 accent-[hsl(155_42%_21%)]"
            disabled={!hasProfile}
            checked={mode === "profile"}
            onChange={() => setMode("profile")}
            data-testid="radio-save-profile"
          />
          <span>
            <span className="font-medium">My saved profile, revision {profileRevision}</span>
            <span className="block text-muted-foreground">
              {hasProfile
                ? "The server re-checks using that exact revision. This choice excludes the optional details entered above. If the profile has changed since, saving stops."
                : "No saved profile yet."}
            </span>
          </span>
        </label>
      </fieldset>
      <label className="mt-4 flex cursor-pointer items-start gap-3 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 accent-[hsl(155_42%_21%)]"
          checked={consent}
          onChange={(ev) => setConsent(ev.target.checked)}
          data-testid="checkbox-save-consent"
        />
        <span>I agree to Valo storing this assessment privately in my workspace.</span>
      </label>
      {stale && mode === "answers" && (
        <p className="hint">
          You edited answers after this result. The saved copy is re-checked against your current answers.
        </p>
      )}
      {e && (
        <p role="alert" className="mt-4 rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {e.kind === "conflict"
            ? "Your profile changed since this page loaded. The revision shown above has been refreshed; review it and save again."
            : e.message}
        </p>
      )}
      <button
        type="button"
        className="btn btn-primary mt-5"
        disabled={!consent || create.isPending}
        onClick={save}
        data-testid="button-save-assessment"
      >
        {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Save assessment
      </button>
    </div>
  );
}
