import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { quotaSubjectHash } from "./valo-quota-policy";
import { assertDevelopmentRuntime } from "./valo-development-runtime";
import { assertWindowsRecoveryTarget } from "./valo-recovery-target";
const controlsSchema = z
  .object({
    snapshotHash: z.string().regex(/^[a-f0-9]{64}$/),
    cutoff: z.string().datetime(),
    entries: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            workspaceId: z.string().uuid(),
            identityId: z.string().startsWith("synthetic-recovery-"),
            kind: z.enum(["deletion", "revocation"]),
            recordedAt: z.string().datetime(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
    erasureReceipts: z.array(z.unknown()).max(100).optional(),
  })
  .strict();
export type RecoveryControls = z.infer<typeof controlsSchema>;
export function signRecoveryControls(input: RecoveryControls, key: Buffer) {
  return createHmac("sha256", key)
    .update(JSON.stringify(controlsSchema.parse(input)))
    .digest("hex");
}
export async function assertIsolatedRecoveryTarget(client: PoolClient) {
  assertDevelopmentRuntime();
  if (process.env.VALO_ISOLATED_RECOVERY !== "synthetic-local-only")
    throw Error("EXPLICIT_ISOLATED_RECOVERY_REQUIRED");
  if (process.env.VALO_RECOVERY_WINDOWS_ROOT) {
    await assertWindowsRecoveryTarget(client);
    return;
  }
  const {
    rows: [r],
  } = await client.query(
    "SELECT current_database() AS name,current_setting('data_directory') AS directory,current_setting('unix_socket_directories') AS sockets",
  );
  if (
    r.name !== "valo_restore_target" ||
    !r.directory.startsWith("/tmp/valo-recovery-") ||
    !r.sockets.startsWith("/tmp/valo-recovery-")
  )
    throw Error("LOCAL_DISPOSABLE_RECOVERY_TARGET_REQUIRED");
}
/** Replay only into the guarded disposable target; not a production erasure processor. */
export async function replayRecoveryControls(
  client: PoolClient,
  raw: unknown,
  signature: string,
  key: Buffer,
  snapshotHash: string,
) {
  const controls = controlsSchema.parse(raw);
  const expected = Buffer.from(signRecoveryControls(controls, key), "hex"),
    supplied = Buffer.from(signature, "hex");
  if (
    key.length < 32 ||
    supplied.length !== expected.length ||
    !timingSafeEqual(expected, supplied) ||
    controls.snapshotHash !== snapshotHash
  )
    throw Error("RECOVERY_CONTROL_BINDING_FAILED");
  if (controls.entries.some((e) => Date.parse(e.recordedAt) < Date.parse(controls.cutoff)))
    throw Error("INVALID_RECOVERY_CONTROL_PERIOD");
  await assertIsolatedRecoveryTarget(client);
  const connection = new URL(process.env.DATABASE_URL ?? "");
  const directory = (
    await client.query(
      "SELECT current_setting('data_directory') AS directory,current_setting('port') AS port",
    )
  ).rows[0];
  if (
    !process.env.VALO_RECOVERY_WINDOWS_ROOT &&
    (connection.protocol !== "postgresql:" ||
      connection.hostname !== "localhost" ||
      connection.pathname !== "/valo_restore_target" ||
      connection.port !== directory.port ||
      connection.searchParams.get("host") !== directory.directory.replace(/\/data$/, ""))
  )
    throw Error("RECOVERY_RUNTIME_DATABASE_BINDING_REQUIRED");
  {
    // Only the guarded child has an explicit local DATABASE_URL. Bind the
    // existing key service to this exact client/transaction, never its default
    // database handle or the independent recovery-journal signing key.
    const [
      { drizzle },
      { privacySigner },
      { schema },
      { recoveryErasureReceiptSchema, importRecoveryErasureReceipt },
    ] = await Promise.all([
      import("drizzle-orm/node-postgres"),
      import("./valo-privacy-keys"),
      import("@workspace/db"),
      import("./valo-recovery-erasure"),
    ]);
    const receipts = (controls.erasureReceipts ?? []).map((r) => recoveryErasureReceiptSchema.parse(r));
    if (
      new Set(receipts.map((r) => r.caseId)).size !== receipts.length ||
      receipts.some(
        (r) =>
          !controls.entries.some(
            (e) => e.kind === "deletion" && e.id === r.caseId && e.workspaceId === r.workspaceId,
          ),
      )
    )
      throw Error("RECOVERY_RECEIPT_ENTRY_BINDING_FAILED");
    return drizzle(client, { schema }).transaction(async (tx) => {
      const signer = await privacySigner(tx);
      let completedReceipts = 0;
      for (const e of controls.entries) {
        const { rows } = await client.query(
          "SELECT owner_identity_id FROM valo_workspaces WHERE id=$1 AND owner_identity_id LIKE 'synthetic-recovery-%'",
          [e.workspaceId],
        );
        if (rows.length !== 1 || (e.kind === "deletion" && rows[0].owner_identity_id !== e.identityId))
          throw Error("OWNED_SYNTHETIC_WORKSPACE_REQUIRED");
        const receipt = receipts.find((r) => r.caseId === e.id);
        if (receipt) {
          await importRecoveryErasureReceipt(client, tx, receipt, e.identityId);
          completedReceipts++;
        }
        await client.query(
          "UPDATE valo_memberships SET active='no' WHERE workspace_id=$1 AND ($2='deletion' OR identity_id=$3)",
          [e.workspaceId, e.kind, e.identityId],
        );
        await client.query(
          "UPDATE valo_export_jobs SET status='failed',error_code='RESTORE_ACCESS_QUARANTINED' WHERE workspace_id=$1",
          [e.workspaceId],
        );
        if (e.kind === "deletion")
          await client.query(
            `INSERT INTO valo_privacy_tombstones
        (id,workspace_id,case_id,identity_hash,key_version,phase) VALUES($1,$2,$3,$4,$5,'restore_access_quarantined_purge_pending')
        ON CONFLICT(case_id) DO NOTHING`,
            [
              randomUUID(),
              e.workspaceId,
              e.id,
              quotaSubjectHash(signer.key, "user", e.identityId),
              signer.version,
            ],
          );
      }
      return {
        entries: controls.entries.length,
        accessQuarantined: true,
        completedReceiptsImported: completedReceipts,
        physicalErasureComplete: false,
        externalEffectsEnabled: false,
      };
    });
  }
}
