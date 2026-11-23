import { useRef, useState, type FormEvent } from "react";
import { Link } from "wouter";
import { UserProfile } from "@clerk/react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2 } from "lucide-react";
import {
  useGetCustomerAccount,
  useRequestCustomerPrivacy,
  getGetCustomerAccountQueryKey,
  type AccessSupportAck,
  type PrivacyRequestInputKind,
} from "@workspace/api-client-react";
import { WorkspaceNav } from "@/components/workspace-nav";
import { ErrorState, Notice, Skel } from "@/components/states";
import { UnsavedNavigationDialog } from "@/components/unsaved-navigation-dialog";
import { describeError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { resolveIdempotencyKey, type IdempotencySlot } from "@/lib/idempotency";
import { useUnsavedNavigation } from "@/lib/use-unsaved-navigation";
import { PurchaseHistoryPage } from "./purchase-history";
import { PRIVACY_KIND_WORDS } from "@/lib/privacy-words";
import { PrivacyCases } from "@/components/privacy-cases";
import { getListPrivacyCasesQueryKey } from "@workspace/api-client-react";
import { WorkspaceDataDownload } from "@/components/workspace-data-download";
import { MfaVerification } from "@/components/mfa-verification";
import { ThemeToggle } from "@/islands/theme-toggle";

export function AccountPage() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-10 lg:px-8">
      <WorkspaceNav />
      <header className="mb-8 max-w-2xl">
        <p className="eyebrow">Account</p>
        <h1 className="font-display mt-2 text-4xl">Sign-in and security</h1>
        <p className="mt-3 text-muted-foreground">
          Your email, password, other ways of signing in and the devices you are signed in on are managed by
          our sign-in provider. Valo never sees your password.
        </p>
      </header>
      <Notice className="mb-6" title="Deleting your sign-in account is not a Valo data deletion">
        Changes made below, including deleting your sign-in account, affect only the sign-in provider. They do
        not delete your Valo workspace, documents, saved results, tasks or requests. To have your Valo data
        deleted, save a verified request on{" "}
        <Link
          href="/workspace/privacy"
          className="underline underline-offset-2"
          data-testid="link-account-privacy"
        >
          Privacy and data
        </Link>
        , and do that before deleting your sign-in account, because you will need to be signed in.
      </Notice>
      <MfaVerification />
      <section
        className="surface mb-6 flex flex-wrap items-center justify-between gap-4 p-5"
        aria-labelledby="account-appearance-h"
      >
        <div>
          <h2 id="account-appearance-h" className="font-display text-xl">
            Appearance
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Switch between light and dark themes. Saved in this browser only; light is the default.
          </p>
        </div>
        <ThemeToggle testId="button-account-theme-toggle" />
      </section>
      <div className="-mx-5 overflow-x-auto sm:mx-0" data-testid="account-profile">
        <UserProfile routing="hash" />
      </div>
      <p className="mt-6 text-sm text-muted-foreground">
        Want a copy of your data or a correction? Go to{" "}
        <Link href="/workspace/privacy" className="text-primary underline underline-offset-4">
          Privacy and data
        </Link>
        .
      </p>
    </div>
  );
}

const KINDS: { v: PrivacyRequestInputKind; l: string; d: string }[] = [
  { v: "correction", l: PRIVACY_KIND_WORDS.correction, d: "Tell us what is inaccurate." },
  { v: "export", l: PRIVACY_KIND_WORDS.export, d: "Ask for data beyond the download below." },
  { v: "deletion", l: PRIVACY_KIND_WORDS.deletion, d: "Ask staff to delete your workspace." },
];

export function PrivacyPage() {
  const qc = useQueryClient();
  const account = useGetCustomerAccount({
    query: { queryKey: getGetCustomerAccountQueryKey(), refetchOnWindowFocus: true },
  });
  const req = useRequestCustomerPrivacy({
    mutation: {
      onSuccess: async () => {
        await Promise.all([
          qc.invalidateQueries({ queryKey: getGetCustomerAccountQueryKey() }),
          qc.invalidateQueries({ queryKey: getListPrivacyCasesQueryKey() }),
        ]);
      },
    },
  });
  const keyRef = useRef<IdempotencySlot>(null);
  const [kind, setKind] = useState<PrivacyRequestInputKind>("correction");
  const [message, setMessage] = useState("");
  const [ack, setAckChecked] = useState(false);
  const [touched, setTouched] = useState(false);
  const [saved, setSaved] = useState<AccessSupportAck | null>(null);
  const navigation = useUnsavedNavigation(() => Boolean(message.trim()) || req.isPending);

  const msgErr =
    message.trim().length < 10
      ? "At least 10 characters."
      : message.length > 1500
        ? "Keep it under 1,500 characters."
        : "";

  function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (msgErr) {
      const el = document.getElementById("pr-msg");
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      el?.focus();
      return;
    }
    if (!ack) {
      const el = document.getElementById("pr-ack");
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      el?.focus();
      return;
    }
    if (req.isPending) return;
    const payload = { kind, message: message.trim(), acknowledgement: true as const };
    const slot = resolveIdempotencyKey(keyRef.current, payload);
    keyRef.current = slot;
    req.mutate(
      { data: { ...payload, idempotencyKey: slot.key } },
      {
        onSuccess: (r) => {
          setSaved(r);
          setMessage("");
          setAckChecked(false);
          setTouched(false);
          keyRef.current = null;
        },
      },
    );
  }

  const err = req.error ? describeError(req.error) : null;
  return (
    <div className="mx-auto max-w-6xl px-5 py-10 lg:px-8">
      <WorkspaceNav />
      <header className="mb-8 max-w-2xl">
        <p className="eyebrow">Privacy and data</p>
        <h1 className="font-display mt-2 text-4xl">Your data, on request.</h1>
      </header>
      <div className="grid gap-8 lg:grid-cols-[1fr_1fr]">
        <section className="surface p-6 sm:p-8">
          <h2 className="font-display text-2xl">Download workspace data</h2>
          <div className="mt-3 grid gap-3 text-sm leading-relaxed" data-testid="workspace-export-scope">
            <p className="text-muted-foreground">
              A JSON copy of your workspace records.{" "}
              <strong className="font-medium text-foreground">This is not complete privacy fulfilment</strong>
              —use the privacy request form alongside it for coordinated access to external or staff systems.
            </p>
            <div className="grid gap-3 rounded-xl border border-border bg-sidebar/40 p-4 sm:grid-cols-2">
              <div>
                <p className="font-medium text-foreground">Included</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Profile versions, documents and their versions, saved results, tasks, reminder records,
                  support requests, AI drafts, purchases, export/file metadata and your own workspace
                  activity.
                </p>
              </div>
              <div>
                <p className="font-medium text-foreground">Not included</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Word/PDF file bytes, storage links, membership records, other people&rsquo;s activity, full
                  system/staff audits, sign-in-provider data, external-provider data or unlinked public
                  contact requests.
                </p>
              </div>
            </div>
          </div>
          <WorkspaceDataDownload />
        </section>

        <section>
          {saved ? (
            <div className="surface reveal p-6 sm:p-8" role="status" data-testid="privacy-ack">
              <CheckCircle2 className="h-7 w-7 text-primary" aria-hidden />
              <p className="font-display mt-4 text-2xl">Request saved.</p>
              <p className="mt-2 text-sm text-muted-foreground">{saved.message}</p>
              <p className="mt-3 font-mono text-sm">{saved.reference}</p>
              <p className="mt-3 text-xs text-muted-foreground">
                Saved for staff. Nothing has been corrected, exported or deleted yet, and no email was sent.
              </p>
              <button
                className="btn btn-ghost btn-sm mt-5"
                onClick={() => {
                  setSaved(null);
                  req.reset();
                }}
              >
                Make another request
              </button>
            </div>
          ) : (
            <form
              onSubmit={submit}
              noValidate
              className="surface grid gap-5 p-6 sm:p-8"
              data-testid="form-privacy"
            >
              <h2 className="font-display text-2xl">Make a privacy request</h2>
              <fieldset className="grid gap-2">
                <legend className="label">Request type</legend>
                {KINDS.map((k) => (
                  <label
                    key={k.v}
                    className={
                      "flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm " +
                      (kind === k.v ? "border-primary bg-accent/60" : "border-border")
                    }
                  >
                    <input
                      type="radio"
                      name="kind"
                      checked={kind === k.v}
                      onChange={() => setKind(k.v)}
                      className="mt-0.5 h-4 w-4 accent-[hsl(155_42%_21%)]"
                      data-testid={"radio-privacy-" + k.v}
                    />
                    <span>
                      <span className="block font-medium">{k.l}</span>
                      <span className="text-muted-foreground">{k.d}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
              <div>
                <div className="flex items-baseline justify-between gap-2">
                  <label className="label" htmlFor="pr-msg">
                    Details
                  </label>
                  <span className="font-mono text-xs text-muted-foreground">{message.length} / 1,500</span>
                </div>
                <textarea
                  id="pr-msg"
                  className="field min-h-28"
                  maxLength={1500}
                  value={message}
                  aria-invalid={touched && !!msgErr}
                  onChange={(e) => setMessage(e.target.value)}
                  data-testid="input-privacy-message"
                />
                <p className={"hint " + (touched && msgErr ? "text-destructive" : "")}>
                  {touched && msgErr ? msgErr : "No passwords, ID numbers or payment details."}
                </p>
              </div>
              <label className="flex items-start gap-3 text-sm" htmlFor="pr-ack">
                <input
                  id="pr-ack"
                  type="checkbox"
                  checked={ack}
                  onChange={(e) => setAckChecked(e.target.checked)}
                  className="mt-1 h-4 w-4 accent-[hsl(155_42%_21%)]"
                  data-testid="checkbox-privacy-ack"
                />
                <span>
                  I understand this saves a request for staff. It does not immediately change or delete
                  anything.
                </span>
              </label>
              {touched && !ack && <p className="text-sm text-destructive">Please confirm to continue.</p>}
              {err && (
                <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  {err.message}
                </p>
              )}
              <div>
                <button
                  className="btn btn-primary"
                  disabled={req.isPending}
                  data-testid="button-privacy-submit"
                >
                  {req.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Save request
                </button>
              </div>
            </form>
          )}
        </section>
      </div>

      <PrivacyCases />
      <section className="mt-10">
        <h2 className="font-display text-2xl">Support references</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          These are requests that were saved earlier as support messages. They are not the results of a
          privacy request. A newer request has its history and its result above. An older one listed here has
          still to be taken up by staff.
        </p>
        <div className="mt-4">
          {account.isLoading ? (
            <Skel className="h-24" />
          ) : account.isError ? (
            <ErrorState error={account.error} onRetry={() => account.refetch()} />
          ) : account.data && account.data.privacyRequests.length ? (
            <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
              {account.data.privacyRequests.map((p) => (
                <li
                  key={p.reference}
                  className="flex flex-wrap items-center justify-between gap-3 p-4"
                  data-testid={"row-privacy-" + p.reference}
                >
                  <div>
                    <p className="break-words font-medium">{p.request}</p>
                    <p className="font-mono text-xs text-muted-foreground">
                      {p.reference} · {formatDateTime(p.createdAt)}
                    </p>
                  </div>
                  <span className="pill pill-ochre">
                    <span className="dot" />
                    {p.status === "awaiting_staff" ? "Waiting for staff" : p.status.replace(/_/g, " ")}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No privacy requests yet.</p>
          )}
        </div>
      </section>
      <UnsavedNavigationDialog
        open={navigation.blocked}
        busy={req.isPending}
        onDiscard={navigation.proceed}
        onStay={navigation.stay}
        description="You started writing a privacy request that has not been saved yet. Stay here to finish it, or leave and discard what you typed."
      />
    </div>
  );
}

export function PurchasesPage() {
  return <PurchaseHistoryPage />;
}
