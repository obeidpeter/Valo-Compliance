import { useId, useState } from "react";
import { Download, RotateCcw } from "lucide-react";
import {
  useListDocumentExports,
  useCreateDocumentExport,
  useRetryDocumentExport,
} from "@workspace/api-client-react";
import { describeError } from "@/lib/api";
import { FILE_FORMAT_NAMES } from "@/lib/file-formats";
import { formatDateTime, formatFileSize } from "@/lib/format";
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
        <p role="alert" className="mt-2 text-sm text-red-800">
          {describeError(create.error).message}
        </p>
      )}
    </div>
  );
}
export function DocumentExports({
  documentId,
  revisionId,
  revisionNumber,
  disabled,
}: {
  documentId: string;
  revisionId: string;
  revisionNumber: number;
  disabled: boolean;
}) {
  const checkbox = useId();
  const [acknowledged, setAcknowledged] = useState(false);
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
      {disabled && (
        <p role="status" className="mb-3 text-sm">
          Save your changes before you make a file.
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
                <p className="mt-1 break-words text-sm text-red-800">
                  {FAILURES[job.errorCode] ??
                    `The file could not be made. If you write to us about it, quote ${job.errorCode}.`}{" "}
                  Your saved document has not been changed.
                </p>
              )}
            </div>
            {job.downloadUrl && (
              <a href={job.downloadUrl} className="btn btn-primary btn-sm">
                <Download className="h-4 w-4" aria-hidden="true" />
                Download the {FILE_FORMAT_NAMES[job.format]} file
              </a>
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
      {retry.isError && (
        <p role="alert" className="text-sm text-red-800">
          {describeError(retry.error).message}
        </p>
      )}
    </section>
  );
}
