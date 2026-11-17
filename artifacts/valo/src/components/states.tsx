import type { ReactNode } from "react";
import { AlertTriangle, CloudOff, Lock, RefreshCw, ShieldAlert } from "lucide-react";
import { Link } from "wouter";
import { describeError } from "@/lib/api";
import { cn } from "@/lib/utils";

export function Skel({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-lg bg-muted", className)} />;
}

export function ErrorState({
  error,
  onRetry,
  title,
}: {
  error: unknown;
  onRetry?: () => void;
  title?: string;
}) {
  const d = describeError(error);
  const Icon =
    d.kind === "offline"
      ? CloudOff
      : d.kind === "unauthenticated"
        ? Lock
        : d.kind === "forbidden"
          ? ShieldAlert
          : AlertTriangle;
  return (
    <div
      role="alert"
      className="surface flex flex-col gap-4 p-6 sm:flex-row sm:items-start"
      data-testid="status-error"
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-secondary text-foreground">
        <Icon className="h-5 w-5" />
      </span>
      <div className="flex-1">
        <p className="font-medium">
          {title ??
            (d.kind === "forbidden"
              ? "Access not available"
              : d.kind === "unauthenticated"
                ? "Sign in required"
                : "We could not load this")}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {d.message}
          {d.status ? <span className="font-mono"> ({d.status})</span> : null}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {onRetry && (
            <button className="btn btn-ghost btn-sm" onClick={onRetry} data-testid="button-retry">
              <RefreshCw className="h-4 w-4" /> Try again
            </button>
          )}
          {d.kind === "unauthenticated" && (
            <Link href="/sign-in" className="btn btn-primary btn-sm" data-testid="link-signin-from-error">
              Sign in
            </Link>
          )}
          {(d.kind === "forbidden" || d.kind === "unauthenticated") && (
            <Link href="/account-access" className="btn btn-ghost btn-sm" data-testid="link-access-help">
              Account access help
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

export function EmptyState({
  mark,
  title,
  children,
  action,
}: {
  mark?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      className="surface rule-lines relative overflow-hidden px-6 py-12 text-center sm:px-12"
      data-testid="status-empty"
    >
      <div className="mx-auto max-w-md">
        {mark && (
          <div className="mx-auto mb-5 grid h-12 w-12 place-items-center rounded-full border border-border bg-card">
            {mark}
          </div>
        )}
        <h3 className="font-display text-2xl">{title}</h3>
        {children && (
          <div className="mt-3 text-[0.95rem] leading-relaxed text-muted-foreground">{children}</div>
        )}
        {action && <div className="mt-6 flex flex-wrap justify-center gap-2">{action}</div>}
      </div>
    </div>
  );
}

export function Notice({
  tone = "ochre",
  title,
  children,
  className,
}: {
  tone?: "ochre" | "forest" | "ink";
  title: string;
  children?: ReactNode;
  className?: string;
}) {
  const tones = {
    ochre: "border-[hsl(38_50%_80%)] bg-[hsl(var(--ochre-soft))]",
    forest: "border-[hsl(150_25%_80%)] bg-accent",
    ink: "border-border bg-secondary",
  };
  return (
    <aside className={cn("rounded-2xl border px-5 py-4", tones[tone], className)} data-testid="notice">
      <p className="text-sm font-semibold">{title}</p>
      {children && <div className="mt-1 text-sm leading-relaxed text-foreground/80">{children}</div>}
    </aside>
  );
}

export function PageHeader({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="reveal mb-10 max-w-3xl">
      <p className="eyebrow">{eyebrow}</p>
      <h1 className="font-display mt-3 text-4xl leading-[1.08] sm:text-5xl">{title}</h1>
      {children && <div className="mt-4 text-lg leading-relaxed text-muted-foreground">{children}</div>}
    </header>
  );
}
