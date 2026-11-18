/** Private operator metadata, not a customer upload/API. Call only after the
 * disposable target guard and the independent recovery-journal MAC check. */
import type { PoolClient } from "pg";
import { z } from "zod";
import { drizzle } from "drizzle-orm/node-postgres";
import { schema } from "@workspace/db";
import { verifyCompletedErasureReceipt, redactAuditReason, removedPrivateText } from "../modules/privacy";
const tables = [
  "valo_support_tickets",
  "valo_privacy_cases",
  "valo_privacy_events",
  "valo_privacy_redactions",
  "valo_privacy_tombstones",
  "valo_privacy_erasure_objects",
] as const;
const rows = z.array(z.record(z.string(), z.unknown())).max(250000);
export const recoveryErasureReceiptSchema = z
  .object({
    version: z.literal(1),
    workspaceId: z.string().uuid(),
    caseId: z.string().uuid(),
    records: z
      .object({
        valo_support_tickets: rows,
        valo_privacy_cases: rows,
        valo_privacy_events: rows,
        valo_privacy_redactions: rows,
        valo_privacy_tombstones: rows,
        valo_privacy_erasure_objects: rows,
      })
      .strict(),
    keyRegistrations: rows.max(100),
  })
  .strict();
export type RecoveryErasureReceipt = z.infer<typeof recoveryErasureReceiptSchema>;
type Tx = Parameters<Parameters<ReturnType<typeof drizzle<typeof schema>>["transaction"]>[0]>[0];
async function ownedSynthetic(client: PoolClient, workspaceId: string, identityId?: string) {
  const { rows } = await client.query(
    "SELECT owner_identity_id FROM valo_workspaces WHERE id=$1 FOR UPDATE",
    [workspaceId],
  );
  if (
    rows.length !== 1 ||
    !String(rows[0].owner_identity_id).startsWith("synthetic-recovery-") ||
    (identityId && rows[0].owner_identity_id !== identityId)
  )
    throw Error("OWNED_SYNTHETIC_ERASURE_SCOPE_REQUIRED");
}
/** Invoked in the guarded source child AFTER a real synthetic verified request
 * has completed. No source content, private documents or key values are copied. */
export async function captureRecoveryErasureReceipt(client: PoolClient, caseId: string, workspaceId: string) {
  const db = drizzle(client, { schema });
  return db.transaction(async (tx) => {
    // PostgreSQL to_jsonb(timestamptz) follows the session timezone. Pin receipt
    // serialization so the same instant compares identically on another host.
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    const state = (
      await client.query("SELECT current_database() AS name,current_setting('data_directory') AS directory")
    ).rows[0];
    if (state.name !== "valo_restore_source" || !state.directory.startsWith("/tmp/valo-recovery-"))
      throw Error("DISPOSABLE_RECOVERY_SOURCE_REQUIRED");
    await ownedSynthetic(client, workspaceId);
    const valid = await verifyCompletedErasureReceipt(tx, caseId);
    if (valid.workspaceId !== workspaceId) throw Error("RECOVERY_SOURCE_RECEIPT_SCOPE_MISMATCH");
    const records = {} as RecoveryErasureReceipt["records"];
    for (const table of tables) {
      const filter =
        table === "valo_privacy_tombstones" || table === "valo_privacy_erasure_objects"
          ? "workspace_id=$1 AND case_id=$2"
          : "workspace_id=$1";
      records[table] = (
        await client.query(
          `SELECT to_jsonb(r) AS row FROM ${table} r WHERE ${filter}`,
          filter.includes("$2") ? [workspaceId, caseId] : [workspaceId],
        )
      ).rows.map((r) => r.row);
    }
    const versions = new Set<string>();
    for (const row of Object.values(records).flat()) {
      for (const [name, value] of Object.entries(row))
        if (/(^|_)key_version$/.test(name) && typeof value === "string") versions.add(value);
      for (const name of ["erasure_seal", "replay_state"]) {
        const value = row[name] as Record<string, unknown> | null;
        if (value)
          for (const key of ["keyVersion", "identityKeyVersion"])
            if (typeof value[key] === "string") versions.add(value[key]);
      }
    }
    const keyRegistrations = (
      await client.query(
        `SELECT to_jsonb(r) AS row FROM valo_privacy_key_versions r
      WHERE id=ANY($1::text[])`,
        [[...versions]],
      )
    ).rows.map((r) => r.row);
    return recoveryErasureReceiptSchema.parse({ version: 1, workspaceId, caseId, records, keyRegistrations });
  });
}
function jsonEqual(a: unknown, b: unknown): boolean {
  const canonical = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canonical)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, x]) => [k, canonical(x)]),
          )
        : v;
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}
/** The caller supplies a transaction on the exact guarded target. A partial
 * import, bad chain/key/inventory, wrong owner or conflict rolls back entirely. */
export async function importRecoveryErasureReceipt(
  client: PoolClient,
  tx: Tx,
  raw: unknown,
  identityId: string,
) {
  await client.query("SET LOCAL TIME ZONE 'UTC'");
  const receipt = recoveryErasureReceiptSchema.parse(raw);
  await ownedSynthetic(client, receipt.workspaceId, identityId);
  for (const table of tables)
    for (const row of receipt.records[table]) {
      if (
        row.workspace_id !== receipt.workspaceId ||
        ((table === "valo_privacy_tombstones" || table === "valo_privacy_erasure_objects") &&
          row.case_id !== receipt.caseId)
      )
        throw Error("RECOVERY_ERASURE_ROW_SCOPE_MISMATCH");
    }
  if (receipt.records.valo_privacy_tombstones.length !== 1)
    throw Error("ONE_COMPLETED_ERASURE_RECEIPT_REQUIRED");
  const sourceTombstone = receipt.records.valo_privacy_tombstones[0]!;
  const current = (
    await client.query("SELECT erasure_seal FROM valo_privacy_tombstones WHERE case_id=$1 FOR UPDATE", [
      receipt.caseId,
    ])
  ).rows[0];
  if (current?.erasure_seal) {
    if (!jsonEqual(current.erasure_seal, sourceTombstone.erasure_seal))
      throw Error("RECOVERY_ERASURE_RECEIPT_CHANGED");
    await verifyCompletedErasureReceipt(tx, receipt.caseId);
    return { reused: true, workspaceId: receipt.workspaceId };
  }
  if (current) throw Error("LEGACY_QUARANTINE_REQUIRES_MEASURED_RECEIPT_ADOPTION");
  const insert = async (table: string, row: Record<string, unknown>, conflict: string, replace = false) => {
    if (![...tables, "valo_privacy_key_versions"].includes(table))
      throw Error("RECOVERY_METADATA_TABLE_REJECTED");
    const columns = (
      await client.query(
        `SELECT attname FROM pg_attribute WHERE attrelid=$1::regclass
      AND attnum>0 AND NOT attisdropped ORDER BY attnum`,
        [table],
      )
    ).rows.map((r) => String(r.attname));
    if (
      Object.keys(row).length !== columns.length ||
      columns.some((c) => !Object.hasOwn(row, c) || !/^[a-z_]+$/.test(c))
    )
      throw Error("RECOVERY_METADATA_SHAPE_MISMATCH");
    if (replace && row.workspace_id) {
      const existing = (
        await client.query(`SELECT workspace_id FROM ${table} WHERE id=$1 FOR UPDATE`, [row.id])
      ).rows[0];
      if (existing && existing.workspace_id !== receipt.workspaceId)
        throw Error("RECOVERY_METADATA_OWNERSHIP_CONFLICT");
    }
    const update = replace
      ? `DO UPDATE SET ${columns
          .filter((c) => c !== "id")
          .map((c) => `"${c}"=EXCLUDED."${c}"`)
          .join(",")}`
      : "DO NOTHING";
    await client.query(
      `INSERT INTO ${table} SELECT * FROM jsonb_populate_record(NULL::${table},$1::jsonb)
      ON CONFLICT${replace ? `(${conflict})` : ""} ${update}`,
      [JSON.stringify(row)],
    );
  };
  for (const row of receipt.keyRegistrations) await insert("valo_privacy_key_versions", row, "id");
  for (const row of receipt.records.valo_support_tickets)
    await insert("valo_support_tickets", row, "id", true);
  for (const row of receipt.records.valo_privacy_cases) {
    const prior = (
      await client.query("SELECT workspace_id,version FROM valo_privacy_cases WHERE id=$1 FOR UPDATE", [
        row.id,
      ])
    ).rows[0];
    if (prior && (prior.workspace_id !== receipt.workspaceId || Number(prior.version) > Number(row.version)))
      throw Error("RECOVERY_CASE_CONFLICT_OR_NEWER_HOLD");
    await insert("valo_privacy_cases", row, "id", true);
  }
  for (const row of receipt.records.valo_privacy_redactions)
    await insert("valo_privacy_redactions", row, "table_name,row_id");
  for (const row of receipt.records.valo_privacy_events) {
    const prior = (
      await client.query("SELECT to_jsonb(e) AS row FROM valo_privacy_events e WHERE id=$1 FOR UPDATE", [
        row.id,
      ])
    ).rows[0]?.row;
    if (prior) {
      if (prior.workspace_id !== receipt.workspaceId || prior.event_hash !== row.event_hash)
        throw Error("RECOVERY_PRIVACY_HISTORY_CONFLICT");
      if (prior.reason !== row.reason) {
        if (row.reason !== removedPrivateText) throw Error("RECOVERY_PRIVATE_REASON_REINTRODUCTION_DENIED");
        await redactAuditReason(tx, "valo_privacy_events", prior);
      }
    } else await insert("valo_privacy_events", row, "id");
    const actual = (
      await client.query("SELECT to_jsonb(e) AS row FROM valo_privacy_events e WHERE id=$1", [row.id])
    ).rows[0]?.row;
    if (!jsonEqual(actual, row)) throw Error("RECOVERY_PRIVACY_HISTORY_CHANGED");
  }
  // Reconstitute the exact key set BEFORE inserting the authenticated seal,
  // atomically. Never disable/unseal the inventory's database guard.
  for (const row of receipt.records.valo_privacy_erasure_objects)
    await insert("valo_privacy_erasure_objects", row, "case_id,object_key");
  for (const row of receipt.records.valo_privacy_tombstones)
    await insert("valo_privacy_tombstones", { ...row, replay_state: null }, "id");
  const valid = await verifyCompletedErasureReceipt(tx, receipt.caseId);
  if (valid.workspaceId !== receipt.workspaceId) throw Error("RECOVERY_COMPLETION_SCOPE_MISMATCH");
  return { reused: false, workspaceId: receipt.workspaceId };
}
