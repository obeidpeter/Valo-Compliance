import { useState, type FormEvent } from 'react';
import { Link } from 'wouter';
import { UserProfile } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Download, Loader2, ShoppingBag } from 'lucide-react';
import {
  useGetCustomerAccount, useRequestCustomerPrivacy, useGetCustomerPurchases, downloadWorkspaceData,
  getGetCustomerAccountQueryKey, getGetCustomerPurchasesQueryKey,
  type AccessSupportAck, type PrivacyRequestInputKind,
} from '@workspace/api-client-react';
import { WorkspaceNav } from '@/components/workspace-nav';
import { EmptyState, ErrorState, Notice, Skel } from '@/components/states';
import { describeError, formatDate } from '@/lib/api';
import { PurchaseHistoryPage } from './purchase-history';

export function AccountPage() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-10 lg:px-8">
      <WorkspaceNav />
      <header className="mb-8 max-w-2xl">
        <p className="eyebrow">Account</p>
        <h1 className="font-display mt-2 text-4xl">Sign-in and security</h1>
        <p className="mt-3 text-muted-foreground">Email, password, connected sign-in methods and active sessions are managed by our authentication provider. Valo never sees your password.</p>
      </header>
      <Notice className="mb-6" title="Deleting your sign-in account is not a Valo data deletion" >
        Changes made below, including deleting your sign-in account, affect only the sign-in provider. They do not delete your Valo workspace, drafts, assessments, tasks or requests. To have your Valo data deleted, save a verified request on <Link href="/workspace/privacy" className="underline underline-offset-2" data-testid="link-account-privacy">Privacy and data</Link>, and do that before deleting your sign-in account, because you will need to be signed in.
      </Notice>
      <div className="overflow-x-auto" data-testid="account-profile">
        <UserProfile routing="hash" />
      </div>
      <p className="mt-6 text-sm text-muted-foreground">Want a copy of your data or a correction? Go to <Link href="/workspace/privacy" className="text-primary underline underline-offset-4">Privacy and data</Link>.</p>
    </div>
  );
}

const KINDS: { v: PrivacyRequestInputKind; l: string; d: string }[] = [
  { v: 'correction', l: 'Correct something', d: 'Tell us what is inaccurate.' },
  { v: 'export', l: 'Full data request', d: 'Ask for data beyond the download below.' },
  { v: 'deletion', l: 'Delete my data', d: 'Ask staff to delete your workspace.' },
];

export function PrivacyPage() {
  const qc = useQueryClient();
  const account = useGetCustomerAccount({ query: { queryKey: getGetCustomerAccountQueryKey(), refetchOnWindowFocus: true } });
  const req = useRequestCustomerPrivacy({ mutation: { onSuccess: () => qc.invalidateQueries({ queryKey: getGetCustomerAccountQueryKey() }) } });
  const [kind, setKind] = useState<PrivacyRequestInputKind>('correction');
  const [message, setMessage] = useState('');
  const [ack, setAckChecked] = useState(false);
  const [touched, setTouched] = useState(false);
  const [saved, setSaved] = useState<AccessSupportAck | null>(null);
  const [dl, setDl] = useState<{ busy: boolean; err: string | null; done: boolean }>({ busy: false, err: null, done: false });

  const msgErr = message.trim().length < 10 ? 'At least 10 characters.' : message.length > 1500 ? 'Keep it under 1,500 characters.' : '';

  function submit(e: FormEvent) {
    e.preventDefault(); setTouched(true);
    if (msgErr || !ack || req.isPending) return;
    req.mutate({ data: { kind, message: message.trim(), acknowledgement: true } }, {
      onSuccess: (r) => { setSaved(r); setMessage(''); setAckChecked(false); setTouched(false); },
    });
  }

  async function download() {
    setDl({ busy: true, err: null, done: false });
    try {
      const data = await downloadWorkspaceData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `valo-workspace-${data.exportedAt.slice(0, 10)}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setDl({ busy: false, err: null, done: true });
    } catch (e) {
      setDl({ busy: false, err: describeError(e).message, done: false });
    }
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
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">A JSON file of what Valo stores for your workspace: profile, drafts, assessments, tasks and requests. It does not include data held by our authentication provider (such as sign-in history) or other providers.</p>
          <button className="btn btn-primary mt-5" onClick={download} disabled={dl.busy} data-testid="button-download-workspace">
            {dl.busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />} Download JSON
          </button>
          {dl.done && <p role="status" className="mt-3 text-sm text-primary">Downloaded. Store it somewhere private.</p>}
          {dl.err && <p role="alert" className="mt-3 text-sm text-destructive" data-testid="text-download-error">{dl.err}</p>}
        </section>

        <section>
          {saved ? (
            <div className="surface reveal p-6 sm:p-8" role="status" data-testid="privacy-ack">
              <CheckCircle2 className="h-7 w-7 text-primary" aria-hidden />
              <p className="font-display mt-4 text-2xl">Request saved.</p>
              <p className="mt-2 text-sm text-muted-foreground">{saved.message}</p>
              <p className="mt-3 font-mono text-sm">{saved.reference}</p>
              <p className="mt-3 text-xs text-muted-foreground">Saved for staff. Nothing has been corrected, exported or deleted yet, and no email was sent.</p>
              <button className="btn btn-ghost btn-sm mt-5" onClick={() => { setSaved(null); req.reset(); }}>Make another request</button>
            </div>
          ) : (
            <form onSubmit={submit} noValidate className="surface grid gap-5 p-6 sm:p-8" data-testid="form-privacy">
              <h2 className="font-display text-2xl">Make a privacy request</h2>
              <fieldset className="grid gap-2">
                <legend className="label">Request type</legend>
                {KINDS.map((k) => (
                  <label key={k.v} className={'flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm ' + (kind === k.v ? 'border-primary bg-accent/60' : 'border-border')}>
                    <input type="radio" name="kind" checked={kind === k.v} onChange={() => setKind(k.v)} className="mt-0.5 h-4 w-4 accent-[hsl(155_42%_21%)]" data-testid={'radio-privacy-' + k.v} />
                    <span><span className="block font-medium">{k.l}</span><span className="text-muted-foreground">{k.d}</span></span>
                  </label>
                ))}
              </fieldset>
              <div>
                <label className="label" htmlFor="pr-msg">Details</label>
                <textarea id="pr-msg" className="field min-h-28" maxLength={1500} value={message} aria-invalid={touched && !!msgErr} onChange={(e) => setMessage(e.target.value)} data-testid="input-privacy-message" />
                <p className={'hint ' + (touched && msgErr ? 'text-destructive' : '')}>{touched && msgErr ? msgErr : 'No passwords, ID numbers or payment details.'}</p>
              </div>
              <label className="flex items-start gap-3 text-sm">
                <input type="checkbox" checked={ack} onChange={(e) => setAckChecked(e.target.checked)} className="mt-1 h-4 w-4 accent-[hsl(155_42%_21%)]" data-testid="checkbox-privacy-ack" />
                <span>I understand this saves a request for staff. It does not immediately change or delete anything.</span>
              </label>
              {touched && !ack && <p className="text-sm text-destructive">Please confirm to continue.</p>}
              {err && <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">{err.message}</p>}
              <div><button className="btn btn-primary" disabled={req.isPending} data-testid="button-privacy-submit">{req.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Save request</button></div>
            </form>
          )}
        </section>
      </div>

      <section className="mt-10">
        <h2 className="font-display text-2xl">Your saved requests</h2>
        <div className="mt-4">
          {account.isLoading ? <Skel className="h-24" /> : account.isError ? <ErrorState error={account.error} onRetry={() => account.refetch()} /> : account.data && account.data.privacyRequests.length ? (
            <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
              {account.data.privacyRequests.map((p) => (
                <li key={p.reference} className="flex flex-wrap items-center justify-between gap-3 p-4" data-testid={'row-privacy-' + p.reference}>
                  <div><p className="font-medium capitalize">{p.request.replace(/_/g, ' ')}</p><p className="font-mono text-xs text-muted-foreground">{p.reference} · {formatDate(p.createdAt)}</p></div>
                  <span className="pill pill-ochre"><span className="dot" />{p.status.replace(/_/g, ' ')}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted-foreground">No privacy requests yet.</p>}
        </div>
      </section>
    </div>
  );
}

export function PurchasesPage() {
  return <PurchaseHistoryPage/>;
}
