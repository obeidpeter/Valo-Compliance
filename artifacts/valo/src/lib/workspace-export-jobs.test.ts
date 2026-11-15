import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeWorkspaceExport, expiredWorkspaceExport, mergeWorkspaceExports, workspaceExportDownloadPath, type WorkspaceExportJob } from './workspace-export-jobs';

const id = '00000000-0000-4000-8000-000000000001';
const now = Date.parse('2026-11-15T12:00:00.000Z');
const job: WorkspaceExportJob = { id, status: 'ready', version: 3, attempts: 1, retryCycles: 0,
  rowsProcessed: 6001, bytesPrepared: 9_000_000, createdAt: '2026-11-15T11:00:00.000Z', updatedAt: '2026-11-15T11:01:00.000Z',
  expiresAt: '2026-11-16T11:01:00.000Z', errorCode: null, downloadUrl: `/api/workspace/data-exports/${id}/file`,
  scope: 'Synthetic application sections', schemaVersion: 2, mayCancel: false, mayRetry: false };

test('only current ready files expose a canonical private attachment route', () => {
  assert.equal(workspaceExportDownloadPath(job, now), job.downloadUrl);
  for (const candidate of [
    { ...job, status: 'running' as const }, { ...job, status: 'expired' as const },
    { ...job, expiresAt: null }, { ...job, expiresAt: 'invalid' }, { ...job, expiresAt: new Date(now).toISOString() },
    { ...job, downloadUrl: null }, { ...job, downloadUrl: 'https://example.test/file' },
    { ...job, downloadUrl: `${job.downloadUrl}?token=not-allowed` }, { ...job, id: '../another-workspace' },
  ]) assert.equal(workspaceExportDownloadPath(candidate, now), null);
  assert.equal(expiredWorkspaceExport({ ...job, expiresAt: new Date(now).toISOString() }, now), true);
});

test('late polling cannot replace a newer cancelled result or duplicate history rows', () => {
  const cancelled = { ...job, status: 'cancelled' as const, version: 4 };
  const rows = mergeWorkspaceExports([cancelled], [job, { ...job, version: 2, status: 'running' }]);
  assert.equal(rows.length, 1); assert.equal(rows[0].status, 'cancelled'); assert.equal(rows[0].version, 4);
  assert.deepEqual(mergeWorkspaceExports(rows, [cancelled]), rows);
});

test('polling is limited to jobs whose preparation can still change', () => {
  for (const status of ['queued', 'running', 'retrying'] as const) assert.equal(activeWorkspaceExport({ ...job, status }), true);
  for (const status of ['ready', 'failed', 'cancelled', 'expired'] as const) assert.equal(activeWorkspaceExport({ ...job, status }), false);
});
