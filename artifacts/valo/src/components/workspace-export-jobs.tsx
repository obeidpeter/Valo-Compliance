import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { PreparedWorkspaceDownload } from "./prepared-workspace-download";
import {
  activeWorkspaceExport,
  expiredWorkspaceExport,
  workspaceExportDownloadPath,
  mergeWorkspaceExports,
  workspaceExportError,
  listWorkspaceExports,
  getWorkspaceExport,
  requestWorkspaceExport,
  actOnWorkspaceExport,
  type WorkspaceExportJob,
} from "../lib/workspace-export-jobs";
import { formatCount, formatDateTime, formatFileSize } from "@/lib/format";

const LABELS: Record<WorkspaceExportJob["status"], string> = {
  queued: "Queued",
  preparing: "Preparing",
  ready: "Ready to download",
  interrupted: "Preparation interrupted",
  cancelled: "Cancelled",
  expired: "Expired",
};

export function WorkspaceExportJobs({ pollMs = 2000 }: { pollMs?: number }) {
  const [jobs, setJobs] = useState<WorkspaceExportJob[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progressError, setProgressError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uncertainCreate, setUncertainCreate] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);
  const [now, setNow] = useState(Date.now);
  const controller = useRef<AbortController | null>(null);
  const creatingKey = useRef<string | null>(null);
  const operation = useRef<string | null>(null);
  const listing = useRef(false);
  const polling = useRef(false);

  useLayoutEffect(() => {
    listing.current = false;
    polling.current = false;
    operation.current = null;
    const current = new AbortController();
    controller.current = current;
    return () => {
      current.abort();
      controller.current = null;
    };
  }, []);
  const current = (request: AbortController) => controller.current === request && !request.signal.aborted;
  const report = useCallback((failure: unknown) => {
    const problem = workspaceExportError(failure);
    if (problem.status === 401 || problem.status === 403) {
      setJobs([]);
      setCursor(null);
      setAccessDenied(true);
    }
    setError(problem.message);
    return problem;
  }, []);
  const refresh = useCallback(
    async (nextCursor?: string) => {
      const request = controller.current;
      if (!request || listing.current) return;
      listing.current = true;
      setLoading(true);
      try {
        const page = await listWorkspaceExports(request.signal, nextCursor);
        if (!current(request)) return;
        setJobs((previous) => mergeWorkspaceExports(previous, page.items));
        setCursor(page.nextCursor);
        setLoaded(true);
        setAccessDenied(false);
        setError(null);
        setProgressError(null);
      } catch (failure) {
        if (current(request)) report(failure);
      } finally {
        if (current(request)) {
          listing.current = false;
          setLoading(false);
        }
      }
    },
    [report],
  );
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const activeIds = jobs
    .filter(activeWorkspaceExport)
    .map((job) => job.id)
    .join(",");
  useEffect(() => {
    if (!activeIds || accessDenied) return;
    const poll = async () => {
      const request = controller.current;
      if (!request || polling.current) return;
      polling.current = true;
      try {
        const updates = await Promise.all(
          activeIds.split(",").map((id) => getWorkspaceExport(id, request.signal)),
        );
        if (current(request)) {
          setJobs((previous) => mergeWorkspaceExports(previous, updates));
          setProgressError(null);
        }
      } catch (failure) {
        if (current(request)) {
          const problem = workspaceExportError(failure);
          if (problem.status === 401 || problem.status === 403) report(failure);
          else
            setProgressError(
              "Progress could not be refreshed. The displayed status may be out of date; refresh to try again.",
            );
        }
      } finally {
        if (current(request)) polling.current = false;
      }
    };
    // poll handles its own failures, so the interval ignores its promise.
    const timer = setInterval(() => void poll(), pollMs);
    return () => clearInterval(timer);
  }, [activeIds, accessDenied, pollMs, report]);
  useEffect(() => {
    if (!jobs.some((job) => !["cancelled", "expired"].includes(job.status))) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [jobs]);

  async function mutate(action: "create" | "cancel" | "retry", job?: WorkspaceExportJob) {
    const request = controller.current;
    if (!request || operation.current) return;
    operation.current = job?.id ?? "create";
    setBusy(operation.current);
    setError(null);
    setNotice(null);
    try {
      if (!creatingKey.current) creatingKey.current = crypto.randomUUID();
      const result =
        action === "create"
          ? await requestWorkspaceExport(creatingKey.current, request.signal)
          : await actOnWorkspaceExport(job!, action, request.signal);
      if (!current(request)) return;
      setJobs((previous) => mergeWorkspaceExports(previous, [result]));
      if (action === "create") {
        creatingKey.current = null;
        setUncertainCreate(false);
      }
      setNotice(
        action === "cancel"
          ? result.status === "cancelled"
            ? job?.status === "ready"
              ? "Prepared export availability withdrawn. Cleanup follows recorded holds; downloaded copies are not removed."
              : "Export preparation cancelled."
            : "Cancellation requested. Check the current status below."
          : action === "retry"
            ? "Retry requested. Preparation continues if you leave this page."
            : "Export requested. Preparation continues if you leave this page.",
      );
    } catch (failure) {
      if (!current(request)) return;
      const problem = report(failure);
      if (action === "create") setUncertainCreate(problem.status === undefined || problem.status >= 500);
      if (problem.status === 409) {
        try {
          if (job) {
            const latest = await getWorkspaceExport(job.id, request.signal);
            if (current(request)) setJobs((previous) => mergeWorkspaceExports(previous, [latest]));
          } else await refresh();
          if (current(request))
            setError(
              "This export changed. Its current status has been refreshed. Review it before trying again.",
            );
        } catch (refreshFailure) {
          if (current(request)) report(refreshFailure);
        }
      }
    } finally {
      if (current(request)) {
        operation.current = null;
        setBusy(null);
      }
    }
  }

  return (
    <div className="mt-5 grid min-w-0 gap-4" data-testid="workspace-export-jobs">
      <p className="text-sm text-muted-foreground">
        Prepare a private JSON snapshot, then return here to download it. Preparation continues when you leave
        or reload. Prepared files are available until the displayed expiry, 24 hours after the original
        request; this is a product availability limit, not a legal retention period.
      </p>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          className="btn btn-primary"
          data-testid="button-request-workspace-export"
          disabled={
            !loaded ||
            loading ||
            !!busy ||
            accessDenied ||
            (jobs.some(
              (job) =>
                !expiredWorkspaceExport(job, now) &&
                ["queued", "preparing", "interrupted"].includes(job.status),
            ) &&
              !uncertainCreate)
          }
          onClick={() => void mutate("create")}
        >
          {busy === "create"
            ? "Requesting export…"
            : uncertainCreate
              ? "Retry export request"
              : "Prepare workspace export"}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={loading || !!busy}
          onClick={() => void refresh()}
          data-testid="button-refresh-workspace-exports"
        >
          {loading ? "Refreshing…" : "Refresh exports"}
        </button>
      </div>
      {uncertainCreate && (
        <p className="text-sm">The request may have been received. Retrying checks the same request.</p>
      )}
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {!error && progressError && (
        <p role="alert" className="text-sm text-destructive">
          {progressError}
        </p>
      )}
      {!loaded && loading && (
        <p role="status" className="text-sm">
          Loading saved export requests…
        </p>
      )}
      {loaded && !accessDenied && jobs.length === 0 && (
        <p className="text-sm text-muted-foreground">No export requests yet.</p>
      )}
      <ul className="grid min-w-0 gap-4" aria-label="Workspace export requests">
        {jobs.map((job) => {
          const expired = expiredWorkspaceExport(job, now);
          const file = workspaceExportDownloadPath(job, now);
          return (
            <li
              key={job.id}
              className="min-w-0 rounded-xl border border-border p-4"
              data-testid={`workspace-export-${job.id}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h3 className="font-medium" data-testid={`export-status-${job.id}`}>
                  {expired ? "Expired" : LABELS[job.status]}
                </h3>
                <span className="text-xs text-muted-foreground">
                  Requested {formatDateTime(job.createdAt)}
                </span>
              </div>
              <p className="mt-2 text-xs break-all text-muted-foreground">Reference {job.id}</p>
              {(activeWorkspaceExport(job) || job.status === "ready") && !expired && (
                <p className="mt-2 text-sm" aria-live="polite">
                  {formatCount(job.progress.rows)} rows read · {formatFileSize(job.progress.bytes)} prepared
                  {activeWorkspaceExport(job) ? " so far" : ""}
                </p>
              )}
              {job.status === "interrupted" && (
                <p className="mt-2 text-sm">
                  Preparation could not finish.{" "}
                  {job.retryAvailable
                    ? "You can request another preparation attempt."
                    : "Retry is unavailable; request a new export or contact support with this reference."}
                </p>
              )}
              {expired && (
                <p className="mt-2 text-sm">
                  This prepared file is no longer available. Request a new export for current data.
                </p>
              )}
              {job.status === "ready" && !expired && job.expiresAt && (
                <p className="mt-2 text-sm">Available until {formatDateTime(job.expiresAt)}.</p>
              )}
              {job.status === "ready" && !expired && !["cancelled", "expired"].includes(job.status) && (
                <p className="mt-2 text-sm">
                  Removing this prepared export withdraws download availability. Cleanup follows recorded
                  holds; downloaded copies are not removed.
                </p>
              )}
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer">Export scope</summary>
                <p className="mt-2 break-words text-muted-foreground">{job.notice}</p>
              </details>
              <div className="mt-3 flex flex-wrap gap-3">
                {!["cancelled", "expired"].includes(job.status) && !expired && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={!!busy}
                    onClick={() => void mutate("cancel", job)}
                    data-testid={`cancel-export-${job.id}`}
                  >
                    {busy === job.id
                      ? "Updating…"
                      : job.status === "ready"
                        ? "Remove prepared export"
                        : "Cancel export"}
                  </button>
                )}
                {job.retryAvailable && !activeWorkspaceExport(job) && !file && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={!!busy}
                    onClick={() => void mutate("retry", job)}
                    data-testid={`retry-export-${job.id}`}
                  >
                    {busy === job.id ? "Updating…" : "Retry preparation"}
                  </button>
                )}
              </div>
              {file && (
                <PreparedWorkspaceDownload
                  key={`${job.id}:${job.version}`}
                  endpoint={file}
                  buttonLabel="Download prepared JSON"
                  testIdPrefix={`export-${job.id}`}
                  preparedFile
                />
              )}
            </li>
          );
        })}
      </ul>
      {cursor && !accessDenied && (
        <button
          type="button"
          className="btn btn-ghost w-fit"
          disabled={loading || !!busy}
          onClick={() => void refresh(cursor)}
          data-testid="button-older-workspace-exports"
        >
          Load older exports
        </button>
      )}
    </div>
  );
}
