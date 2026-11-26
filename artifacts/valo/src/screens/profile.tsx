import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useSearch } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, X } from "lucide-react";
import {
  useGetAssessment,
  useGetWorkspace,
  useSaveBusinessProfile,
  getGetAssessmentQueryKey,
  getGetWorkspaceQueryKey,
  Answer,
  ProfileLegalForm,
  ProfileRegistrationStatus,
  ProfileTurnoverBand,
  ProfileTurnoverCurrency,
  ProfileTurnoverMetric,
  ProfileState,
  type Profile,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useAccountEpoch } from "@/components/account-state-boundary";
import { ErrorState, Notice, Skel } from "@/components/states";
import { describeError } from "@/lib/api";
import { valueLabel } from "@/lib/checker";
import { profileFromAssessmentFacts } from "@/lib/profile-prefill";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { WorkspaceNav } from "@/components/workspace-nav";
import { useUnsavedNavigation } from "@/lib/use-unsaved-navigation";
import { UnsavedNavigationDialog } from "@/components/unsaved-navigation-dialog";

const EMPTY: Profile = {
  businessName: "",
  legalForm: "unknown",
  registrationStatus: "unknown",
  activities: [""],
  state: "unanswered",
  lga: "",
  employees: "unanswered",
  turnoverBand: "unanswered",
  turnoverYear: "unknown",
  turnoverMetric: "unknown",
  turnoverCurrency: "unknown",
  premises: "unanswered",
  manufacturing: "unanswered",
  importing: "unanswered",
  personalData: "unanswered",
  marketingConsent: false,
};

/** An answer in words, as it reads in the requirements check and in a saved result. */
const label = valueLabel;

export default function ProfilePage() {
  const currentAccount = useAccountEpoch();
  const search = useSearch();
  const fromAssessmentId = useMemo(
    () => new URLSearchParams(search).get("fromAssessment")?.trim() ?? "",
    [search],
  );
  const qc = useQueryClient();
  const { toast } = useToast();
  const online = useOnlineStatus();
  const ws = useGetWorkspace({ query: { enabled: true, queryKey: getGetWorkspaceQueryKey() } });
  const sourceCheck = useGetAssessment(fromAssessmentId, {
    query: {
      enabled: Boolean(fromAssessmentId),
      queryKey: getGetAssessmentQueryKey(fromAssessmentId),
    },
  });
  const save = useSaveBusinessProfile();
  const [p, setP] = useState<Profile>(EMPTY);
  const [touched, setTouched] = useState(false);
  const [prefilledCount, setPrefilledCount] = useState(0);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [conflict, setConflict] = useState(false);
  const init = useRef(false);
  const prefillApplied = useRef<string | null>(null);
  const form = useRef<HTMLFormElement>(null),
    leaving = useRef(false);
  const navigation = useUnsavedNavigation(() => touched || save.isPending);

  useEffect(() => {
    if (ws.data && !init.current) {
      init.current = true;
      if (ws.data.profile)
        setP({
          ...ws.data.profile,
          activities: ws.data.profile.activities.length ? ws.data.profile.activities : [""],
        });
    }
  }, [ws.data]);

  useEffect(() => {
    if (!fromAssessmentId || !ws.data || !sourceCheck.data || prefillApplied.current === fromAssessmentId)
      return;
    prefillApplied.current = fromAssessmentId;
    const base: Profile = ws.data.profile
      ? {
          ...ws.data.profile,
          activities: ws.data.profile.activities.length ? ws.data.profile.activities : [""],
        }
      : EMPTY;
    const merged = profileFromAssessmentFacts(sourceCheck.data.facts, base);
    if (merged.appliedCount > 0) {
      setP(merged.profile);
      setTouched(true);
      setPrefilledCount(merged.appliedCount);
    }
  }, [fromAssessmentId, ws.data, sourceCheck.data]);

  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => {
    setTouched(true);
    setP((o) => ({ ...o, [k]: v }));
  };
  const acts = p.activities.map((a) => a.trim()).filter(Boolean);
  const empMode = ["unknown", "unanswered", "not_applicable"].includes(p.employees) ? p.employees : "number";
  const yearMode = p.turnoverYear === "unknown" ? "unknown" : "year";
  const errors: Record<string, string> = {};
  if (!p.businessName.trim()) errors.businessName = "Enter the name you trade under.";
  if (acts.length < 1) errors.activities = "Add at least one activity.";
  if (empMode === "number" && !/^[0-9]{1,7}$/.test(p.employees)) errors.employees = "Use a whole number.";
  if (yearMode === "year" && !/^[0-9]{4}$/.test(p.turnoverYear))
    errors.turnoverYear = "Use a four-digit year.";

  const errorFields: { key: keyof typeof errors; id: string; label: string }[] = [
    { key: "businessName", id: "businessName", label: "Business name" },
    { key: "activities", id: "activity-0", label: "Activities" },
    { key: "employees", id: "employees", label: "Employees" },
    { key: "turnoverYear", id: "turnoverYear", label: "Turnover year" },
  ];
  const activeErrors = errorFields.filter((field) => errors[field.key]);

  function focusField(id: string) {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.focus();
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (activeErrors.length) {
      setSubmitAttempted(true);
      focusField(activeErrors[0]!.id);
      return;
    }
    setSubmitAttempted(false);
    if (!ws.data) return;
    save.mutate(
      {
        data: {
          expectedRevision: ws.data.profileRevision,
          profile: {
            ...p,
            businessName: p.businessName.trim(),
            activities: acts,
            state: p.state,
            lga: p.lga.trim(),
          },
        },
      },
      {
        onSuccess: (next) => {
          if (!currentAccount()) return;
          setTouched(false);
          setConflict(false);
          qc.setQueryData(getGetWorkspaceQueryKey(), next);
          toast({ title: "Profile saved", description: "Saved as version " + next.profileRevision + "." });
          if (leaving.current) {
            leaving.current = false;
            navigation.proceed();
          }
        },
        onError: (err) => {
          if (!currentAccount()) return;
          leaving.current = false;
          if (describeError(err).kind === "conflict") setConflict(true);
        },
      },
    );
  }

  async function reloadLatest() {
    const r = await ws.refetch();
    if (!currentAccount()) return;
    if (r.data?.profile)
      setP({
        ...r.data.profile,
        activities: r.data.profile.activities.length ? r.data.profile.activities : [""],
      });
    setTouched(false);
    setSubmitAttempted(false);
    setConflict(false);
    save.reset();
  }

  if (ws.isLoading)
    return (
      <div className="mx-auto max-w-3xl px-5 py-12">
        <Skel className="h-[32rem]" />
      </div>
    );
  if (ws.isError)
    return (
      <div className="mx-auto max-w-3xl px-5 py-12">
        <ErrorState error={ws.error} onRetry={() => ws.refetch()} />
      </div>
    );

  const err = save.error ? describeError(save.error) : null;
  const sel = (id: keyof Profile, opts: Record<string, string>, l: string, hint?: string) => (
    <Field label={l} id={id} hint={hint}>
      <select
        id={id}
        className="field"
        value={p[id] as string}
        onChange={(e) => set(id, e.target.value as never)}
        data-testid={"select-" + id}
      >
        {Object.values(opts).map((o) => (
          <option key={o} value={o}>
            {label(o)}
          </option>
        ))}
      </select>
    </Field>
  );

  return (
    <div className="mx-auto max-w-3xl px-5 py-12 lg:px-8">
      <WorkspaceNav />
      <Breadcrumbs items={[{ label: "Home", href: "/workspace" }, { label: "Business profile" }]} />
      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-display text-4xl">Business profile</h1>
        <span className="text-sm text-muted-foreground" data-testid="text-profile-revision">
          {ws.data?.profileRevision ? `Version ${ws.data.profileRevision}` : "Not saved yet"}
        </span>
      </div>
      <p className="mt-2 text-muted-foreground">
        Each save keeps a new version. &ldquo;I do not know&rdquo; is always an acceptable answer.
      </p>
      {!online && (
        <Notice className="mt-6" title="You are offline">
          Keep filling out this form — your answers stay in this tab until you are back online to save.
        </Notice>
      )}
      {prefilledCount > 0 && (
        <Notice className="mt-6" tone="forest" title="Pre-filled from your saved check">
          {prefilledCount === 1
            ? "1 answer was copied into this form."
            : `${prefilledCount} answers were copied into this form.`}{" "}
          Review them, enter your business name if needed, and select <strong>Save profile</strong> to keep
          them.
        </Notice>
      )}

      <form ref={form} onSubmit={submit} noValidate className="mt-8 grid gap-6">
        <Section title="Identity">
          <Field label="Business name" id="businessName" error={touched ? errors.businessName : undefined}>
            <input
              id="businessName"
              className="field"
              maxLength={160}
              value={p.businessName}
              aria-invalid={touched && !!errors.businessName}
              onChange={(e) => set("businessName", e.target.value)}
              data-testid="input-business-name"
            />
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            {sel(
              "legalForm",
              ProfileLegalForm,
              "Legal form",
              "For example: Business Name (sole trader or partnership), Private Limited Company (Ltd), or Unregistered.",
            )}
            {sel(
              "registrationStatus",
              ProfileRegistrationStatus,
              "Registration with the Corporate Affairs Commission (CAC)",
              "Whether your business name or company currently holds a CAC registration certificate.",
            )}
          </div>
        </Section>

        <Section title="What you do">
          <Field
            label="Activities"
            id="activity-0"
            error={touched ? errors.activities : undefined}
            hint="Up to 10, in your own words."
          >
            <div className="grid gap-2">
              {p.activities.map((a, i) => (
                <div key={i} className="flex gap-2">
                  <label className="sr-only" htmlFor={"activity-" + i}>
                    Business activity {i + 1}
                  </label>
                  <input
                    id={"activity-" + i}
                    className="field"
                    maxLength={120}
                    value={a}
                    placeholder="e.g. Selling fabric wholesale"
                    onChange={(e) =>
                      set(
                        "activities",
                        p.activities.map((x, j) => (j === i ? e.target.value : x)),
                      )
                    }
                    data-testid={"input-activity-" + i}
                  />
                  {p.activities.length > 1 && (
                    <button
                      type="button"
                      aria-label={"Remove business activity " + (i + 1)}
                      className="btn btn-ghost !px-3"
                      onClick={() =>
                        set(
                          "activities",
                          p.activities.filter((_, j) => j !== i),
                        )
                      }
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
              {p.activities.length < 10 && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm w-fit"
                  onClick={() => set("activities", [...p.activities, ""])}
                  data-testid="button-add-activity"
                >
                  <Plus className="h-4 w-4" /> Add activity
                </button>
              )}
            </div>
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="State or FCT" id="state">
              <select
                id="state"
                className="field"
                value={p.state}
                onChange={(e) => set("state", e.target.value as ProfileState)}
                data-testid="input-state"
              >
                {Object.values(ProfileState).map((state) => (
                  <option key={state} value={state}>
                    {label(state)}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="LGA"
              id="lga"
              hint="Local Government Area, such as Ikeja, Surulere or Abuja Municipal."
            >
              <input
                id="lga"
                className="field"
                maxLength={100}
                value={p.lga}
                placeholder="e.g. Ikeja"
                onChange={(e) => set("lga", e.target.value)}
                data-testid="input-lga"
              />
            </Field>
          </div>
        </Section>

        <Section title="Size">
          <Field label="Employees" id="employees" error={touched ? errors.employees : undefined}>
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr]">
              <select
                className="field"
                aria-label="Employees answer type"
                value={empMode}
                onChange={(e) => set("employees", e.target.value === "number" ? "0" : e.target.value)}
                data-testid="select-employees-mode"
              >
                <option value="number">I know the number</option>
                <option value="unknown">{label("unknown")}</option>
                <option value="unanswered">{label("unanswered")}</option>
                <option value="not_applicable">{label("not_applicable")}</option>
              </select>
              {empMode === "number" && (
                <input
                  id="employees"
                  inputMode="numeric"
                  className="field"
                  value={p.employees}
                  aria-invalid={touched && !!errors.employees}
                  onChange={(e) => set("employees", e.target.value.replace(/[^0-9]/g, "").slice(0, 7))}
                  data-testid="input-employees"
                />
              )}
            </div>
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            {sel("turnoverBand", ProfileTurnoverBand, "Annual turnover band")}
            <Field label="Turnover year" id="turnoverYear" error={touched ? errors.turnoverYear : undefined}>
              <div className="grid grid-cols-2 gap-2">
                <select
                  className="field"
                  aria-label="Year answer type"
                  value={yearMode}
                  onChange={(e) =>
                    set(
                      "turnoverYear",
                      e.target.value === "unknown" ? "unknown" : String(new Date().getFullYear() - 1),
                    )
                  }
                  data-testid="select-year-mode"
                >
                  <option value="unknown">{label("unknown")}</option>
                  <option value="year">I know the year</option>
                </select>
                {yearMode === "year" && (
                  <input
                    id="turnoverYear"
                    inputMode="numeric"
                    className="field"
                    value={p.turnoverYear}
                    onChange={(e) => set("turnoverYear", e.target.value.replace(/[^0-9]/g, "").slice(0, 4))}
                    data-testid="input-turnover-year"
                  />
                )}
              </div>
            </Field>
            {sel("turnoverMetric", ProfileTurnoverMetric, "Turnover measured as")}
            {sel("turnoverCurrency", ProfileTurnoverCurrency, "Currency")}
          </div>
        </Section>

        <Section title="Characteristics">
          <div className="grid gap-5 sm:grid-cols-2">
            {sel(
              "premises",
              Answer,
              "Do you operate from premises?",
              "Yes for a shop, office, workshop or warehouse; No if home-based or online-only.",
            )}
            {sel("manufacturing", Answer, "Do you manufacture goods?")}
            {sel("importing", Answer, "Do you import goods?")}
            {sel(
              "personalData",
              Answer,
              "Do you hold customer personal data?",
              "Names, phone numbers, addresses, ID numbers or similar records.",
            )}
          </div>
        </Section>

        <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-border p-5 text-sm">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 accent-[hsl(155_42%_21%)]"
            checked={p.marketingConsent}
            onChange={(e) => set("marketingConsent", e.target.checked)}
            data-testid="checkbox-marketing"
          />
          <span>
            Send me occasional product updates.{" "}
            <span className="text-muted-foreground">
              Optional, off by default. Saying no changes nothing else you can do.{" "}
              <Link
                href="/privacy"
                className="underline underline-offset-2"
                data-testid="link-profile-privacy"
              >
                What Valo does with your data
              </Link>
            </span>
          </span>
        </label>

        {conflict && (
          <Notice title="This profile changed in another tab">
            What you typed is still here. Load the newest saved version to carry on. That replaces what is in
            the form, so copy anything you need first.
            <button
              type="button"
              className="btn btn-ink btn-sm mt-3"
              onClick={reloadLatest}
              data-testid="button-reload-profile"
            >
              Load the newest version
            </button>
          </Notice>
        )}
        {submitAttempted && activeErrors.length > 0 && (
          <div
            role="alert"
            className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive"
            data-testid="status-profile-validation"
          >
            <p className="font-medium">Check these details before saving:</p>
            <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
              {activeErrors.map((field) => (
                <li key={field.key}>
                  <button
                    type="button"
                    className="underline underline-offset-4"
                    onClick={() => focusField(field.id)}
                  >
                    {field.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {err && !conflict && (
          <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {err.message}
          </p>
        )}

        <div className="held-actions sticky bottom-24 z-10 flex justify-end lg:bottom-4">
          <button
            type="submit"
            className="btn btn-primary"
            disabled={save.isPending}
            data-testid="button-save-profile"
          >
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />} Save profile
          </button>
        </div>
      </form>
      <UnsavedNavigationDialog
        open={navigation.blocked}
        busy={save.isPending}
        description="You have unsaved changes to your business profile. Save, explicitly discard, or stay here."
        onSave={() => {
          if (Object.keys(errors).length) return;
          leaving.current = true;
          form.current?.requestSubmit();
        }}
        onDiscard={navigation.proceed}
        onStay={navigation.stay}
        error={
          Object.keys(errors).length ? "Correct the highlighted profile details before saving." : err?.message
        }
      />
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="surface grid gap-5 p-6 sm:p-7">
      <legend className="eyebrow float-left mb-1 w-full">{title}</legend>
      {children}
    </fieldset>
  );
}

function Field({
  label: l,
  id,
  error,
  hint,
  children,
}: {
  label: string;
  id: string;
  error?: string | undefined;
  hint?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="label" htmlFor={id}>
        {l}
      </label>
      {children}
      {error ? (
        <p className="hint !text-destructive">{error}</p>
      ) : hint ? (
        <p className="hint">{hint}</p>
      ) : null}
    </div>
  );
}
