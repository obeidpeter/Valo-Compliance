import { History, Loader2, RotateCcw } from "lucide-react";
import type { BusinessDocument } from "@workspace/api-client-react";
import { ErrorState, Skel } from "@/components/states";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export function DocumentRevisionsCard({
  revisions,
  isLoading,
  isError,
  error,
  onRetry,
  currentRevision,
  restoring,
  saving,
  onRestore,
}: {
  revisions: BusinessDocument[] | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  currentRevision: number;
  restoring: number | null;
  saving: boolean;
  onRestore: (revision: BusinessDocument) => void;
}) {
  return (
    <div className="surface p-5" data-testid="card-revisions">
      <p className="eyebrow flex items-center gap-2">
        <History className="h-3.5 w-3.5" aria-hidden="true" /> Versions
      </p>
      {isLoading ? (
        <Skel className="mt-3 h-24" />
      ) : isError ? (
        <div className="mt-3">
          <ErrorState error={error} onRetry={onRetry} />
        </div>
      ) : (
        <ol className="mt-3 grid max-h-80 gap-1 overflow-auto pr-1">
          {[...(revisions ?? [])]
            .sort((a, b) => b.revision - a.revision)
            .map((r) => {
              const current = r.revision === currentRevision;
              return (
                <li
                  key={r.revision}
                  className={cn(
                    "flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-sm",
                    current && "bg-accent",
                  )}
                  data-testid={"row-revision-" + r.revision}
                >
                  <span>
                    <span>Version {r.revision}</span>
                    <span className="block text-xs text-muted-foreground">{formatDateTime(r.updatedAt)}</span>
                  </span>
                  {current ? (
                    <span className="text-xs text-primary">Current</span>
                  ) : (
                    <button
                      className="btn btn-ghost btn-sm !min-h-7 !px-2.5 text-xs"
                      disabled={restoring !== null || saving}
                      onClick={() => onRestore(r)}
                      data-testid={"button-restore-" + r.revision}
                    >
                      {restoring === r.revision ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <RotateCcw className="h-3 w-3" />
                      )}{" "}
                      Restore
                    </button>
                  )}
                </li>
              );
            })}
        </ol>
      )}
      <p className="hint mt-3">
        Restoring a version saves it as the newest one. Every earlier version is kept.
      </p>
    </div>
  );
}
