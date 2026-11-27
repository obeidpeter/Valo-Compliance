import type { ReactNode } from "react";
import { Link } from "wouter";
import { ArrowLeft, Gauge } from "lucide-react";
import type { CustomerAIPreview, CustomerAITask, CustomerAIUsage } from "@workspace/api-client-react";
import { WorkspaceNav } from "@/components/workspace-nav";
import { ErrorState, Skel } from "@/components/states";

export const TASKS: { id: CustomerAITask; label: string; blurb: string }[] = [
  { id: "invoice", label: "Invoice", blurb: "Bill for goods or work already supplied." },
  { id: "quotation", label: "Quotation", blurb: "Price offer before work starts." },
  { id: "payment_reminder", label: "Payment reminder", blurb: "Follow up an amount you recorded as due." },
  { id: "business_proposal", label: "Business proposal", blurb: "Organise your scope and terms." },
];
export const TASK_LABEL = Object.fromEntries(TASKS.map((t) => [t.id, t.label])) as Record<
  CustomerAITask,
  string
>;

export const STATUS: Record<CustomerAIPreview["status"], { label: string; tone: string; text: string }> = {
  ready: {
    label: "Ready to review",
    tone: "pill-forest",
    text: "The provider organised your notes. Review every line before saving.",
  },
  needs_information: {
    label: "Needs information",
    tone: "pill-ochre",
    text: "Some details are missing. Fill them in below or save and complete later.",
  },
  manual_fallback: {
    label: "Manual fallback",
    tone: "pill-ochre",
    text: "The AI provider did not produce a usable result. This preview was assembled from your own entries only, without AI.",
  },
  unsupported: {
    label: "Unsupported",
    tone: "pill-ink",
    text: "This request cannot be drafted by Valo. Nothing was generated.",
  },
  running: {
    label: "Running",
    tone: "pill-ink",
    text: "Still working. This page checks again automatically.",
  },
};

export function UsageCard({
  usage,
}: {
  usage: {
    isLoading: boolean;
    isError: boolean;
    error: unknown;
    data?: CustomerAIUsage | undefined;
    refetch: () => unknown;
  };
}) {
  if (usage.isLoading) return <Skel className="h-36" />;
  if (usage.isError || !usage.data)
    return <ErrorState error={usage.error} onRetry={() => usage.refetch()} title="Usage unavailable" />;
  const u = usage.data;
  const pct =
    u.workspaceDailyLimit > 0 ? Math.min(100, (u.workspaceUsed / u.workspaceDailyLimit) * 100) : 100;
  return (
    <div className="surface p-5" data-testid="card-ai-usage">
      <div className="flex items-center justify-between">
        <p className="eyebrow">Development quota</p>
        <Gauge className="h-4 w-4 text-muted-foreground" />
      </div>
      <p className="mt-3 font-mono text-2xl tabular-nums" data-testid="text-ai-usage">
        {u.workspaceUsed}
        <span className="text-base text-muted-foreground"> / {u.workspaceDailyLimit} today</span>
      </p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full origin-left rounded-full bg-primary transition-transform duration-500"
          style={{ transform: `scaleX(${pct / 100})` }}
        />
      </div>
      <ul className="mt-3 grid gap-1 text-xs text-muted-foreground">
        <li>Up to {u.minuteLimit} per minute</li>
        <li>
          AI drafting {u.enabled && u.globalAvailable ? "available" : "unavailable"}
          {!u.globalAvailable ? " (provider capacity paused)" : ""}
        </li>
        <li>Manual drafting {u.manualFallbackAvailable ? "available" : "unavailable"}</li>
      </ul>
      {u.policyNotice && (
        <p className="mt-3 border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">
          {u.policyNotice}
        </p>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        Technical development limits, not a plan or purchase.
      </p>
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl px-5 py-12 lg:px-8">
      <WorkspaceNav />
      <Link
        href="/workspace/ai"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        data-testid="link-back-ai"
      >
        <ArrowLeft className="h-4 w-4" />
        Drafting assistant
      </Link>
      {/* The draft's title is an editable field, so the page's heading is for assistive technology
          only, as in the document editor. */}
      <h1 className="sr-only">Draft preview</h1>
      {children}
    </div>
  );
}

export function Meta({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 text-muted-foreground">{k}</dt>
      <dd className="min-w-0 break-words text-right font-mono">{v}</dd>
    </div>
  );
}

export function Section({
  n,
  title,
  hint,
  children,
}: {
  n: string;
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="surface p-5 sm:p-7">
      <div className="mb-5 flex items-baseline gap-3">
        <span className="font-mono text-xs text-muted-foreground">{n}</span>
        <div>
          <h2 className="font-display text-2xl">{title}</h2>
          {hint && <p className="mt-1 text-sm text-muted-foreground">{hint}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

export function Text({
  id,
  label,
  v,
  on,
  max,
  type = "text",
}: {
  id: string;
  label: string;
  v: string;
  on: (v: string) => void;
  max?: number;
  type?: string;
}) {
  return (
    <div className="min-w-0">
      <label className="label" htmlFor={"ai-" + id}>
        {label}
      </label>
      <input
        id={"ai-" + id}
        type={type}
        className="field"
        maxLength={max}
        value={v}
        onChange={(e) => on(e.target.value)}
        data-testid={"input-ai-" + id}
      />
    </div>
  );
}
