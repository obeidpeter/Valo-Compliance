import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { captureExportRetention } from "./export_retention_contract.mjs";
import { signJournal, privacyTable } from "./recovery_contract.mjs";
import { replayExportRetention, assertRetentionRestoreTarget } from "./retention_restore.mjs";
const root = fileURLToPath(new URL("../../", import.meta.url)),
  require = createRequire(new URL("../../artifacts/api-server/package.json", import.meta.url));
const { Client, Pool } = require("pg"),
  { drizzle } = require("drizzle-orm/node-postgres"),
  { migrate } = require("drizzle-orm/node-postgres/migrator");
const exec = promisify(execFile),
  hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const app = (path) => pathToFileURL(join(root, "artifacts/api-server/src", path)).href;
const pgTool = (name) =>
  join(process.env.VALO_RECOVERY_PG_BIN, name + (process.platform === "win32" ? ".exe" : ""));
if (process.argv[2] === "--probe") {
  const fixtures = JSON.parse(await readFile(process.argv[3], "utf8"));
  const { listExports, downloadExport } = await import(app("modules/exports/valo-exports.ts"));
  const { getDocument } = await import(app("modules/documents/valo-documents.ts"));
  const { pool } = await import(pathToFileURL(join(root, "lib/db/src/index.ts")).href);
  try {
    for (const [i, f] of fixtures.entries()) {
      const rows = await listExports(f.actor, f.doc.id);
      assert.equal(rows.length, 1);
      if ([1, 2, 3, 5].includes(i)) {
        assert.equal(rows[0].downloadUrl, null);
        await assert.rejects(downloadExport(f.actor, f.jobId), (e) => e.status === (i === 1 ? 410 : 404));
      } else assert.ok(rows[0].downloadUrl);
      assert.equal((await getDocument(f.actor, f.doc.id)).id, f.doc.id);
    }
    console.log("RESTORED_DOWNLOAD_BOUNDARIES_PASSED");
  } finally {
    await pool.end();
  }
} else
  test("older PostgreSQL restore retains current expiry without weakening privacy or losing records", async (t) => {
    assert.equal(process.env.VALO_RUN_RETENTION_RECOVERY, "synthetic-isolated-only");
    const directory = process.env.VALO_RETENTION_RECOVERY_ROOT,
      adminUrl = new URL(process.env.DATABASE_URL);
    assert.equal(adminUrl.hostname, "127.0.0.1");
    assert.equal(adminUrl.username, "valo_retention_test");
    const url = (name) => {
      const u = new URL(adminUrl);
      u.pathname = "/" + name;
      return u.href;
    };
    const admin = new Client({ connectionString: url("postgres") });
    await admin.connect();
    await admin.query("CREATE DATABASE valo_retention_source");
    await admin.query("CREATE DATABASE valo_retention_restore");
    await admin.query("ALTER DATABASE valo_retention_restore SET timezone='Pacific/Honolulu'");
    await admin.end();
    const source = new Pool({ connectionString: url("valo_retention_source"), options: "-c timezone=UTC" });
    await migrate(drizzle(source), { migrationsFolder: join(root, "lib/db/drizzle") });
    process.env.DATABASE_URL = url("valo_retention_source");
    const { resolveWorkspace } = await import(app("modules/workspaces/valo-workspaces.ts"));
    const { createDocument } = await import(app("modules/documents/valo-documents.ts"));
    const { syntheticDocument } = await import(app("lib/valo-test-fixtures.ts"));
    const { createPrivacyCase, confirmPrivacyCase, simpleStaffPrivacyAction } = await import(
      app("modules/privacy/valo-privacy.ts")
    );
    const { pool: applicationPool } = await import(pathToFileURL(join(root, "lib/db/src/index.ts")).href);
    const fixtures = [],
      key = "synthetic-independent-retention-recovery-key-only",
      future = new Date(Date.now() + 30 * 86400000).toISOString(),
      earlier = new Date(Date.now() + 2 * 86400000).toISOString();
    const target = new Client({ connectionString: url("valo_retention_restore") });
    let connected = false;
    const targetEnv = { ...process.env, DATABASE_URL: url("valo_retention_restore") };
    const snapshots = async (client) => {
      const result = {};
      for (const { tablename } of (
        await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")
      ).rows) {
        assert.match(tablename, /^[a-z_]+$/);
        result[tablename] = (
          await client.query(
            `SELECT count(*)::text AS count,md5(COALESCE(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS digest FROM ${tablename} t`,
          )
        ).rows[0];
      }
      return result;
    };
    try {
      await mkdir(join(directory, "objects"));
      for (let i = 0; i < 6; i++) {
        const actor = await resolveWorkspace("synthetic-retention-recovery-" + randomUUID()),
          doc = await createDocument(actor, structuredClone(syntheticDocument));
        const assetId = randomUUID(),
          jobId = randomUUID(),
          queue = randomUUID(),
          objectKey = `valo/development/${actor.workspaceId}/${assetId}.docx`,
          bytes = Buffer.from("Synthetic retained file " + i);
        await source.query(
          `INSERT INTO valo_export_jobs(id,workspace_id,document_id,revision_id,revision,format,render_version,source_hash,requested_by,queue_id,status)
    VALUES($1,$2,$3,$4,1,'docx','retention-recovery-fixture',$5,$6,$7,'ready')`,
          [jobId, actor.workspaceId, doc.id, doc.revisionId, "a".repeat(64), actor.identityId, queue],
        );
        await source.query(
          `INSERT INTO valo_file_assets(id,workspace_id,job_id,object_key,checksum,mime,size,retention_at,created_at)
    VALUES($1,$2,$3,$4,$5,'application/vnd.openxmlformats-officedocument.wordprocessingml.document',$6,$7,now()-interval '2 days')`,
          [assetId, actor.workspaceId, jobId, objectKey, hash(bytes), bytes.length, i === 4 ? earlier : null],
        );
        await source.query(
          "INSERT INTO valo_export_objects(object_key,workspace_id,job_id,queue_id,state) VALUES($1,$2,$3,$4,'retained')",
          [objectKey, actor.workspaceId, jobId, queue],
        );
        await writeFile(join(directory, "objects", assetId), bytes, { mode: 0o600 });
        fixtures.push({ actor, doc, assetId, jobId, objectKey, checksum: hash(bytes) });
      }
      const staff = {
          identityId: "synthetic-retention-recovery-staff-" + randomUUID(),
          recentMfa: true,
          verifiedAt: Date.now(),
        },
        reason = "Synthetic recovery hold; no customer data.";
      await source.query(
        "INSERT INTO valo_staff_assignments(id,identity_id,role,granted_by,reason) VALUES($1,$2,'privacy','synthetic-fixture',$3)",
        [randomUUID(), staff.identityId, reason],
      );
      const request = await createPrivacyCase(fixtures[1].actor, "synthetic@example.invalid", {
          kind: "deletion",
          idempotencyKey: randomUUID(),
          message: reason,
          acknowledgement: true,
        }),
        caseId = request.reference.slice(5);
      let detail = await confirmPrivacyCase(fixtures[1].actor, caseId, {
        expectedVersion: 1,
        acknowledgement: true,
      });
      detail = await simpleStaffPrivacyAction(staff, caseId, {
        action: "claim",
        expectedVersion: detail.request.version,
        reason,
      });
      await simpleStaffPrivacyAction(staff, caseId, {
        action: "hold",
        expectedVersion: detail.request.version,
        reason,
      });
      await source.query(
        "INSERT INTO valo_payment_events(id,event_key,body_hash,event_type,status) VALUES($1,$2,$3,'synthetic.retained','processed')",
        [randomUUID(), randomUUID(), "f".repeat(64)],
      );
      const dump = join(directory, "older.dump"),
        snapshotCutoff = new Date().toISOString();
      const pgEnv = {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        PGHOST: "127.0.0.1",
        PGPORT: adminUrl.port,
        PGUSER: "valo_retention_test",
        PGDATABASE: "valo_retention_source",
      };
      await exec(pgTool("pg_dump"), ["-Fc", "--no-owner", "-f", dump], { env: pgEnv, windowsHide: true });
      await source.query("UPDATE valo_file_assets SET retention_at=$2 WHERE id=$1", [
        fixtures[0].assetId,
        future,
      ]);
      await source.query("UPDATE valo_file_assets SET retention_at=now()-interval '1 day' WHERE id=$1", [
        fixtures[1].assetId,
      ]);
      await source.query("DELETE FROM valo_file_assets WHERE id=$1", [fixtures[2].assetId]);
      await source.query("UPDATE valo_export_objects SET state='cleanup' WHERE object_key=$1", [
        fixtures[2].objectKey,
      ]);
      await source.query("UPDATE valo_file_assets SET retention_at=$2 WHERE id=$1", [
        fixtures[4].assetId,
        future,
      ]);
      const changedQueue = randomUUID();
      await source.query("UPDATE valo_export_jobs SET queue_id=$2 WHERE id=$1", [
        fixtures[5].jobId,
        changedQueue,
      ]);
      await source.query("UPDATE valo_export_objects SET queue_id=$2 WHERE object_key=$1", [
        fixtures[5].objectKey,
        changedQueue,
      ]);
      await source.query("UPDATE valo_file_assets SET retention_at=$2 WHERE id=$1", [
        fixtures[5].assetId,
        future,
      ]);
      const capture = await source.connect();
      let envelope, binding;
      try {
        await capture.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        await capture.query("SET LOCAL timezone='UTC'");
        const before = await snapshots(capture),
          controls = {},
          fingerprints = {};
        for (const name of Object.keys(before).filter(privacyTable)) {
          controls[name] = (
            await capture.query(`SELECT to_jsonb(t) AS row FROM ${name} t ORDER BY to_jsonb(t)::text`)
          ).rows.map((r) => r.row);
          fingerprints[name] = before[name];
        }
        const retention = await captureExportRetention(capture);
        assert.deepEqual(await snapshots(capture), before);
        envelope = signJournal(
          {
            version: 1,
            kind: "current-development-privacy-journal",
            sourceIdentitySha256: "a".repeat(64),
            cutoff: new Date().toISOString(),
            controls,
            fingerprints,
            exportRetention: retention,
          },
          key,
        );
        binding = { sourceIdentitySha256: "a".repeat(64), databaseId: retention.databaseId, snapshotCutoff };
      } finally {
        await capture.query("ROLLBACK");
        capture.release();
      }
      await exec(
        pgTool("pg_restore"),
        ["--exit-on-error", "--no-owner", "-d", "valo_retention_restore", dump],
        { env: pgEnv, windowsHide: true },
      );
      await target.connect();
      connected = true;
      await target.query("SET timezone='UTC'");
      const before = await snapshots(target);
      await t.test(
        "actual dump loses later deadlines before replay and keeps the old absent-generation file",
        async () => {
          assert.equal(
            (
              await target.query("SELECT retention_at FROM valo_file_assets WHERE id=$1", [
                fixtures[0].assetId,
              ])
            ).rows[0].retention_at,
            null,
          );
          assert.equal((await target.query("SELECT count(*)::int AS n FROM valo_file_assets")).rows[0].n, 6);
          assert.equal((await source.query("SELECT count(*)::int AS n FROM valo_file_assets")).rows[0].n, 5);
        },
      );
      await t.test(
        "wrong target, changed signature, legacy journal and wrong source cannot write",
        async () => {
          await assert.rejects(
            assertRetentionRestoreTarget(source, targetEnv),
            /DISPOSABLE_RETENTION_TARGET_REQUIRED/,
          );
          await assert.rejects(
            replayExportRetention(target, envelope, key + "wrong", binding, { commit: true, env: targetEnv }),
            /AUTHENTICATION/,
          );
          await assert.rejects(
            replayExportRetention(
              target,
              envelope,
              key,
              { ...binding, sourceIdentitySha256: "b".repeat(64) },
              { commit: true, env: targetEnv },
            ),
            /SOURCE_MISMATCH/,
          );
          const payload = JSON.parse(envelope.payload);
          delete payload.exportRetention;
          await assert.rejects(
            replayExportRetention(target, signJournal(payload, key), key, binding, {
              commit: true,
              env: targetEnv,
            }),
            /RETENTION_JOURNAL_REQUIRED/,
          );
          const incomplete = JSON.parse(envelope.payload);
          delete incomplete.controls.valo_staff_assignments;
          delete incomplete.fingerprints.valo_staff_assignments;
          await assert.rejects(
            replayExportRetention(target, signJournal(incomplete, key), key, binding, {
              commit: true,
              env: targetEnv,
            }),
            /COMPLETE_CURRENT_PRIVACY_JOURNAL_REQUIRED/,
          );
          assert.deepEqual(await snapshots(target), before);
        },
      );
      await t.test("new privacy state blocks the entire replay, with no partial updates", async () => {
        await target.query("UPDATE valo_privacy_cases SET status='rejected' WHERE id=$1", [caseId]);
        const changed = await snapshots(target);
        await assert.rejects(
          replayExportRetention(target, envelope, key, binding, { commit: true, env: targetEnv }),
          /CURRENT_PRIVACY_REPLAY_REQUIRED/,
        );
        assert.deepEqual(await snapshots(target), changed);
        await target.query("UPDATE valo_privacy_cases SET status='held' WHERE id=$1", [caseId]);
        assert.deepEqual(await snapshots(target), before);
      });
      await t.test("rehearsal and audit failure leave all tables unchanged", async () => {
        const result = await replayExportRetention(target, envelope, key, binding, { env: targetEnv });
        assert.equal(result.status, "rehearsed_rolled_back");
        assert.deepEqual(await snapshots(target), before);
        await target.query(
          "CREATE FUNCTION synthetic_retention_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'CONTROLLED_AUDIT_FAILURE'; END $$",
        );
        await target.query(
          "CREATE TRIGGER synthetic_retention_fail BEFORE INSERT ON valo_events FOR EACH ROW EXECUTE FUNCTION synthetic_retention_fail()",
        );
        try {
          await assert.rejects(
            replayExportRetention(target, envelope, key, binding, { commit: true, env: targetEnv }),
            /CONTROLLED_AUDIT_FAILURE/,
          );
          assert.deepEqual(await snapshots(target), before);
        } finally {
          await target.query("DROP TRIGGER synthetic_retention_fail ON valo_events");
          await target.query("DROP FUNCTION synthetic_retention_fail()");
        }
      });
      await t.test(
        "concurrent replay commits once, preserves held files and never extends an earlier deadline",
        async () => {
          // The replay writes three tables. The database keeps the digest of each history with its rows
          // (docs/architecture/audit-trail.md, slice 3), so the digests of those it writes change with
          // them, and every other digest stays as it was.
          const written = ["valo_file_assets", "valo_export_jobs", "valo_events"];
          const otherDigests = async () =>
            (
              await target.query(
                "SELECT table_name, shard, row_count::text, hash_sum::text FROM valo_history_digests WHERE table_name <> ALL($1) ORDER BY table_name, shard",
                [written],
              )
            ).rows;
          const digestsBefore = await otherDigests();
          const second = new Client({ connectionString: url("valo_retention_restore") });
          await second.connect();
          let results;
          try {
            results = await Promise.all([
              replayExportRetention(target, envelope, key, binding, { commit: true, env: targetEnv }),
              replayExportRetention(second, envelope, key, binding, { commit: true, env: targetEnv }),
            ]);
          } finally {
            await second.end();
          }
          assert.equal(
            results.reduce((n, r) => n + r.deadlinesUpdated, 0),
            2,
          );
          assert.equal(
            results.reduce((n, r) => n + r.jobsQuarantined, 0),
            3,
          );
          assert.equal(
            results.reduce((n, r) => n + r.auditInserted, 0),
            5,
          );
          assert.equal(
            (
              await target.query("SELECT retention_at FROM valo_file_assets WHERE id=$1", [
                fixtures[0].assetId,
              ])
            ).rows[0].retention_at.toISOString(),
            future,
          );
          assert.equal(
            (
              await target.query("SELECT retention_at FROM valo_file_assets WHERE id=$1", [
                fixtures[4].assetId,
              ])
            ).rows[0].retention_at.toISOString(),
            earlier,
          );
          const after = await snapshots(target);
          for (const name of Object.keys(before))
            if (![...written, "valo_history_digests"].includes(name))
              assert.deepEqual(after[name], before[name], name);
          assert.deepEqual(await otherDigests(), digestsBefore);
          // Each history's digest still matches its rows.
          assert.deepEqual((await target.query("SELECT * FROM valo_history_digest_mismatches()")).rows, []);
          for (const f of fixtures)
            assert.equal(hash(await readFile(join(directory, "objects", f.assetId))), f.checksum);
          const again = await replayExportRetention(target, envelope, key, binding, {
            commit: true,
            env: targetEnv,
          });
          assert.equal(again.auditInserted, 0);
          assert.deepEqual(await snapshots(target), after);
        },
      );
      await t.test(
        "actual application download guards reject expired and quarantined restored exports",
        async () => {
          const path = join(directory, "fixtures.json");
          await writeFile(path, JSON.stringify(fixtures), { mode: 0o600 });
          const result = await exec(
            process.execPath,
            ["--import", "tsx", fileURLToPath(import.meta.url), "--probe", path],
            { cwd: join(root, "artifacts/api-server"), env: targetEnv, windowsHide: true },
          );
          assert.match(result.stdout, /RESTORED_DOWNLOAD_BOUNDARIES_PASSED/);
        },
      );
      await t.test(
        "the shipped operator rejects remote targets and preserves exact retry behavior",
        async () => {
          const journal = join(directory, "journal.json"),
            secret = join(directory, "key"),
            bindingFile = join(directory, "binding.json");
          for (const [p, value] of [
            [journal, JSON.stringify(envelope)],
            [secret, key],
            [bindingFile, JSON.stringify(binding)],
          ])
            await writeFile(p, value, { mode: 0o600 });
          const args = [
            fileURLToPath(new URL("./retention_restore.mjs", import.meta.url)),
            "apply",
            journal,
            secret,
            bindingFile,
            join(directory, "operator.json"),
          ];
          await assert.rejects(
            exec(process.execPath, args, {
              env: {
                ...targetEnv,
                DATABASE_URL: "postgresql://valo_retention_test@remote.invalid:5432/valo_retention_restore",
              },
              windowsHide: true,
            }),
            (e) => e.stderr.trim() === "RETENTION_RESTORE_FAILED",
          );
          const result = await exec(process.execPath, args, { env: targetEnv, windowsHide: true });
          assert.equal(JSON.parse(result.stdout).auditInserted, 0);
        },
      );
    } finally {
      if (connected) await target.end();
      await source.end();
      await applicationPool.end();
    }
  });
