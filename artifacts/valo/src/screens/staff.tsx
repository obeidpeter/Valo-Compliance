import { useState } from 'react';
import { Link } from 'wouter';
import { KeyRound, Lock, ShieldAlert } from 'lucide-react';
import { useGetStaffOperations, getGetStaffOperationsQueryKey, GetStaffOperationsArea, type GetStaffOperationsArea as Area } from '@workspace/api-client-react';
import { EmptyState, ErrorState, Skel } from '@/components/states';
import { cn } from '@/lib/utils';
import {FinanceRefunds} from './finance-refunds';
import {SupportRecords} from '@/components/support-records';

const AREAS: { v: Area; l: string }[] = [
  { v: GetStaffOperationsArea.content, l: 'Content' },
  { v: GetStaffOperationsArea.support, l: 'Support' },
  { v: GetStaffOperationsArea.finance, l: 'Finance' },
  { v: GetStaffOperationsArea.system, l: 'System' },
];
const HIDDEN = /^(body|message|scope|text|notes|content)$/i;

function cell(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export default function StaffPage() {
  const [area, setArea] = useState<Area>('content');
  const params = { area };
  const q = useGetStaffOperations(params, { query: { queryKey: getGetStaffOperationsQueryKey(params), refetchInterval: 15000, retry: false } });
  const status = (q.error as { status?: number } | null)?.status;
  const errText = (q.error as { data?: { error?: string; code?: string } } | null)?.data;
  const mfa = status === 403 && /mfa|factor|reverif/i.test(`${errText?.code ?? ''} ${errText?.error ?? ''}`);
  const records = q.data?.records ?? [];
  const cols = Array.from(new Set(records.flatMap((r) => Object.keys(r)))).filter((k) => !HIDDEN.test(k)).slice(0, 8);

  return (
    <div className="mx-auto max-w-7xl px-5 py-10 lg:px-8">
      <p className="eyebrow">Staff</p>
      <h1 className="font-display mt-2 text-4xl">Operations</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Support shows the full saved request. Finance actions are available only to authorised finance staff. Customer document bodies are not shown here.</p>
      <div className="mt-6 flex flex-wrap gap-2" role="group" aria-label="Staff area filters">
        {AREAS.map((a) => (
          <button key={a.v} type="button" aria-pressed={area === a.v} onClick={() => setArea(a.v)} className={cn('rounded-full border px-4 py-1.5 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2', area === a.v ? 'border-foreground bg-foreground text-background' : 'border-border hover:bg-secondary')} data-testid={'tab-staff-' + a.v}>{a.l}</button>
        ))}
      </div>
      <div className="mt-8">
        {q.isLoading ? <Skel className="h-48" /> : status === 401 ? (
          <EmptyState mark={<Lock className="h-5 w-5 text-muted-foreground" />} title="Sign in required" action={<Link href="/sign-in" className="btn btn-primary">Sign in</Link>}>Staff operations need a signed-in staff account.</EmptyState>
        ) : mfa ? (
          <EmptyState mark={<KeyRound className="h-5 w-5 text-muted-foreground" />} title="Recent verification needed" action={<Link href="/workspace/account" className="btn btn-primary">Manage sign-in security</Link>}>This area requires multi-factor authentication completed recently. Set up or re-verify a second factor, then sign in again.</EmptyState>
        ) : status === 403 ? (
          <EmptyState mark={<ShieldAlert className="h-5 w-5 text-muted-foreground" />} title="Not a staff account" action={<Link href="/workspace" className="btn btn-ghost">Back to workspace</Link>}>Your account does not have a staff role for this area. Roles are assigned on the server; there is no way to request one here.</EmptyState>
        ) : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.data ? (
          <>
            <p className="rounded-2xl border border-border bg-sidebar p-4 text-sm" data-testid="text-staff-notice">{q.data.notice}</p>
            {area==='finance'&&<FinanceRefunds/>}
            {records.length === 0 ? <p className="mt-6 text-sm text-muted-foreground">No records in this area.</p> : area==='support' ? <SupportRecords records={records}/> : (
              <div className="mt-6 overflow-x-auto rounded-2xl border border-border">
                <table className="w-full text-left text-sm">
                  <thead className="bg-secondary"><tr>{cols.map((c) => <th key={c} scope="col" className="px-4 py-2.5 font-mono text-xs font-medium">{c}</th>)}</tr></thead>
                  <tbody className="divide-y divide-border bg-card">
                    {records.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c} className="max-w-xs truncate px-4 py-2.5 align-top">{cell(r[c])}</td>)}</tr>)}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
