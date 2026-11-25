import { StaffRoleAdministration } from "@/components/staff-role-administration";
import { OwnerRegulatoryGuidance } from "@/components/owner-regulatory-guidance";
import { OwnerCheckerRules } from "@/components/owner-checker-rules";
import { MfaVerification } from "@/components/mfa-verification";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { KeyRound, Lock, Search, ShieldAlert, X } from "lucide-react";
import {
  useGetStaffOperations,
  getGetStaffOperationsQueryKey,
  GetStaffOperationsArea,
  type GetStaffOperationsArea as Area,
} from "@workspace/api-client-react";
import { EmptyState, ErrorState, Skel } from "@/components/states";
import { dirtyStaffPanels, formatStaffCell, formatStaffColumn } from "@/lib/staff-table";
import { cn } from "@/lib/utils";
import { FinanceRefunds } from "./finance-refunds";
import { SourceSafetyControls } from "@/components/source-safety-controls";
import { SupportRecords } from "@/components/support-records";
import { StaffSupportCases } from "@/components/staff-support-cases";
import { ContentEscalations } from "@/components/content-escalations";
import { PreparedCandidates } from "@/components/prepared-candidates";
import { ManualLibraryEditor } from "@/components/manual-library-editor";
import { RetainedDrafts } from "@/components/retained-drafts";
import { SourceRegister } from "@/components/source-register";

const AREAS: { v: Area; l: string }[] = [
  { v: GetStaffOperationsArea.content, l: "Content" },
  { v: GetStaffOperationsArea.support, l: "Support" },
  { v: GetStaffOperationsArea.finance, l: "Finance" },
  { v: GetStaffOperationsArea.system, l: "System" },
];
const HIDDEN = /^(body|message|scope|text|notes|content)$/i;

export default function StaffPage() {
  const [area, setArea] = useState<Area>("content");
  const [supportDirty, setSupportDirty] = useState(false);
  const [contentDirty, setContentDirty] = useState(false);
  const [manualDirty, setManualDirty] = useState(false);
  const [tableFilter, setTableFilter] = useState("");
  const filterRef = useRef<HTMLInputElement>(null);
  const params = { area };
  const q = useGetStaffOperations(params, {
    query: { queryKey: getGetStaffOperationsQueryKey(params), refetchInterval: 15000, retry: false },
  });
  const status = (q.error as { status?: number } | null)?.status;
  const errText = (q.error as { data?: { error?: string; code?: string } } | null)?.data;
  const mfa = status === 403 && /mfa|factor|reverif/i.test(`${errText?.code ?? ""} ${errText?.error ?? ""}`);
  const records = useMemo(() => q.data?.records ?? [], [q.data?.records]);
  const cols = useMemo(
    () =>
      Array.from(new Set(records.flatMap((r) => Object.keys(r))))
        .filter((k) => !HIDDEN.test(k))
        .slice(0, 8),
    [records],
  );
  const dirtyPanels = dirtyStaffPanels({ support: supportDirty, content: contentDirty, manual: manualDirty });
  const lockedByDirty = dirtyPanels.length > 0;
  const filteredRecords = useMemo(() => {
    const trimmed = tableFilter.trim().toLowerCase();
    if (!trimmed) return records;
    return records.filter((r) =>
      cols.some((c) => formatStaffCell(r[c]).summary.toLowerCase().includes(trimmed)),
    );
  }, [records, cols, tableFilter]);

  useEffect(() => {
    setTableFilter("");
  }, [area]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && /INPUT|TEXTAREA|SELECT/.test(target.tagName)) return;
      if (!filterRef.current) return;
      event.preventDefault();
      filterRef.current.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="mx-auto max-w-7xl px-5 py-10 lg:px-8">
      <p className="eyebrow">Staff</p>
      <h1 className="font-display mt-2 text-4xl">Operations</h1>
      <Link href="/staff/privacy" className="btn btn-ghost btn-sm mt-4">
        Privacy request operations
      </Link>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Support shows the full saved request. Finance actions are available only to authorised finance staff.
        Customer document bodies are not shown here.
      </p>
      <div className="mt-6 flex flex-wrap gap-2" role="group" aria-label="Staff area filters">
        {AREAS.map((a) => (
          <button
            key={a.v}
            type="button"
            aria-pressed={area === a.v}
            disabled={lockedByDirty && area !== a.v}
            onClick={() => setArea(a.v)}
            className={cn(
              "rounded-full border px-4 py-1.5 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
              area === a.v
                ? "border-foreground bg-foreground text-background"
                : "border-border hover:bg-secondary",
            )}
            data-testid={"tab-staff-" + a.v}
          >
            {a.l}
          </button>
        ))}
      </div>
      {lockedByDirty && (
        <p
          role="status"
          className="mt-3 rounded-xl border border-[hsl(var(--ochre-border))] bg-[hsl(var(--ochre-soft))] px-4 py-2.5 text-sm text-[hsl(var(--ochre-foreground))]"
          data-testid="status-staff-area-locked"
        >
          Area switching is paused while you have unsaved edits in {dirtyPanels.join(" and ")}. Save or
          discard those edits to switch areas.
        </p>
      )}
      <div className="mt-8">
        {q.isLoading ? (
          <Skel className="h-48" />
        ) : status === 401 ? (
          <EmptyState
            mark={<Lock className="h-5 w-5 text-muted-foreground" />}
            title="Sign in required"
            action={
              <Link href="/sign-in" className="btn btn-primary">
                Sign in
              </Link>
            }
          >
            Staff operations need a signed-in staff account.
          </EmptyState>
        ) : mfa ? (
          <EmptyState
            mark={<KeyRound className="h-5 w-5 text-muted-foreground" />}
            title="Recent verification needed"
            action={<MfaVerification onVerified={() => void q.refetch()} />}
          >
            This area requires both sign-in factors to have been verified recently.
          </EmptyState>
        ) : status === 403 ? (
          <EmptyState
            mark={<ShieldAlert className="h-5 w-5 text-muted-foreground" />}
            title="Not a staff account"
            action={
              <Link href="/workspace" className="btn btn-ghost">
                Back to workspace
              </Link>
            }
          >
            Your account does not have a staff role for this area. Roles are assigned on the server; there is
            no way to request one here.
          </EmptyState>
        ) : q.isError && !q.data ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : q.data ? (
          <>
            {q.isError && (
              <ErrorState error={q.error} onRetry={() => q.refetch()} title="Staff overview refresh failed" />
            )}
            <p
              className="rounded-2xl border border-border bg-sidebar p-4 text-sm"
              data-testid="text-staff-notice"
            >
              {q.data.notice}
            </p>
            {area === "finance" && <FinanceRefunds />}
            {area === "system" && <StaffRoleAdministration />}
            {area === "content" && <RetainedDrafts />}
            {area === "content" && <ManualLibraryEditor onDirtyChange={setManualDirty} />}
            {(area === "content" || area === "system") && <SourceSafetyControls key={area} area={area} />}
            {area === "content" && <SourceRegister />}
            {area === "system" && <OwnerRegulatoryGuidance />}
            {area === "system" && <OwnerCheckerRules />}
            {area === "content" && <ContentEscalations onDirtyChange={setContentDirty} />}
            {area === "content" && (
              <details className="mt-6">
                <summary className="cursor-pointer">Previously prepared review candidates</summary>
                <PreparedCandidates candidates={q.data.preparedCandidates ?? []} />
              </details>
            )}
            {area === "support" ? (
              <>
                <StaffSupportCases onDirtyChange={setSupportDirty} />
                <details className="mt-8 border-t border-border pt-5">
                  <summary className="cursor-pointer text-sm font-medium">Original saved requests</summary>
                  {records.length ? (
                    <SupportRecords records={records} />
                  ) : (
                    <p className="mt-4 text-sm text-muted-foreground">
                      No original request records in this area.
                    </p>
                  )}
                </details>
              </>
            ) : records.length === 0 ? (
              <p className="mt-6 text-sm text-muted-foreground">No records in this area.</p>
            ) : (
              <div className="mt-6 grid gap-3">
                {records.length > 3 && (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="relative min-w-0 flex-1 sm:max-w-sm">
                      <Search
                        className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <input
                        ref={filterRef}
                        type="search"
                        className="field !pl-10"
                        aria-label="Filter staff records"
                        aria-keyshortcuts="/"
                        placeholder="Filter records (press /)"
                        value={tableFilter}
                        onChange={(e) => setTableFilter(e.target.value)}
                        data-testid="input-staff-filter"
                      />
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>
                        Showing {filteredRecords.length} of {records.length}
                      </span>
                      {tableFilter.trim() && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => setTableFilter("")}
                        >
                          <X className="h-3.5 w-3.5" aria-hidden="true" /> Clear
                        </button>
                      )}
                    </div>
                  </div>
                )}
                <div className="overflow-x-auto rounded-2xl border border-border">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-secondary">
                      <tr>
                        {cols.map((c) => (
                          <th key={c} scope="col" className="px-4 py-2.5 text-xs font-medium">
                            {formatStaffColumn(c)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border bg-card">
                      {filteredRecords.map((r, i) => (
                        <tr key={i}>
                          {cols.map((c) => {
                            const formatted = formatStaffCell(r[c]);
                            return (
                              <td key={c} className="max-w-xs px-4 py-2.5 align-top">
                                {formatted.detail ? (
                                  <details>
                                    <summary className="cursor-pointer font-medium text-primary underline underline-offset-4">
                                      {formatted.summary}
                                    </summary>
                                    <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-sidebar p-2 font-mono text-xs">
                                      {formatted.detail}
                                    </pre>
                                  </details>
                                ) : (
                                  <span className="block truncate" title={formatted.summary}>
                                    {formatted.summary}
                                  </span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
