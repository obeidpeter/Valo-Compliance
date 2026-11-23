import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Eye, History, Loader2, RotateCcw, X } from "lucide-react";
import type { BusinessDocument, CanonicalDocument } from "@workspace/api-client-react";
import { DocPreview } from "@/components/document-preview";
import { ErrorState, Skel } from "@/components/states";
import { summarizeDocumentDiff } from "@/lib/document-diff";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export function DocumentRevisionsCard({
  revisions,
  isLoading,
  isError,
  error,
  onRetry,
  currentRevision,
  currentDoc,
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
  currentDoc?: { title: string; content: CanonicalDocument } | undefined;
  restoring: number | null;
  saving: boolean;
  onRestore: (revision: BusinessDocument) => void;
}) {
  const [inspecting, setInspecting] = useState<BusinessDocument | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const dialogTitleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (inspecting && !dialog.open) dialog.showModal();
    else if (!inspecting && dialog.open) dialog.close();
  }, [inspecting]);

  const diff = useMemo(
    () => (inspecting && currentDoc ? summarizeDocumentDiff(currentDoc, inspecting) : []),
    [currentDoc, inspecting],
  );

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
                    "flex flex-wrap items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-sm",
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
                    <div className="flex items-center gap-1.5">
                      {currentDoc && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm !min-h-7 !px-2 text-xs"
                          onClick={() => setInspecting(r)}
                          data-testid={"button-compare-" + r.revision}
                        >
                          <Eye className="h-3 w-3" aria-hidden="true" /> Compare
                        </button>
                      )}
                      <button
                        type="button"
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
                    </div>
                  )}
                </li>
              );
            })}
        </ol>
      )}
      <p className="hint mt-3">
        Restoring a version saves it as the newest one. Every earlier version is kept.
      </p>

      <dialog
        ref={dialogRef}
        aria-labelledby={dialogTitleId}
        className="surface max-h-[85dvh] w-full max-w-3xl overflow-hidden p-0 text-foreground backdrop:bg-foreground/35 backdrop:backdrop-blur-[2px]"
        onCancel={(event) => {
          event.preventDefault();
          setInspecting(null);
        }}
        onClose={() => setInspecting(null)}
        data-testid="dialog-version-compare"
      >
        {inspecting && (
          <div className="flex max-h-[85dvh] flex-col">
            <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
              <div>
                <p className="eyebrow">Compare version</p>
                <h2 id={dialogTitleId} className="font-display mt-1 text-2xl">
                  Version {inspecting.revision} vs. current draft
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Saved {formatDateTime(inspecting.updatedAt)}
                </p>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm !min-h-8 !px-2"
                aria-label="Close comparison"
                onClick={() => setInspecting(null)}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="grid gap-5 overflow-y-auto p-6">
              <section aria-label="Changes summary">
                <p className="eyebrow">What differs from your current draft</p>
                {diff.length === 0 ? (
                  <p className="mt-2 rounded-xl bg-secondary px-4 py-3 text-sm text-muted-foreground">
                    No visible field or content differences between version {inspecting.revision} and your
                    current draft.
                  </p>
                ) : (
                  <ul className="mt-3 grid gap-2 text-sm">
                    {diff.map((entry) => (
                      <li key={entry.label} className="rounded-xl border border-border bg-sidebar/40 p-3">
                        <p className="text-xs font-medium text-muted-foreground">{entry.label}</p>
                        <p className="mt-1">
                          <span className="font-medium text-primary">Version {inspecting.revision}:</span>{" "}
                          {entry.olderValue}
                        </p>
                        <p className="mt-0.5 text-muted-foreground">
                          <span className="font-medium text-foreground">Current:</span> {entry.currentValue}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section aria-label={`Preview of version ${inspecting.revision}`}>
                <p className="eyebrow mb-3">Preview of version {inspecting.revision}</p>
                <div className="rounded-2xl border border-border bg-sidebar/40 p-3 sm:p-5">
                  <DocPreview
                    title={inspecting.title}
                    content={inspecting.content}
                    revision={inspecting.revision}
                  />
                </div>
              </section>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-sidebar/50 px-6 py-4">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setInspecting(null)}>
                Close
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={restoring !== null || saving}
                onClick={() => {
                  const target = inspecting;
                  setInspecting(null);
                  onRestore(target);
                }}
                data-testid="button-restore-from-compare"
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                Restore version {inspecting.revision}
              </button>
            </div>
          </div>
        )}
      </dialog>
    </div>
  );
}
