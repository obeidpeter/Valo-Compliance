import { createHash } from "node:crypto";
import type { Client, PoolClient } from "pg";

const DAY = 86_400_000,
  MAX_ASSETS = 10_000;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fail = (code: string): never => {
  throw Error(code);
};
export type RetentionTarget = { databaseId: string; environment: "development" | "production-rehearsal" };
type AssetRow = {
  id: string;
  workspace_id: string;
  job_id: string;
  object_key: string;
  checksum: string;
  size: number;
  mime: string;
  created_at: Date;
  retention_at: Date | null;
  format: string | null;
  status: string | null;
  queue_id: string | null;
  revision_id: string | null;
  source_hash: string | null;
  job_workspace_id: string | null;
  document_id: string | null;
  revision: number | null;
  render_version: string | null;
  reservation_job_id: string | null;
  reservation_workspace_id: string | null;
  reservation_queue_id: string | null;
  reservation_state: string | null;
  privacy_review: boolean;
  erasure_owned: boolean;
  privacy_fingerprint: string;
};
export type RetentionEntry = {
  assetId: string;
  workspaceId: string;
  jobId: string;
  createdAt: string;
  retentionAt: string | null;
  bytes: number;
  fingerprint: string;
  blockers: string[];
};
export type RetentionInventory = {
  version: 1;
  readOnly: true;
  databaseId: string;
  environment: RetentionTarget["environment"];
  observedAt: string;
  fingerprint: string;
  entries: RetentionEntry[];
  summary: {
    assets: number;
    bytes: number;
    unassigned: number;
    eligibleLegacy: number;
    blocked: number;
    expired: number;
    oldestCreatedAt: string | null;
    newestCreatedAt: string | null;
  };
  retentionCoverageComplete: boolean;
  launchReady: false;
};

/** Caller supplies a dedicated connection, never a transaction used by application work.
 * The database enforces read-only access. No storage SDK, signing key, lock or DML
 * is needed to inspect metadata. Any deletion-case history needs separate review:
 * this conservative inventory never interprets an unauthenticated status as release.
 */
export async function inspectExportRetention(
  client: Client | PoolClient,
  target: RetentionTarget,
): Promise<RetentionInventory> {
  if (!uuid.test(target.databaseId) || !["development", "production-rehearsal"].includes(target.environment))
    fail("RETENTION_TARGET_REQUIRED");
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    await client.query("SET LOCAL statement_timeout='10s'");
    await client.query("SET LOCAL timezone='UTC'");
    const identity = await client.query(
      "SELECT instance_id,environment FROM valo_runtime_identity WHERE singleton=true",
    );
    if (
      identity.rows.length !== 1 ||
      identity.rows[0].instance_id !== target.databaseId ||
      identity.rows[0].environment !== target.environment
    )
      fail("RETENTION_DATABASE_IDENTITY_MISMATCH");
    const clock = await client.query("SELECT transaction_timestamp() AS observed_at");
    const result = await client.query<AssetRow>(
      `SELECT a.id,a.workspace_id,a.job_id,a.object_key,a.checksum,a.size,a.mime,a.created_at,a.retention_at,
      j.format,j.status,j.queue_id,j.revision_id,j.source_hash,j.document_id,j.revision,j.render_version,j.workspace_id AS job_workspace_id,
      o.job_id AS reservation_job_id,o.workspace_id AS reservation_workspace_id,o.queue_id AS reservation_queue_id,o.state AS reservation_state,
      EXISTS(SELECT 1 FROM valo_privacy_cases p WHERE p.workspace_id=a.workspace_id AND p.kind='deletion') AS privacy_review,
      EXISTS(SELECT 1 FROM valo_privacy_tombstones t WHERE t.workspace_id=a.workspace_id) AS erasure_owned,
      md5(COALESCE((SELECT string_agg(p.id::text||':'||p.version::text||':'||p.last_event_hash||':'||p.status||':'||p.erasure_phase,',' ORDER BY p.id)
        FROM valo_privacy_cases p WHERE p.workspace_id=a.workspace_id AND p.kind='deletion'),'')||'/'||
        COALESCE((SELECT string_agg(t.id::text||':'||t.phase||':'||t.updated_at::text,',' ORDER BY t.id)
        FROM valo_privacy_tombstones t WHERE t.workspace_id=a.workspace_id),'')) AS privacy_fingerprint
      FROM valo_file_assets a LEFT JOIN valo_export_jobs j ON j.id=a.job_id
      LEFT JOIN valo_export_objects o ON o.object_key=a.object_key ORDER BY a.id LIMIT $1`,
      [MAX_ASSETS + 1],
    );
    if (result.rows.length > MAX_ASSETS) fail("RETENTION_INVENTORY_LIMIT_EXCEEDED");
    const observedAt = (clock.rows[0].observed_at as Date).toISOString();
    const entries = result.rows.map((row) => {
      const blockers: string[] = [];
      const environment = target.environment === "development" ? "development" : "production";
      if (row.status !== "ready") blockers.push("EXPORT_NOT_READY");
      if (
        row.job_workspace_id !== row.workspace_id ||
        !["docx", "pdf"].includes(row.format ?? "") ||
        row.object_key !== `valo/${environment}/${row.workspace_id}/${row.id}.${row.format}` ||
        !/^[a-f0-9]{64}$/.test(row.checksum) ||
        !Number.isSafeInteger(row.size) ||
        row.size < 1 ||
        row.mime !==
          (row.format === "pdf"
            ? "application/pdf"
            : "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
      )
        blockers.push("ASSET_BINDING_INVALID");
      if (
        row.reservation_state !== "retained" ||
        row.reservation_job_id !== row.job_id ||
        row.reservation_workspace_id !== row.workspace_id ||
        row.reservation_queue_id !== row.queue_id
      )
        blockers.push("RESERVATION_BINDING_INVALID");
      if (row.erasure_owned) blockers.push("PRIVACY_ERASURE_OWNED");
      if (row.privacy_review) blockers.push("PRIVACY_HISTORY_REQUIRES_REVIEW");
      if (row.created_at.getTime() > Date.parse(observedAt)) blockers.push("ASSET_TIMESTAMP_INVALID");
      return {
        assetId: row.id,
        workspaceId: row.workspace_id,
        jobId: row.job_id,
        createdAt: row.created_at.toISOString(),
        retentionAt: row.retention_at?.toISOString() ?? null,
        bytes: row.size,
        fingerprint: hash(row),
        blockers,
      };
    });
    const dates = entries.map((entry) => entry.createdAt).sort();
    const summary = {
      assets: entries.length,
      bytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
      unassigned: entries.filter((entry) => entry.retentionAt === null).length,
      eligibleLegacy: entries.filter((entry) => entry.retentionAt === null && !entry.blockers.length).length,
      blocked: entries.filter((entry) => entry.blockers.length).length,
      expired: entries.filter(
        (entry) => entry.retentionAt !== null && Date.parse(entry.retentionAt) <= Date.parse(observedAt),
      ).length,
      oldestCreatedAt: dates[0] ?? null,
      newestCreatedAt: dates.at(-1) ?? null,
    };
    return {
      version: 1,
      readOnly: true,
      ...target,
      observedAt,
      fingerprint: hash({ version: 1, ...target, entries }),
      entries,
      summary,
      retentionCoverageComplete: summary.unassigned === 0 && summary.blocked === 0,
      launchReady: false,
    };
  } finally {
    await client.query("ROLLBACK");
  }
}

export type RetentionProposalOptions = { effectiveAt: string; retentionDays: number; graceDays: number };
/** A proposal is evidence for owner review, never an instruction to the worker.
 * Grace begins at the proposed effective time; historical age cannot cause
 * immediate expiry. Existing deadlines and privacy-owned rows are not rewritten.
 */
export function proposeExportRetention(inventory: RetentionInventory, options: RetentionProposalOptions) {
  const effective = Date.parse(options.effectiveAt);
  if (
    !Number.isFinite(effective) ||
    new Date(effective).toISOString() !== options.effectiveAt ||
    effective < Date.parse(inventory.observedAt) ||
    !Number.isInteger(options.retentionDays) ||
    options.retentionDays < 1 ||
    options.retentionDays > 365 ||
    !Number.isInteger(options.graceDays) ||
    options.graceDays < 1 ||
    options.graceDays > 365
  )
    fail("RETENTION_PROPOSAL_OPTIONS_INVALID");
  const changes = inventory.entries
    .filter((entry) => entry.retentionAt === null && !entry.blockers.length)
    .map((entry) => ({
      assetId: entry.assetId,
      workspaceId: entry.workspaceId,
      jobId: entry.jobId,
      expectedFingerprint: entry.fingerprint,
      proposedRetentionAt: new Date(
        Math.max(
          Date.parse(entry.createdAt) + options.retentionDays * DAY,
          effective + options.graceDays * DAY,
        ),
      ).toISOString(),
    }));
  const proposal = {
    version: 1,
    databaseId: inventory.databaseId,
    environment: inventory.environment,
    inventoryFingerprint: inventory.fingerprint,
    ...options,
    changes,
  };
  return {
    ...proposal,
    proposalFingerprint: hash(proposal),
    readOnly: true,
    approvalRequired: true,
    applied: false,
    excludedUnassigned: inventory.summary.unassigned - changes.length,
    prerequisites: [
      "OWNER_APPROVES_EXACT_PROPOSAL",
      "FRESH_VERIFIED_BACKUP_AND_PRIVACY_JOURNAL",
      "REVALIDATE_INVENTORY_AND_AUTHENTICATED_PRIVACY_AUTHORITY",
      "REVIEWED_ATOMIC_APPLY_AND_ROLLBACK",
    ],
  };
}
