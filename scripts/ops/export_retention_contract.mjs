// Private recovery metadata. No storage provider, application startup or writes.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const date = (value) =>
  typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const fields = [
  "assetId",
  "workspaceId",
  "jobId",
  "objectKey",
  "checksum",
  "bytes",
  "createdAt",
  "retentionAt",
  "sourceFingerprint",
  "downloadable",
];
export function validateExportRetention(value) {
  assert.ok(
    value?.version === 1 &&
      value.environment === "development" &&
      value.complete === true &&
      uuid.test(value.databaseId) &&
      Array.isArray(value.entries) &&
      value.entries.length <= 10000,
    "RETENTION_JOURNAL_REQUIRED",
  );
  assert.deepEqual(
    Object.keys(value).sort(),
    ["version", "environment", "complete", "databaseId", "entries"].sort(),
    "RETENTION_JOURNAL_SHAPE_INVALID",
  );
  for (const row of value.entries) {
    assert.deepEqual(Object.keys(row).sort(), [...fields].sort(), "RETENTION_ENTRY_SHAPE_INVALID");
    assert.ok(
      [row.assetId, row.workspaceId, row.jobId].every((id) => uuid.test(id)) &&
        new RegExp(`^valo/development/${row.workspaceId}/${row.assetId}\\.(docx|pdf)$`).test(row.objectKey) &&
        /^[a-f0-9]{64}$/.test(row.checksum) &&
        /^[a-f0-9]{64}$/.test(row.sourceFingerprint) &&
        Number.isSafeInteger(row.bytes) &&
        row.bytes > 0 &&
        date(row.createdAt) &&
        (row.retentionAt === null || date(row.retentionAt)) &&
        typeof row.downloadable === "boolean",
      "RETENTION_ENTRY_INVALID",
    );
  }
  for (const name of ["assetId", "jobId", "objectKey"])
    assert.equal(
      new Set(value.entries.map((row) => row[name])).size,
      value.entries.length,
      "RETENTION_DUPLICATE_ENTRY",
    );
  return value;
}
/** Runs inside the caller's UTC, repeatable-read snapshot. An exceeded bound or
 * malformed row fails the capture; an incomplete inventory is never signed. */
export async function captureExportRetention(client) {
  const identity = (
    await client.query("SELECT instance_id,environment FROM valo_runtime_identity WHERE singleton=true")
  ).rows;
  assert.ok(
    identity.length === 1 && identity[0].environment === "development",
    "RETENTION_SOURCE_IDENTITY_REQUIRED",
  );
  const rows = (
    await client.query(`SELECT a.id,a.workspace_id,a.job_id,a.object_key,a.checksum,a.size,a.mime,a.created_at,a.retention_at,
   j.document_id,j.revision_id,j.revision,j.format,j.render_version,j.source_hash,j.queue_id,j.status,j.workspace_id AS job_workspace,
   o.workspace_id AS object_workspace,o.job_id AS object_job,o.queue_id AS object_queue,o.state AS object_state
   FROM valo_file_assets a LEFT JOIN valo_export_jobs j ON j.id=a.job_id
   LEFT JOIN valo_export_objects o ON o.object_key=a.object_key ORDER BY a.id LIMIT 10001`)
  ).rows;
  assert.ok(rows.length <= 10000, "RETENTION_JOURNAL_LIMIT_EXCEEDED");
  const entries = rows.map((row) => {
    const stable = {
      assetId: row.id,
      workspaceId: row.workspace_id,
      jobId: row.job_id,
      objectKey: row.object_key,
      checksum: row.checksum,
      bytes: row.size,
      createdAt: row.created_at.toISOString(),
      mime: row.mime,
      documentId: row.document_id,
      revisionId: row.revision_id,
      revision: row.revision,
      format: row.format,
      renderVersion: row.render_version,
      sourceHash: row.source_hash,
      queueId: row.queue_id,
      jobWorkspace: row.job_workspace,
    };
    return {
      assetId: stable.assetId,
      workspaceId: stable.workspaceId,
      jobId: stable.jobId,
      objectKey: stable.objectKey,
      checksum: stable.checksum,
      bytes: stable.bytes,
      createdAt: stable.createdAt,
      retentionAt: row.retention_at?.toISOString() ?? null,
      sourceFingerprint: digest(stable),
      downloadable:
        row.status === "ready" &&
        row.job_workspace === row.workspace_id &&
        row.object_state === "retained" &&
        row.object_workspace === row.workspace_id &&
        row.object_job === row.job_id &&
        row.object_queue === row.queue_id &&
        row.mime ===
          (row.format === "pdf"
            ? "application/pdf"
            : "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    };
  });
  return validateExportRetention({
    version: 1,
    environment: "development",
    complete: true,
    databaseId: identity[0].instance_id,
    entries,
  });
}
/** Missing/new generations, unresolved policy and invalid bindings stay held.
 * A newer journal never extends an earlier restored deadline. */
export function planExportRetention(restored, current) {
  validateExportRetention(restored);
  validateExportRetention(current);
  assert.equal(restored.databaseId, current.databaseId, "RETENTION_DATABASE_MISMATCH");
  const index = new Map(current.entries.map((row) => [row.assetId, row]));
  return restored.entries.map((row) => {
    const latest = index.get(row.assetId);
    if (
      !latest ||
      latest.sourceFingerprint !== row.sourceFingerprint ||
      latest.workspaceId !== row.workspaceId ||
      latest.jobId !== row.jobId ||
      latest.objectKey !== row.objectKey ||
      !latest.downloadable ||
      !row.downloadable ||
      !latest.retentionAt
    )
      return {
        assetId: row.assetId,
        jobId: row.jobId,
        workspaceId: row.workspaceId,
        kind: "quarantine",
        reason: !latest
          ? "absent_from_current_journal"
          : latest.sourceFingerprint !== row.sourceFingerprint
            ? "generation_changed"
            : !latest.retentionAt
              ? "retention_unresolved"
              : "binding_unavailable",
      };
    const deadline =
      row.retentionAt && Date.parse(row.retentionAt) < Date.parse(latest.retentionAt)
        ? row.retentionAt
        : latest.retentionAt;
    return {
      assetId: row.assetId,
      jobId: row.jobId,
      workspaceId: row.workspaceId,
      kind: "deadline",
      retentionAt: deadline,
    };
  });
}
