import {
  customFetch,
  type WorkspaceExportJob as GeneratedWorkspaceExportJob,
  type WorkspaceExportPage as GeneratedWorkspaceExportPage,
} from "@workspace/api-client-react";

export type WorkspaceExportJob = GeneratedWorkspaceExportJob;
export type WorkspaceExportPage = GeneratedWorkspaceExportPage;
const BASE = "/api/workspace/data-exports";
export const activeWorkspaceExport = (job: WorkspaceExportJob) =>
  ["queued", "preparing"].includes(job.status);
export const expiredWorkspaceExport = (job: WorkspaceExportJob, now: number) =>
  job.status === "expired" ||
  (job.status !== "cancelled" &&
    (!job.expiresAt || !Number.isFinite(Date.parse(job.expiresAt)) || Date.parse(job.expiresAt) <= now));
export function workspaceExportDownloadPath(job: WorkspaceExportJob, now: number): string | null {
  if (
    job.status !== "ready" ||
    expiredWorkspaceExport(job, now) ||
    !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(job.id)
  )
    return null;
  const path = `${BASE}/${job.id}/download`;
  return path;
}
export function mergeWorkspaceExports(
  previous: WorkspaceExportJob[],
  next: WorkspaceExportJob[],
): WorkspaceExportJob[] {
  const rows = new Map(previous.map((job) => [job.id, job]));
  for (const job of next)
    if (!rows.has(job.id) || rows.get(job.id)!.version <= job.version) rows.set(job.id, job);
  return [...rows.values()].sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
  );
}
export function workspaceExportError(error: unknown): { status?: number; message: string } {
  const value = error as { status?: number; data?: { error?: string } } | null;
  const status = value?.status;
  return {
    status,
    message:
      status === 401
        ? "Sign in again to view or request exports."
        : status === 403
          ? "Your access to these exports is no longer available."
          : status === 409
            ? "This export changed. Refresh its status before trying again."
            : status === 429
              ? "Too many export requests. Wait before trying again."
              : "The export service could not be reached. Try again; an existing request may still be preparing.",
  };
}
export const listWorkspaceExports = (signal: AbortSignal, cursor?: string) =>
  customFetch<WorkspaceExportPage>(BASE + (cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""), {
    signal,
  });
export const getWorkspaceExport = (id: string, signal: AbortSignal) =>
  customFetch<WorkspaceExportJob>(`${BASE}/${encodeURIComponent(id)}`, { signal });
export const requestWorkspaceExport = (idempotencyKey: string, signal: AbortSignal) => {
  const body = { requestKey: idempotencyKey };
  return customFetch<WorkspaceExportJob>(BASE, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
};
export const actOnWorkspaceExport = (
  job: WorkspaceExportJob,
  action: "cancel" | "retry",
  signal: AbortSignal,
) => {
  const body = { expectedVersion: job.version };
  return customFetch<WorkspaceExportJob>(`${BASE}/${encodeURIComponent(job.id)}/${action}`, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
};
