// Offline synthetic recovery only. Never opens application access or deletes files.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { realpath, lstat, readFile, writeFile } from "node:fs/promises";
import { resolve, join, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { privacyTable, verifyJournal } from "./recovery_contract.mjs";
import { captureExportRetention, planExportRetention } from "./export_retention_contract.mjs";

async function targetLocation(env) {
  assert.ok(
    env.NODE_ENV === "development" &&
      env.VALO_RETENTION_RECOVERY === "synthetic-local-only" &&
      env.VALO_ISOLATED_RECOVERY === "synthetic-local-only" &&
      !Object.entries(env).some(([k, v]) => k.startsWith("REPLIT_DEPLOYMENT") && v),
    "SYNTHETIC_RETENTION_RECOVERY_REQUIRED",
  );
  const root = env.VALO_RETENTION_RECOVERY_ROOT ?? "",
    url = new URL(env.DATABASE_URL ?? "");
  assert.ok(
    /^valo-retention-recovery-[a-f0-9-]{36}$/.test(basename(root)) &&
      resolve(root) === root &&
      (await realpath(root)) === root &&
      !(await lstat(root)).isSymbolicLink() &&
      url.protocol === "postgresql:" &&
      url.hostname === "127.0.0.1" &&
      url.username === "valo_retention_test" &&
      url.pathname === "/valo_retention_restore" &&
      url.search === "",
    "DISPOSABLE_RETENTION_TARGET_REQUIRED",
  );
  const permissions = await lstat(root);
  assert.ok(
    process.platform === "win32" ||
      (permissions.uid === process.getuid() && (permissions.mode & 0o077) === 0),
    "PRIVATE_RECOVERY_ROOT_REQUIRED",
  );
  return { root, url };
}
export async function assertRetentionRestoreTarget(client, env = process.env) {
  const { root, url } = await targetLocation(env);
  const r = (
    await client.query(`SELECT current_database() AS name,current_user AS actor,current_setting('data_directory') AS directory,
  current_setting('port') AS port,host(inet_server_addr()) AS address`)
  ).rows[0];
  const data = join(root, "data");
  assert.ok(
    (await realpath(data)) === data &&
      !(await lstat(data)).isSymbolicLink() &&
      resolve(r.directory) === data &&
      r.name === "valo_retention_restore" &&
      r.actor === "valo_retention_test" &&
      r.address === "127.0.0.1" &&
      r.port === url.port,
    "DISPOSABLE_RETENTION_TARGET_REQUIRED",
  );
  const owners = await client.query(
    "SELECT 1 FROM valo_workspaces WHERE owner_identity_id NOT LIKE 'synthetic-retention-recovery-%' LIMIT 1",
  );
  assert.equal(owners.rowCount, 0, "SYNTHETIC_RETENTION_WORKSPACES_REQUIRED");
}

/** All current privacy rows must already match the authenticated journal. A
 * changed hold/revocation/erasure blocks the entire transaction until the separate
 * privacy recovery workflow has reconciled it. Raw status never grants release. */
export async function replayExportRetention(
  client,
  envelope,
  key,
  binding,
  { commit = false, env = process.env } = {},
) {
  assert.ok(
    /^[a-f0-9]{64}$/.test(binding.sourceIdentitySha256) && /^[a-f0-9-]{36}$/.test(binding.databaseId),
    "RETENTION_RECOVERY_BINDING_REQUIRED",
  );
  const current = verifyJournal(envelope, key, {
    sourceIdentitySha256: binding.sourceIdentitySha256,
    snapshotCutoff: binding.snapshotCutoff,
    requireExportRetention: true,
  });
  assert.equal(current.exportRetention.databaseId, binding.databaseId, "RETENTION_DATABASE_MISMATCH");
  await assertRetentionRestoreTarget(client, env);
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL timezone='UTC'");
    await client.query("SET LOCAL lock_timeout='3s'");
    await client.query("SET LOCAL statement_timeout='10s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('valo:offline-retention-replay',0))");
    const names = (
      await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")
    ).rows
      .map((r) => r.tablename)
      .filter(privacyTable);
    assert.deepEqual(
      names,
      Object.keys(current.controls).sort(),
      "COMPLETE_CURRENT_PRIVACY_JOURNAL_REQUIRED",
    );
    assert.ok(
      names.every((n) => /^[a-z_]+$/.test(n)),
      "RECOVERY_TABLE_INVALID",
    );
    await client.query(`LOCK TABLE ${names.join(",")},valo_workspaces IN SHARE MODE`);
    await client.query(
      "LOCK TABLE valo_file_assets,valo_export_jobs,valo_export_objects IN SHARE ROW EXCLUSIVE MODE",
    );
    await assertRetentionRestoreTarget(client, env);
    for (const name of names) {
      const fingerprint = (
        await client.query(
          `SELECT count(*)::text AS count,md5(COALESCE(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS digest FROM ${name} t`,
        )
      ).rows[0];
      assert.deepEqual(fingerprint, current.fingerprints[name], "CURRENT_PRIVACY_REPLAY_REQUIRED");
    }
    const restored = await captureExportRetention(client);
    assert.equal(restored.databaseId, binding.databaseId, "RETENTION_DATABASE_MISMATCH");
    assert.ok(
      restored.entries.every((r) => Date.parse(r.createdAt) <= Date.parse(current.cutoff)),
      "RESTORED_GENERATION_NEWER_THAN_JOURNAL",
    );
    const decisions = planExportRetention(restored, current.exportRetention),
      journalHash = createHash("sha256").update(envelope.payload).digest("hex");
    let deadlines = 0,
      quarantined = 0,
      audits = 0;
    for (const decision of decisions) {
      const before = restored.entries.find((r) => r.assetId === decision.assetId);
      let changed = false;
      if (decision.kind === "deadline" && decision.retentionAt !== before.retentionAt) {
        const result = await client.query(
          "UPDATE valo_file_assets SET retention_at=$2::timestamptz WHERE id=$1 AND retention_at IS NOT DISTINCT FROM $3::timestamptz",
          [decision.assetId, decision.retentionAt, before.retentionAt],
        );
        assert.equal(result.rowCount, 1, "RETENTION_REPLAY_WRITE_CONFLICT");
        deadlines++;
        changed = true;
      } else if (decision.kind === "quarantine") {
        // Keep bytes, cleanup reservations and saved revisions. No new deletion intent.
        const result = await client.query(
          `UPDATE valo_export_jobs SET status='failed',error_code='RESTORE_RETENTION_QUARANTINED'
     WHERE id=$1 AND workspace_id=$2 AND status='ready'`,
          [decision.jobId, decision.workspaceId],
        );
        quarantined += result.rowCount;
        changed = result.rowCount > 0;
      }
      if (changed) {
        await client.query(
          `INSERT INTO valo_events(id,workspace_id,actor_id,action,entity_id)
      VALUES($1,$2,$3,$4,$5)`,
          [
            randomUUID(),
            decision.workspaceId,
            "service:retention-recovery:" + journalHash,
            decision.kind === "deadline" ? "export.retention_restored" : "export.recovery_quarantined",
            decision.jobId,
          ],
        );
        audits++;
      }
    }
    // Recheck clock freshness after locks and database work; never commit a journal
    // that aged out while waiting. The query timeout also bounds each operation.
    verifyJournal(envelope, key, {
      sourceIdentitySha256: binding.sourceIdentitySha256,
      snapshotCutoff: binding.snapshotCutoff,
      requireExportRetention: true,
    });
    await client.query(commit ? "COMMIT" : "ROLLBACK");
    return {
      status: commit ? "applied" : "rehearsed_rolled_back",
      checked: decisions.length,
      deadlinesUpdated: commit ? deadlines : 0,
      jobsQuarantined: commit ? quarantined : 0,
      auditInserted: commit ? audits : 0,
      plannedDeadlines: deadlines,
      plannedQuarantines: quarantined,
      journalHash,
      storageWrites: 0,
      privacyWrites: 0,
      financialWrites: 0,
      applicationAccessEnabled: false,
      cleanupAuthorized: false,
      productionCreated: false,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function main() {
  let client;
  try {
    const [mode, journalPath, keyPath, bindingPath, reportPath] = process.argv.slice(2);
    assert.ok(
      ["rehearse", "apply"].includes(mode) &&
        process.argv.length === 7 &&
        process.env.VALO_RETENTION_RECOVERY === "synthetic-local-only",
      "RETENTION_RESTORE_USAGE_REQUIRED",
    );
    const root = resolve(process.env.VALO_RETENTION_RECOVERY_ROOT ?? "");
    const privateFile = async (path) => {
      assert.ok(
        path &&
          resolve(path) === path &&
          path.startsWith(root + requireSeparator()) &&
          (await realpath(path)) === path,
        "PRIVATE_RECOVERY_INPUT_REQUIRED",
      );
      const s = await lstat(path);
      assert.ok(
        s.isFile() &&
          !s.isSymbolicLink() &&
          s.size <= 20_000_000 &&
          (process.platform === "win32" || (s.mode & 0o077) === 0),
        "PRIVATE_RECOVERY_INPUT_REQUIRED",
      );
      return readFile(path, "utf8");
    };
    assert.ok(
      reportPath &&
        resolve(reportPath) === reportPath &&
        dirname(reportPath) === root &&
        !(await lstat(reportPath).catch(() => null)),
      "NEW_RECOVERY_REPORT_REQUIRED",
    );
    const envelope = JSON.parse(await privateFile(journalPath)),
      key = (await privateFile(keyPath)).trim(),
      binding = JSON.parse(await privateFile(bindingPath));
    await targetLocation(process.env);
    const require = createRequire(new URL("../../artifacts/api-server/package.json", import.meta.url)),
      { Client } = require("pg");
    client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
    await client.connect();
    const report = await replayExportRetention(client, envelope, key, binding, { commit: mode === "apply" });
    await writeFile(reportPath, JSON.stringify(report, null, 2), { mode: 0o600, flag: "wx" });
    console.log(JSON.stringify(report));
  } catch {
    console.error("RETENTION_RESTORE_FAILED");
    process.exitCode = 1;
  } finally {
    await client?.end();
  }
}
function requireSeparator() {
  return process.platform === "win32" ? "\\" : "/";
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
