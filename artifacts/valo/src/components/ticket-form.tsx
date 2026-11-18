import { useState, type FormEvent } from "react";
import { Link } from "wouter";
import { Show, useUser } from "@clerk/react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useCreateSupportTicket, TicketInputCategory, type TicketReceipt } from "@workspace/api-client-react";
import { describeError } from "@/lib/api";
import { enquiryProblems, needsSharingConsent } from "@/lib/enquiry";

export const CATEGORY_LABELS: Record<TicketInputCategory, string> = {
  support: "Valo product support",
  registration: "Business registration",
  tax: "Tax",
  accounting: "Accounting and bookkeeping",
  employment: "Employment and staff",
  legal: "Legal documents",
  privacy: "Data protection and privacy",
  sector_approval: "Sector approvals and permits",
};

export function TicketForm({
  defaultCategory = "support",
  categories,
  intro,
}: {
  defaultCategory?: TicketInputCategory;
  categories?: TicketInputCategory[] | undefined;
  intro?: string | undefined;
}) {
  return (
    <>
      <Show when="signed-out">
        <div className="surface p-6 sm:p-8" data-testid="ticket-signed-out">
          <p className="font-display text-2xl">Sign in to send this</p>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Requests are stored in your private workspace so we can tie them to your account. That needs a
            verified email first.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link href="/sign-in" className="btn btn-primary">
              Sign in
            </Link>
            <Link href="/sign-up" className="btn btn-ghost">
              Create an account
            </Link>
            <Link href="/contact" className="btn btn-ghost">
              Write without an account
            </Link>
          </div>
        </div>
      </Show>
      <Show when="signed-in">
        <TicketFormInner defaultCategory={defaultCategory} categories={categories} intro={intro} />
      </Show>
    </>
  );
}

function TicketFormInner({
  defaultCategory,
  categories,
  intro,
}: {
  defaultCategory: TicketInputCategory;
  categories?: TicketInputCategory[] | undefined;
  intro?: string | undefined;
}) {
  const { user } = useUser();
  const mutation = useCreateSupportTicket();
  const [category, setCategory] = useState<TicketInputCategory>(defaultCategory);
  const [scope, setScope] = useState("");
  const [email, setEmail] = useState(user?.primaryEmailAddress?.emailAddress ?? "");
  const [consent, setConsent] = useState(false);
  const [touched, setTouched] = useState(false);
  const [receipt, setReceipt] = useState<TicketReceipt | null>(null);
  const opts = categories ?? (Object.keys(CATEGORY_LABELS) as TicketInputCategory[]);
  const {
    scope: scopeErr,
    email: emailErr,
    consent: consentErr,
  } = enquiryProblems({ category, scope, email, consent });
  const consentRequired = needsSharingConsent(category);

  function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (scopeErr || emailErr || consentErr) return;
    mutation.mutate(
      { data: { category, scope: scope.trim(), contactEmail: email.trim(), sharingConsent: consent } },
      { onSuccess: (r) => setReceipt(r) },
    );
  }

  if (receipt) {
    return (
      <div className="surface reveal p-6 sm:p-8" data-testid="ticket-receipt">
        <CheckCircle2 className="h-7 w-7 text-primary" />
        <p className="font-display mt-4 text-2xl">Saved. Waiting for a person.</p>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{receipt.message}</p>
        <dl className="mt-6 grid gap-3 rounded-xl border border-border bg-background p-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="eyebrow">Reference</dt>
            <dd className="font-mono mt-1 text-base" data-testid="text-ticket-reference">
              {receipt.reference}
            </dd>
          </div>
          <div>
            <dt className="eyebrow">Status</dt>
            <dd className="mt-1">
              <span className="pill pill-ochre">
                <span className="dot" /> Awaiting staff
              </span>
            </dd>
          </div>
        </dl>
        <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
          Your request is durably stored. It has not been sent to any outside provider, and no appointment or
          response time has been set.
        </p>
        <button
          className="btn btn-ghost btn-sm mt-5"
          onClick={() => {
            setReceipt(null);
            setScope("");
            setConsent(false);
            setTouched(false);
            mutation.reset();
          }}
          data-testid="button-new-ticket"
        >
          Write another
        </button>
      </div>
    );
  }

  const err = mutation.error ? describeError(mutation.error) : null;
  return (
    <form onSubmit={submit} className="surface grid gap-5 p-6 sm:p-8" noValidate data-testid="form-ticket">
      {intro && <p className="text-sm leading-relaxed text-muted-foreground">{intro}</p>}
      <div>
        <label className="label" htmlFor="t-cat">
          Topic
        </label>
        <select
          id="t-cat"
          className="field"
          value={category}
          onChange={(e) => setCategory(e.target.value as TicketInputCategory)}
          data-testid="select-category"
        >
          {opts.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="t-scope">
          What do you need?
        </label>
        <textarea
          id="t-scope"
          className="field min-h-36"
          value={scope}
          maxLength={4000}
          aria-invalid={touched && !!scopeErr}
          onChange={(e) => setScope(e.target.value)}
          placeholder="Describe the situation in your own words. Please use test details only during development."
          data-testid="input-scope"
        />
        <div className="hint flex justify-between">
          <span className={touched && scopeErr ? "text-destructive" : ""}>
            {touched && scopeErr ? scopeErr : "Minimum 10 characters."}
          </span>
          <span className="font-mono">{scope.length}/4000</span>
        </div>
      </div>
      <div>
        <label className="label" htmlFor="t-email">
          Reply email
        </label>
        <input
          id="t-email"
          type="email"
          className="field"
          value={email}
          maxLength={254}
          aria-invalid={touched && !!emailErr}
          onChange={(e) => setEmail(e.target.value)}
          data-testid="input-email"
        />
        {touched && emailErr && <p className="hint text-destructive">{emailErr}</p>}
      </div>
      <div>
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-background p-4 text-sm">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 accent-[hsl(155_42%_21%)]"
            checked={consent}
            required={consentRequired}
            aria-invalid={touched && !!consentErr}
            onChange={(e) => setConsent(e.target.checked)}
            data-testid="checkbox-consent"
          />
          <span>
            I agree Valo staff may share this request with an outside adviser if that ever becomes available.{" "}
            <span className="text-muted-foreground" data-testid="text-consent-hint">
              {consentRequired
                ? "Required for a service enquiry. Nothing is shared today, and no advisers are offered."
                : "Optional for product support. Nothing is shared today, and no advisers are offered."}
            </span>
          </span>
        </label>
        {touched && consentErr && (
          <p className="hint text-destructive" data-testid="text-consent-error">
            {consentErr}
          </p>
        )}
      </div>
      {err && (
        <p
          role="alert"
          className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive"
          data-testid="text-ticket-error"
        >
          {err.message}
        </p>
      )}
      <div>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={mutation.isPending}
          data-testid="button-submit-ticket"
        >
          {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Save request
        </button>
      </div>
    </form>
  );
}
