import { AlertTriangle, CloudOff, Lock, RefreshCw, ShieldAlert } from "lucide-react";
import { describeError } from "@/lib/describe-error";
import { SiteLinkTo as Link } from "./site-link";
export { EmptyState, Notice, PageHeader, Skel } from "./page-parts";

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
              ? "You cannot open this"
              : d.kind === "unauthenticated"
                ? "Sign in to continue"
                : "We could not load this")}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">{d.message}</p>
        {/* A failure at Valo is worth reporting if it lasts. The reference is the failed request's
            own, in Valo's records: the only code shown, and only as something to quote. */}
        {d.kind === "server" && (d.status ?? 0) >= 500 && (
          <p className="mt-1 text-sm text-muted-foreground" data-testid="text-error-report">
            If this keeps happening,{" "}
            <Link href="/support" className="underline underline-offset-4">
              report a problem
            </Link>
            {d.reference ? (
              <>
                {" "}
                and quote reference <span className="font-mono">{d.reference}</span>
              </>
            ) : null}
            .
          </p>
        )}
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
              Trouble signing in
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
