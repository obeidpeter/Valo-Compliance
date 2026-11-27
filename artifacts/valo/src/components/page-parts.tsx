import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Presentational pieces a page is built from, with no router, identity or API client, so server
 * components and the browser app both render them. */
export function Skel({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-lg bg-muted", className)} />;
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
    ochre: "border-[hsl(var(--ochre-border))] bg-[hsl(var(--ochre-soft))]",
    forest: "border-[hsl(var(--forest-border))] bg-accent",
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
