import { Link } from "wouter";
import type { ProfileRecheck } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { recheckHref, recheckWords } from "@/lib/recheck";
import { Notice } from "./states";

/**
 * PRO-003: the offer of a new requirements check after the business profile changes an answer the
 * check reads. Shown where the server makes the offer (`Workspace.recheck`), and nowhere otherwise.
 */
export function RecheckOffer({
  recheck,
  className,
}: {
  recheck: ProfileRecheck | undefined;
  className?: string;
}) {
  if (!recheck) return null;
  const words = recheckWords(recheck);
  return (
    <div className={cn("no-print", className)} data-testid="notice-check-again">
      <Notice title={words.title}>
        <p>{words.changed}</p>
        <p className="mt-1">{words.kept}</p>
        <Link href={recheckHref(recheck)} className="btn btn-ink btn-sm mt-3" data-testid="link-check-again">
          {words.action}
        </Link>
      </Notice>
    </div>
  );
}
