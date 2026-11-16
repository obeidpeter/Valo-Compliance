import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activeWorkspaceExport,
  expiredWorkspaceExport,
  mergeWorkspaceExports,
  workspaceExportDownloadPath,
  type WorkspaceExportJob,
} from "./workspace-export-jobs";
const id = "00000000-0000-4000-8000-000000000001",
  now = Date.parse("2026-11-15T12:00:00Z");
const job: WorkspaceExportJob = {
  id,
  status: "ready",
  version: 3,
  attempts: 1,
  progress: { section: "yourActivity", rows: 6001, bytes: 9000000 },
  createdAt: "2026-11-15T11:00:00Z",
  expiresAt: "2026-11-16T11:00:00Z",
  snapshotAt: "2026-11-15T11:01:00Z",
  size: 9000000,
  counts: { yourActivity: 6001 },
  errorCode: null,
  notice: "Synthetic application sections only",
  retryAvailable: false,
};
test("only unexpired ready native jobs have a fixed attachment path", () => {
  assert.equal(workspaceExportDownloadPath(job, now), `/api/workspace/data-exports/${id}/download`);
  for (const row of [
    { ...job, status: "preparing" as const },
    { ...job, status: "interrupted" as const },
    { ...job, expiresAt: "invalid" },
    { ...job, expiresAt: new Date(now).toISOString() },
    { ...job, id: "../another-workspace" },
  ])
    assert.equal(workspaceExportDownloadPath(row, now), null);
  assert.equal(
    expiredWorkspaceExport({ ...job, status: "interrupted", expiresAt: new Date(now).toISOString() }, now),
    true,
  );
});
test("late polling never replaces newer cancellation and history stays newest first", () => {
  const cancelled = { ...job, status: "cancelled" as const, version: 4 };
  const rows = mergeWorkspaceExports([cancelled], [job, { ...job, version: 2 }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "cancelled");
  assert.equal(rows[0].version, 4);
});
test("only queued and preparing states need worker progress polling", () => {
  for (const status of ["queued", "preparing"] as const)
    assert.equal(activeWorkspaceExport({ ...job, status }), true);
  for (const status of ["ready", "interrupted", "cancelled", "expired"] as const)
    assert.equal(activeWorkspaceExport({ ...job, status }), false);
});
