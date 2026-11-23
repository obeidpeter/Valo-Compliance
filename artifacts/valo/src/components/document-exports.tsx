import { useEffect, useId, useState } from "react";
import { Check, Circle, Download, Printer, RotateCcw, Share2 } from "lucide-react";
import {
  useListDocumentExports,
  useCreateDocumentExport,
  useRetryDocumentExport,
} from "@workspace/api-client-react";
import { describeError } from "@/lib/api";
import { FILE_FORMAT_NAMES } from "@/lib/file-formats";
import { formatDateTime, formatFileSize } from "@/lib/format";
import { canUseWebShare, shareExportFile } from "@/lib/share-file";
import { ErrorState } from "./states";

/** Where a file has got to, in the customer's words. */
const STATUS_WORDS = {
  queued: "waiting to be made",
  running: "being made",
  retrying: "being tried again",
  ready: "ready",
  failed: "not made",
} as const;
/** Why a file was not made, where that can be said plainly. Any other reason is given by its reference. */
const FAILURES: Record<string, string> = {
  EXPORT_EXPIRED: "This file has expired. You can make it again from the same saved version.",
  EXPORT_SIZE_LIMIT: "The document is too large to make into a file.",
  RENDER_OR_STORAGE_UNAVAILABLE: "The file could not be made just now. Try again in a moment.",
};

function ExportButton({
  documentId,
  revisionId,
  format,
  disabled,
  onCreated,
}: {
  documentId: string;
  revisionId: string;
  format: "docx" | "pdf";
  disabled: boolean;
  onCreated: () => void;
}) {
  const [key, setKey] = useState(() => crypto.randomUUID());
  const create = useCreateDocumentExport({
    request: { headers: { "Idempotency-Key": key } },
    mutation: {
      onSuccess: () => {
        setKey(crypto.randomUUID());
        onCreated();
      },
    },
  });
  return (
    <div>
      <button
        className="btn btn-ghost btn-sm"
        disabled={disabled || create.isPending}
        onClick={() =>
          create.mutate({ id: documentId, data: { revisionId, format, acknowledgeDraft: true } })
        }
      >
        <Download className="h-4 w-4" aria-hidden="true" />
        {create.isPending ? "Asking…" : `Make a ${FILE_FORMAT_NAMES[format]} file`}
      </button>
      {create.isError && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {describeError(create.error).message}
        </p>
      )}
    </div>
  );
}
export function DocumentExports({
  documentId,
  documentTitle = "Document",
  revisionId,
  revisionNumber,
  disabled,
  missingCount = 0,
  finDirty = false,
  onSaveNow,
  onApplyFinancial,
  onPrintPreview,
  onJumpToFinancial,
  onJumpToMissing,
}: {
  documentId: string;
  documentTitle?: string;
  revisionId: string;
  revisionNumber: number;
  disabled: boolean;
  missingCount?: number;
  finDirty?: boolean;
  onSaveNow?: () => void;
  onApplyFinancial?: () => void;
  onPrintPreview?: () => void;
  onJumpToFinancial?: () => void;
  onJumpToMissing?: () => void;
}) {
  const checkbox = useId();
  const [acknowledged, setAcknowledged] = useState(false);
  const [canShare, setCanShare] = useState(false);
  const [sharingId, setSharingId] = useState<string | null>(null);
  const [shareNote, setShareNote] = useState("");
  useEffect(() => {
    setCanShare(canUseWebShare());
  }, []);
  const jobs = useListDocumentExports(documentId, {
    query: {
      refetchInterval: (query) =>
        query.state.data?.some((job) => ["queued", "running", "retrying"].includes(job.status))
          ? 2000
          : false,
      refetchOnWindowFocus: true,
    },
  });
  const retry = useRetryDocumentExport({
    mutation: {
      onSuccess: () => {
        void jobs.refetch();
      },
    },
  });

  async function shareJob(job: { id: string; format: "docx" | "pdf"; downloadUrl: string }) {
    setSharingId(job.id);
    setShareNote("");
    const outcome = await shareExportFile({
      title: documentTitle,
      format: job.format,
      downloadUrl: job.downloadUrl,
    });
    setSharingId(null);
    if (outcome === "error") {
      setShareNote("Could not open share options on this device. Use Download instead.");
    }
  }

  return (
    <section
      id="private-exports"
      className="surface p-5"
      aria-labelledby="export-heading"
      data-testid="private-exports"
    >
      <p className="eyebrow mb-2">Download</p>
      <h2 id="export-heading" className="font-display text-2xl">
        Download this document
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        A Word file and a PDF are made from the same saved version, and a draft notice appears on every page
        of each. The file is your own document. It is not a Valo template, proof of payment or a government
        tax invoice, and no professional has reviewed it.
      </p>
      <div
        role="group"
        className="mt-4 grid gap-2 rounded-xl border border-border bg-sidebar/40 p-3 text-xs"
        aria-label="Download readiness"
        data-testid="export-readiness"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            {!disabled ? (
              <Check className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
            ) : (
              <Circle className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            )}
            <span>
              {finDirty
                ? "Financial changes need to be applied"
                : disabled
                  ? "Unsaved edits waiting to save"
                  : `Saved version ${revisionNumber} is up to date`}
            </span>
          </span>
          {finDirty && onApplyFinancial ? (
            <button
              type="button"
              className="font-medium text-primary underline underline-offset-4"
              onClick={onApplyFinancial}
              data-testid="button-export-apply-financial"
            >
              Apply totals
            </button>
          ) : !finDirty && disabled && onSaveNow ? (
            <button
              type="button"
              className="font-medium text-primary underline underline-offset-4"
              onClick={onSaveNow}
              data-testid="button-export-save-now"
            >
              Save now
            </button>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {acknowledged ? (
            <Check className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
          ) : (
            <Circle className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          )}
          <span>{acknowledged ? "Draft copy notice confirmed" : "Confirm draft copy notice below"}</span>
        </div>
      </div>
      <label htmlFor={checkbox} className="my-4 flex items-start gap-3 text-sm">
        <input
          id={checkbox}
          type="checkbox"
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
          className="mt-1"
        />
        I want a draft copy: marked as a draft on every page, with any missing details left as they are.
      </label>
      {finDirty && (
        <div
          role="status"
          className="mb-3 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive"
          data-testid="status-export-financial-pending"
        >
          <p>Apply your financial changes before making a file.</p>
          {onJumpToFinancial && (
            <button
              type="button"
              className="mt-1 font-medium underline underline-offset-4"
              onClick={onJumpToFinancial}
            >
              Go to Financial details
            </button>
          )}
        </div>
      )}
      {!finDirty && disabled && (
        <p role="status" className="mb-3 text-sm">
          Save your changes before you make a file.
        </p>
      )}
      {missingCount > 0 && (
        <p
          className="mb-3 rounded-xl border border-[hsl(var(--ochre-border))] bg-[hsl(var(--ochre-soft))] px-3 py-2 text-xs leading-relaxed text-[hsl(var(--ochre-foreground))]"
          data-testid="status-export-missing-cue"
        >
          {missingCount === 1
            ? "1 detail is still blank in Still needed."
            : `${missingCount} details are still blank in Still needed.`}{" "}
          {onJumpToMissing && (
            <button
              type="button"
              className="font-medium underline underline-offset-4"
              onClick={onJumpToMissing}
            >
              Review still needed
            </button>
          )}
        </p>
      )}
      <p className="mb-3 text-sm">Saved version {revisionNumber}</p>
      <div className="flex flex-wrap gap-3">
        {(["docx", "pdf"] as const).map((format) => (
          <ExportButton
            key={`${revisionId}-${format}`}
            documentId={documentId}
            revisionId={revisionId}
            format={format}
            disabled={disabled || !acknowledged}
            onCreated={() => {
              void jobs.refetch();
            }}
          />
        ))}
        {onPrintPreview && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onPrintPreview}
            data-testid="button-print-preview"
          >
            <Printer className="h-4 w-4" aria-hidden="true" /> Print preview
          </button>
        )}
      </div>
      {jobs.isLoading && (
        <p className="mt-4 text-sm" role="status">
          Loading your files…
        </p>
      )}
      {jobs.isError && (
        <ErrorState
          title="Your files could not be loaded"
          error={jobs.error}
          onRetry={() => jobs.refetch()}
        />
      )}
      {jobs.data?.length === 0 && (
        <p className="mt-4 text-sm text-muted-foreground">No file has been made from this document yet.</p>
      )}
      <ul className="mt-5 divide-y divide-border" aria-live="polite">
        {jobs.data?.map((job) => (
          <li key={job.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {FILE_FORMAT_NAMES[job.format]} · version {job.revision} ·{" "}
                {job.errorCode === "EXPORT_EXPIRED" ? "expired" : STATUS_WORDS[job.status]}
              </p>
              {(job.size !== null || job.attempts > 1) && (
                <p className="text-xs text-muted-foreground">
                  {[
                    job.size !== null ? formatFileSize(job.size) : "",
                    job.attempts > 1 ? `tried ${job.attempts} times` : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}
              {job.expiresAt && job.downloadUrl && (
                <p className="text-xs text-muted-foreground">
                  You can download it until {formatDateTime(job.expiresAt)}.
                </p>
              )}
              {job.errorCode && (
                <p className="mt-1 break-words text-sm text-destructive">
                  {FAILURES[job.errorCode] ??
                    `The file could not be made. If you write to us about it, quote ${job.errorCode}.`}{" "}
                  Your saved document has not been changed.
                </p>
              )}
            </div>
            {job.downloadUrl && (
              <div className="flex flex-wrap gap-2">
                <a href={job.downloadUrl} className="btn btn-primary btn-sm">
                  <Download className="h-4 w-4" aria-hidden="true" />
                  Download the {FILE_FORMAT_NAMES[job.format]} file
                </a>
                {canShare && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={sharingId === job.id}
                    onClick={() =>
                      void shareJob({
                        id: job.id,
                        format: job.format,
                        downloadUrl: job.downloadUrl!,
                      })
                    }
                    data-testid="button-share-export"
                  >
                    <Share2 className="h-4 w-4" aria-hidden="true" />
                    {sharingId === job.id ? "Sharing…" : "Share"}
                  </button>
                )}
              </div>
            )}
            {job.status === "failed" && (
              <button
                className="btn btn-ghost btn-sm"
                disabled={retry.isPending}
                onClick={() => retry.mutate({ id: job.id, data: {} })}
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                {job.errorCode === "EXPORT_EXPIRED" ? "Make it again" : "Try again"}
              </button>
            )}
          </li>
        ))}
      </ul>
      {shareNote && (
        <p role="status" className="mt-2 text-xs text-muted-foreground">
          {shareNote}
        </p>
      )}
      {retry.isError && (
        <p role="alert" className="text-sm text-destructive">
          {describeError(retry.error).message}
        </p>
      )}
    </section>
  );
}
