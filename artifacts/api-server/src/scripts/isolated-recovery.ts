/** One-shot disposable local SYNTHETIC restore exercise. Never reads/dumps the
 * managed database; never schedules backups. No provider credentials inherited. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, writeFile, rm, cp, lstat } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeSync } from "node:fs";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { Document, Paragraph, Packer } from "docx";
import { assertDevelopmentRuntime } from "../platform/valo-development-runtime";
import {
  assertIsolatedRecoveryTarget,
  loadRecoveryErasure,
  replayRecoveryControls,
  signRecoveryControls,
  type RecoveryControls,
} from "../modules/recovery";
import { logger } from "../platform/logger";
import { workspaceActorFromRecord } from "../platform/workspace-context";
const exec = promisify(execFile),
  hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const script = fileURLToPath(import.meta.url),
  root = resolve(import.meta.dirname, "../../../..");
const mode = process.argv[2];
assertDevelopmentRuntime();
if (process.env.VALO_ISOLATED_RECOVERY !== "synthetic-local-only")
  throw Error("EXPLICIT_LOCAL_RECOVERY_PROOF_REQUIRED");
type Fixture = {
  identityId: string;
  workspaceId: string;
  documentId: string;
  objectKey: string;
  checksum: string;
};
async function independentControlKey() {
  const path = process.env.VALO_RECOVERY_CONTROL_KEY_FILE;
  if (!path?.startsWith("/tmp/valo-recovery-")) throw Error("INDEPENDENT_RECOVERY_KEY_REQUIRED");
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.uid !== userInfo().uid || (info.mode & 0o077) !== 0)
    throw Error("PRIVATE_RECOVERY_KEY_CUSTODY_REQUIRED");
  const key = await readFile(path);
  if (key.length !== 32) throw Error("RECOVERY_SIGNING_KEY_LENGTH_INVALID");
  return key;
}
async function fixtureSeed() {
  const { pool } = await import("@workspace/db");
  const store = await import("../lib/valo-store");
  const { resolveWorkspace, saveProfile } = await import("../modules/workspaces");
  const { syntheticDocument, syntheticProfile } = await import("../lib/valo-test-fixtures");
  const directory = process.argv[3];
  assert.ok(directory);
  assert.ok(directory.startsWith("/tmp/valo-recovery-"));
  const fixtures: Fixture[] = [];
  try {
    const dbName = (await pool.query("SELECT current_database() AS name")).rows[0].name;
    assert.equal(dbName, "valo_restore_source");
    for (const name of ["a", "b", "c"]) {
      const identityId = `synthetic-recovery-${name}-${randomUUID()}`,
        actor = await resolveWorkspace(identityId);
      await saveProfile(actor, { expectedRevision: 0, profile: syntheticProfile });
      const document = await store.createDocument(actor, {
        ...syntheticDocument,
        title: `Synthetic recovery ${name}`,
      });
      const revision = (
        await pool.query("SELECT id,content_hash FROM valo_document_revisions WHERE document_id=$1", [
          document.id,
        ])
      ).rows[0];
      const bytes = await Packer.toBuffer(
        new Document({ sections: [{ children: [new Paragraph(document.title)] }] }),
      );
      const jobId = randomUUID(),
        queueId = randomUUID(),
        objectKey = `valo/development/${actor.workspaceId}/${document.id}.docx`;
      await mkdir(join(directory, actor.workspaceId), { recursive: true });
      await writeFile(join(directory, actor.workspaceId, `${document.id}.docx`), bytes, { mode: 0o600 });
      await pool.query(
        `INSERT INTO valo_export_jobs(id,workspace_id,document_id,revision_id,revision,format,render_version,source_hash,requested_by,queue_id,status)
        VALUES($1,$2,$3,$4,1,'docx','isolated-recovery-fixture-v1',$5,$6,$7,'ready')`,
        [jobId, actor.workspaceId, document.id, revision.id, revision.content_hash, identityId, queueId],
      );
      await pool.query(
        `INSERT INTO valo_jobs.job(id,name,data,start_after)
        VALUES($1,'valo-manual-export-v1',$2::jsonb,now()+interval '1 hour')`,
        [queueId, JSON.stringify({ workspaceId: actor.workspaceId, jobId })],
      );
      await pool.query(
        `INSERT INTO valo_file_assets(id,workspace_id,job_id,object_key,checksum,mime,size)
        VALUES($1,$2,$3,$4,$5,'application/vnd.openxmlformats-officedocument.wordprocessingml.document',$6)`,
        [randomUUID(), actor.workspaceId, jobId, objectKey, hash(bytes), bytes.length],
      );
      if (name === "a") {
        const { createPrivacyCase } = await import("../modules/privacy");
        await createPrivacyCase(actor, "synthetic-old-copy@example.invalid", {
          kind: "export",
          idempotencyKey: randomUUID(),
          message: "SYNTHETIC-OLDER-PRIVACY-COPY",
          acknowledgement: true,
        });
      }
      fixtures.push({
        identityId,
        workspaceId: actor.workspaceId,
        documentId: document.id,
        objectKey,
        checksum: hash(bytes),
      });
    }
    process.stdout.write(JSON.stringify(fixtures));
  } finally {
    await pool.end();
  }
}
async function captureErasure() {
  const { db, pool, valoStaffAssignments } = await import("@workspace/db");
  const { createPrivacyCase, confirmPrivacyCase, simpleStaffPrivacyAction } =
    await import("../modules/privacy");
  const { processPrivacyErasure, closePrivacyErasureLocks } = await import("../modules/privacy");
  const { captureRecoveryErasureReceipt } = await loadRecoveryErasure();
  const [fixture] = JSON.parse(await readFile(process.argv[3]!, "utf8")) as Fixture[];
  assert.ok(fixture);
  const objects = process.argv[4];
  assert.ok(objects);
  assert.ok(objects.startsWith("/tmp/valo-recovery-"));
  const actor = workspaceActorFromRecord({
    workspaceId: fixture.workspaceId,
    identityId: fixture.identityId,
  });
  const staff = {
    identityId: `synthetic-recovery-privacy-${randomUUID()}`,
    recentMfa: true,
    verifiedAt: Date.now(),
  };
  const reason = "Verified synthetic post-snapshot erasure; no external processor completion.";
  try {
    assert.equal((await pool.query("SELECT current_database() AS name")).rows[0].name, "valo_restore_source");
    await db.insert(valoStaffAssignments).values({
      id: randomUUID(),
      identityId: staff.identityId,
      role: "privacy",
      grantedBy: "synthetic-isolated-fixture",
      reason,
    });
    const request = await createPrivacyCase(actor, "synthetic-recovery@example.invalid", {
      kind: "deletion",
      idempotencyKey: randomUUID(),
      message: reason,
      acknowledgement: true,
    });
    const id = request.reference.slice(5);
    let detail = await confirmPrivacyCase(actor, id, { expectedVersion: 1, acknowledgement: true });
    detail = await simpleStaffPrivacyAction(staff, id, {
      action: "claim",
      expectedVersion: detail.request.version,
      reason,
    });
    const remove = async (key: string) => {
      const { assertErasureObjectScope } = await import("../modules/privacy");
      assertErasureObjectScope(fixture.workspaceId, key);
      await rm(join(objects, ...key.split("/").slice(2)), { force: true });
    };
    let phase = "not_started";
    for (let n = 0; n < 80 && phase !== "application_erased"; n++) {
      detail = await processPrivacyErasure(
        { ...staff, verifiedAt: Date.now() },
        id,
        {
          action: n === 0 ? "start_erasure" : "resume_erasure",
          expectedVersion: detail.request.version,
          reason,
          acknowledgement: true,
        },
        remove,
      );
      phase = (await pool.query("SELECT erasure_phase FROM valo_privacy_cases WHERE id=$1", [id])).rows[0]
        .erasure_phase;
    }
    assert.equal(phase, "application_erased");
    const client = await pool.connect();
    try {
      process.stdout.write(
        JSON.stringify(await captureRecoveryErasureReceipt(client, id, fixture.workspaceId)),
      );
    } finally {
      client.release();
    }
  } finally {
    await closePrivacyErasureLocks();
    await pool.end();
  }
}
async function purgeRestored() {
  assertFixtureTargetEnvironment();
  const { pool } = await import("@workspace/db");
  const { replayErasedApplication, closePrivacyErasureLocks } = await import("../modules/privacy");
  const { assertErasureObjectScope } = await import("../modules/privacy");
  const saved = JSON.parse(await readFile(process.argv[3]!, "utf8")) as {
    controls: RecoveryControls;
    signature: string;
    snapshotHash: string;
  };
  const directory = process.argv[4],
    behavior = process.argv[5];
  assert.ok(directory);
  assert.ok(directory.startsWith("/tmp/valo-recovery-"));
  const client = await pool.connect();
  try {
    await replayRecoveryControls(
      client,
      saved.controls,
      saved.signature,
      await independentControlKey(),
      saved.snapshotHash,
    );
    let remaining = false,
      failed = 0,
      batches = 0;
    for (const entry of saved.controls.entries.filter((e) => e.kind === "deletion")) {
      let entryRemaining = false;
      for (let n = 0; n < (behavior === "complete" ? 100 : 1); n++) {
        const result = await replayErasedApplication(entry.id, async (key) => {
          assertErasureObjectScope(entry.workspaceId, key);
          if (behavior === "fail-object") throw Error("CONTROLLED_STORAGE_FAILURE");
          await rm(join(directory, ...key.split("/").slice(2)), { force: true });
          if (behavior === "crash-after-object") {
            writeSync(2, "RECOVERY_CRASH_AFTER_OBJECT\n");
            process.kill(process.pid, "SIGKILL");
          }
        });
        batches++;
        failed += result.failed;
        entryRemaining = result.remaining;
        if (!entryRemaining || behavior !== "complete") break;
      }
      remaining = remaining || entryRemaining;
    }
    process.stdout.write(
      JSON.stringify({
        batches,
        remaining,
        failed,
        physicalApplicationReplayComplete: !remaining,
        externalSystemsFulfilled: false,
      }),
    );
  } finally {
    client.release();
    await closePrivacyErasureLocks();
    await pool.end();
  }
}
function assertFixtureTargetEnvironment() {
  const target = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(target.protocol, "postgresql:");
  assert.equal(target.hostname, "localhost");
  assert.equal(target.port, "58463");
  assert.equal(target.pathname, "/valo_restore_target");
  assert.ok(process.env.PGHOST?.startsWith("/tmp/valo-recovery-"));
  assert.equal(target.searchParams.get("host"), process.env.PGHOST);
}
async function fixtureReplay() {
  assertFixtureTargetEnvironment();
  const { pool } = await import("@workspace/db");
  const path = process.argv[3];
  assert.ok(path);
  assert.ok(path.startsWith("/tmp/valo-recovery-"));
  const saved = JSON.parse(await readFile(path, "utf8")) as {
    controls: RecoveryControls;
    signature: string;
    snapshotHash: string;
  };
  const key = await independentControlKey();
  const client = await pool.connect();
  try {
    await assertIsolatedRecoveryTarget(client);
    await replayRecoveryControls(client, saved.controls, saved.signature, key, saved.snapshotHash);
    await replayRecoveryControls(client, saved.controls, saved.signature, key, saved.snapshotHash);
    process.stdout.write(JSON.stringify({ replayed: true }));
  } finally {
    client.release();
    await pool.end();
  }
}
async function verifyAccess() {
  assertFixtureTargetEnvironment();
  const { db, pool } = await import("@workspace/db"),
    store = await import("../lib/valo-store"),
    { resolveWorkspace } = await import("../modules/workspaces");
  const { privacyKeys, privacyKey } = await import("../lib/valo-privacy-keys");
  const { quotaSubjectHash } = await import("../lib/valo-quota-policy");
  const fixtures = JSON.parse(await readFile(process.argv[3]!, "utf8")) as Fixture[];
  try {
    const client = await pool.connect();
    try {
      await assertIsolatedRecoveryTarget(client);
    } finally {
      client.release();
    }
    const ring = privacyKeys(),
      key = await db.transaction((tx) => privacyKey(tx, ring.current, ring));
    const tombstones = (
      await pool.query(
        "SELECT identity_hash,key_version FROM valo_privacy_tombstones WHERE workspace_id=$1",
        [fixtures[0]!.workspaceId],
      )
    ).rows;
    assert.equal(tombstones.length, 1);
    assert.equal(tombstones[0].key_version, ring.current);
    assert.equal(tombstones[0].identity_hash, quotaSubjectHash(key, "user", fixtures[0]!.identityId));
    const before = (
      await pool.query(
        "SELECT (SELECT count(*) FROM valo_workspaces) AS workspaces,(SELECT count(*) FROM valo_memberships) AS memberships,(SELECT count(*) FROM valo_privacy_key_versions) AS key_versions",
      )
    ).rows;
    // A missing historical key (503) is not a successful authorization denial.
    await assert.rejects(() => resolveWorkspace(fixtures[0]!.identityId), {
      status: 403,
      message: "Identity deletion is recorded. Access cannot be recreated.",
    });
    await assert.rejects(() => resolveWorkspace(fixtures[1]!.identityId), {
      status: 403,
      message: "Workspace membership is suspended",
    });
    const c = await resolveWorkspace(fixtures[2]!.identityId);
    assert.equal((await store.getDocument(c, fixtures[2]!.documentId)).id, fixtures[2]!.documentId);
    await assert.rejects(() => store.getDocument(c, fixtures[0]!.documentId), {
      status: 404,
      message: "Document not found",
    });
    const after = (
      await pool.query(
        "SELECT (SELECT count(*) FROM valo_workspaces) AS workspaces,(SELECT count(*) FROM valo_memberships) AS memberships,(SELECT count(*) FROM valo_privacy_key_versions) AS key_versions",
      )
    ).rows;
    assert.deepEqual(after, before);
    process.stdout.write(
      JSON.stringify({
        authorisationChecksCreatedNoRows: true,
        versionedIdentityBinding: true,
        revokedIdentitiesDenied: 2,
        activeDocumentRecovered: 1,
        crossTenantDenied: 1,
      }),
    );
  } finally {
    await pool.end();
  }
}
async function drill() {
  const started = performance.now(),
    directory = await mkdtemp(join(tmpdir(), "valo-recovery-"));
  const data = join(directory, "data"),
    sourceObjects = join(directory, "source-objects"),
    restoredObjects = join(directory, "restored-objects"),
    snapshotObjects = join(directory, "snapshot-objects");
  const user = userInfo().username;
  assert.match(user, /^[a-z_][a-z0-9_-]*$/);
  // Explicit allowlist, not {...process.env}: no managed DB/PSP/email/model keys.
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: directory,
    NODE_ENV: "development",
    PGHOST: directory,
    PGPORT: "58463",
    PGUSER: user,
    PGDATABASE: "postgres",
    VALO_ISOLATED_RECOVERY: "synthetic-local-only",
    SESSION_SECRET: randomBytes(32).toString("hex"),
  };
  const url = (name: string) =>
    `postgresql://${user}@localhost:58463/${name}?host=${encodeURIComponent(directory)}`;
  const options = { env, cwd: root, maxBuffer: 2_000_000 };
  let running = false;
  let source: Pool | undefined, target: Pool | undefined;
  const report: Record<string, unknown> = {
    startedAt: new Date().toISOString(),
    scope: "disposable local synthetic PostgreSQL and local fixture objects",
    managedDatabaseRead: false,
    productionRestoreProved: false,
    appStorageRestoreProved: false,
    externalCredentialsInherited: false,
    externalMessagesSent: 0,
    charges: 0,
    refunds: 0,
    deletionScope:
      "Completed independently retained synthetic erasure receipt, physical application replay and local object cleanup; external providers excluded",
    retention35Days: "unresolved",
    checks: {},
  };
  try {
    report.phase = "initialise_local_cluster";
    await exec("initdb", ["-D", data, "--auth=trust", "--no-locale"], options);
    await exec(
      "pg_ctl",
      [
        "-D",
        data,
        "-l",
        join(directory, "postgres.log"),
        "-o",
        `-k ${directory} -h '' -p 58463`,
        "-w",
        "start",
      ],
      options,
    );
    running = true;
    const admin = new Pool({ host: directory, port: 58463, user, database: "postgres" });
    try {
      await admin.query("CREATE DATABASE valo_restore_source");
      await admin.query("CREATE DATABASE valo_restore_target");
      await admin.query("ALTER DATABASE valo_restore_target SET timezone='Pacific/Honolulu'");
    } finally {
      await admin.end();
    }
    env.DATABASE_URL = url("valo_restore_source");
    report.phase = "apply_journalled_migrations";
    await exec(
      "pnpm",
      ["--filter", "@workspace/db", "exec", "drizzle-kit", "migrate", "--config", "./drizzle.config.ts"],
      options,
    );
    await exec(
      "pnpm",
      [
        "--filter",
        "@workspace/api-server",
        "exec",
        "tsx",
        "src/scripts/queue-migration.ts",
        "apply-development",
      ],
      { ...options, env: { ...env, VALO_DEV_QUEUE_MIGRATION: "reviewed-synthetic-development" } },
    );
    report.phase = "seed_local_fixtures";
    const seeded = await exec(
      "pnpm",
      ["--filter", "@workspace/api-server", "exec", "tsx", script, "--fixture-seed", sourceObjects],
      options,
    );
    const fixtures = JSON.parse(seeded.stdout) as Fixture[];
    await writeFile(join(directory, "fixtures.json"), JSON.stringify(fixtures), { mode: 0o600 });
    source = new Pool({ host: directory, port: 58463, user, database: "valo_restore_source" });
    const snapshot = await source.connect();
    const dump = join(directory, "synthetic.dump");
    try {
      report.phase = "export_isolated_snapshot";
      await snapshot.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const boundary = (
        await snapshot.query(
          "SELECT pg_export_snapshot() AS id,clock_timestamp() AS cutoff,pg_current_wal_lsn() AS lsn",
        )
      ).rows[0];
      report.cutoffAt = new Date(boundary.cutoff).toISOString();
      report.localWalCutoff = boundary.lsn;
      const dumpStart = performance.now();
      await exec("pg_dump", ["-Fc", "--snapshot", boundary.id, "-f", dump, "valo_restore_source"], options);
      report.dumpElapsedMs = Math.round(performance.now() - dumpStart);
    } finally {
      await snapshot.query("ROLLBACK");
      snapshot.release();
    }
    const snapshotHash = hash(await readFile(dump));
    report.snapshotHash = snapshotHash;
    await cp(sourceObjects, snapshotObjects, { recursive: true });
    report.phase = "verified_source_erasure_after_cutoff";
    const captured = await exec(
      "pnpm",
      [
        "--filter",
        "@workspace/api-server",
        "exec",
        "tsx",
        script,
        "--capture-erasure",
        join(directory, "fixtures.json"),
        sourceObjects,
      ],
      options,
    );
    const receipt = JSON.parse(captured.stdout) as {
      caseId: string;
      workspaceId: string;
      records: Record<string, Record<string, unknown>[]>;
    };
    // Control journal is retained OUTSIDE the dump. A stale restored DB cannot supply it.
    const controls: RecoveryControls = {
      snapshotHash,
      cutoff: String(report.cutoffAt),
      entries: fixtures.slice(0, 2).map((f, i) => ({
        id: i === 0 ? receipt.caseId : randomUUID(),
        workspaceId: f.workspaceId,
        identityId: f.identityId,
        kind: i === 0 ? "deletion" : "revocation",
        recordedAt: new Date().toISOString(),
      })),
      erasureReceipts: [receipt],
    };
    const key = randomBytes(32),
      signature = signRecoveryControls(controls, key);
    await source.query("UPDATE valo_memberships SET active='no' WHERE workspace_id=ANY($1::uuid[])", [
      fixtures.slice(0, 2).map((f) => f.workspaceId),
    ]);
    await source.query(
      "INSERT INTO valo_events(id,workspace_id,actor_id,action,entity_id) VALUES($1,$2,'synthetic-recovery','recovery.post_cutoff',$3)",
      [randomUUID(), fixtures[2]!.workspaceId, randomUUID()],
    );
    if (mode === "--prepare-separate-host") {
      const handoff = process.env.VALO_RECOVERY_HANDOFF_DIR ?? "";
      assert.ok(handoff.startsWith("/tmp/valo-recovery-handoff-") && resolve(handoff) === handoff);
      await mkdir(handoff, { mode: 0o700 });
      await cp(dump, join(handoff, "synthetic.dump"));
      await cp(snapshotObjects, join(handoff, "objects"), { recursive: true });
      await writeFile(join(handoff, "fixtures.json"), JSON.stringify(fixtures), { mode: 0o600 });
      await writeFile(join(handoff, "controls.json"), JSON.stringify({ controls, signature, snapshotHash }), {
        mode: 0o600,
      });
      await writeFile(
        join(handoff, "synthetic-keys.json"),
        JSON.stringify({
          SESSION_SECRET: env.SESSION_SECRET,
          controlKey: key.toString("hex"),
          syntheticOnly: true,
        }),
        { mode: 0o600 },
      );
      report.separateHostPackagePrepared = true;
      report.sourceErasureCompletedAfterSnapshot = true;
      report.passed = true;
      return;
    }
    const restoreStart = performance.now();
    report.restoreStartedAt = new Date().toISOString();
    report.phase = "restore_disposable_target";
    await exec("pg_restore", ["--exit-on-error", "--no-owner", "-d", "valo_restore_target", dump], options);
    await cp(snapshotObjects, restoredObjects, { recursive: true });
    target = new Pool({ host: directory, port: 58463, user, database: "valo_restore_target" });
    const check = report.checks as Record<string, unknown>;
    assert.equal(
      Number(
        (await target.query("SELECT count(*) FROM valo_events WHERE action='recovery.post_cutoff'")).rows[0]
          .count,
      ),
      0,
    );
    assert.equal(
      Number(
        (await source.query("SELECT count(*) FROM valo_events WHERE action='recovery.post_cutoff'")).rows[0]
          .count,
      ),
      1,
    );
    check.exactSnapshotCutoff = true;
    const client = await target.connect();
    try {
      report.phase = "replay_and_validate";
      const sourceClient = await source.connect();
      try {
        await assert.rejects(
          () => assertIsolatedRecoveryTarget(sourceClient),
          /LOCAL_DISPOSABLE_RECOVERY_TARGET_REQUIRED/,
        );
      } finally {
        sourceClient.release();
      }
      check.sourceDatabaseRejectedAsReplayTarget = true;
      const keyRowsBefore = Number(
        (await client.query("SELECT count(*) FROM valo_privacy_key_versions")).rows[0].count,
      );
      const originalPrivacyEvent = (
        await client.query(
          "SELECT id,reason FROM valo_privacy_events WHERE workspace_id=$1 ORDER BY sequence LIMIT 1",
          [fixtures[0]!.workspaceId],
        )
      ).rows[0];
      assert.ok(
        originalPrivacyEvent &&
          originalPrivacyEvent.reason !== "[Private content removed by verified workspace erasure]",
      );
      await assert.rejects(
        () =>
          replayRecoveryControls(
            client,
            { ...controls, snapshotHash: "0".repeat(64) },
            signature,
            key,
            snapshotHash,
          ),
        /BINDING/,
      );
      assert.equal(
        Number((await client.query("SELECT count(*) FROM valo_privacy_tombstones")).rows[0].count),
        0,
      );
      assert.equal(
        Number((await client.query("SELECT count(*) FROM valo_privacy_key_versions")).rows[0].count),
        keyRowsBefore,
      );
      assert.equal(
        Number(
          (await client.query("SELECT count(*) FROM valo_memberships WHERE active='yes'")).rows[0].count,
        ),
        3,
      );
      check.alteredJournalRejected = true;
      check.alteredJournalRejectedWithoutEffects = true;
      // The parent never imports the DB-backed signer. Only this allowlisted
      // child receives the explicit disposable target URL and same fresh key.
      const controlsPath = join(directory, "controls.json");
      env.VALO_RECOVERY_CONTROL_KEY_FILE = join(directory, "independent-control-signing.key");
      await writeFile(env.VALO_RECOVERY_CONTROL_KEY_FILE, key, { mode: 0o600 });
      await writeFile(controlsPath, JSON.stringify({ controls, signature, snapshotHash }), { mode: 0o600 });
      const changed = structuredClone(controls);
      const changedReceipt = changed.erasureReceipts![0] as typeof receipt;
      (changedReceipt.records.valo_privacy_tombstones![0]!.erasure_seal as { mac: string }).mac = "0".repeat(
        64,
      );
      const changedPath = join(directory, "changed-receipt.json");
      await writeFile(
        changedPath,
        JSON.stringify({ controls: changed, signature: signRecoveryControls(changed, key), snapshotHash }),
        { mode: 0o600 },
      );
      report.phase = "reject_changed_completed_receipt";
      await assert.rejects(
        () =>
          exec(
            "pnpm",
            ["--filter", "@workspace/api-server", "exec", "tsx", script, "--replay-controls", changedPath],
            { ...options, env: { ...env, DATABASE_URL: url("valo_restore_target") } },
          ),
        (error) => {
          const diagnostic = /RECOVERY_CHILD_FAILURE:(\{[^\n]+\})/.exec(
            String((error as { stderr?: unknown }).stderr ?? ""),
          )?.[1];
          const parsed = diagnostic ? JSON.parse(diagnostic) : {};
          check.changedReceiptRejection = parsed;
          return parsed.code === "ERASURE_SEAL_INVALID";
        },
      );
      assert.equal(
        Number((await client.query("SELECT count(*) FROM valo_privacy_tombstones")).rows[0].count),
        0,
      );
      assert.equal(Number((await client.query("SELECT count(*) FROM valo_privacy_cases")).rows[0].count), 1);
      assert.equal(
        (await client.query("SELECT reason FROM valo_privacy_events WHERE id=$1", [originalPrivacyEvent.id]))
          .rows[0].reason,
        originalPrivacyEvent.reason,
      );
      check.changedReceiptRejectedWithWholeImportRolledBack = true;
      report.phase = "replay_and_validate";
      await exec(
        "pnpm",
        ["--filter", "@workspace/api-server", "exec", "tsx", script, "--replay-controls", controlsPath],
        { ...options, env: { ...env, DATABASE_URL: url("valo_restore_target") } },
      );
      assert.equal(
        Number((await client.query("SELECT count(*) FROM valo_privacy_tombstones")).rows[0].count),
        1,
      );
      assert.equal(
        (await client.query("SELECT reason FROM valo_privacy_events WHERE id=$1", [originalPrivacyEvent.id]))
          .rows[0].reason,
        "[Private content removed by verified workspace erasure]",
      );
      check.originalPreCutoffAuditRedactedWithAuthenticWitness = true;
      check.idempotentDeletionTombstoneAndRevocationReplay = true;
      assert.equal(
        (
          await client.query(
            "SELECT has_table_privilege('valo_content_publisher_dev','valo_document_revisions','SELECT') AS allowed",
          )
        ).rows[0].allowed,
        false,
      );
      check.publisherCannotReadPrivateRevisions = true;
      const rows = (
        await client.query(`SELECT a.object_key,a.checksum,a.workspace_id,j.workspace_id AS job_workspace,
        j.source_hash,r.content_hash FROM valo_file_assets a JOIN valo_export_jobs j ON j.id=a.job_id
        JOIN valo_document_revisions r ON r.id=j.revision_id AND r.workspace_id=j.workspace_id`)
      ).rows;
      for (const row of rows) {
        assert.equal(row.source_hash, row.content_hash);
        assert.equal(row.workspace_id, row.job_workspace);
        assert.ok(row.object_key.startsWith(`valo/development/${row.workspace_id}/`));
        const bytes = await readFile(join(restoredObjects, ...row.object_key.split("/").slice(2)));
        assert.equal(hash(bytes), row.checksum);
      }
      check.tenantObjectChecksums = rows.length;
      const object = join(restoredObjects, fixtures[2]!.workspaceId, `${fixtures[2]!.documentId}.docx`),
        bytes = await readFile(object);
      await writeFile(object, "SYNTHETIC_TAMPER");
      assert.notEqual(hash(await readFile(object)), fixtures[2]!.checksum);
      await writeFile(object, bytes);
      check.tamperedObjectDetected = true;
      const deletedObject = join(
        restoredObjects,
        fixtures[0]!.workspaceId,
        `${fixtures[0]!.documentId}.docx`,
      );
      assert.equal(
        hash(await readFile(deletedObject)),
        fixtures[0]!.checksum,
        "old object really returned with the snapshot",
      );
      // Observe the actual Node child signal, not pnpm/tsx CLI wrapper exit
      // conventions. The process killed below is the process we supervise.
      const purge = async (behavior: string) =>
        JSON.parse(
          (
            await exec(
              process.execPath,
              ["--import", "tsx", script, "--purge-restored", controlsPath, restoredObjects, behavior],
              {
                ...options,
                cwd: resolve(root, "artifacts/api-server"),
                env: { ...env, DATABASE_URL: url("valo_restore_target") },
              },
            )
          ).stdout,
        );
      report.phase = "replay_controlled_object_failure";
      const failure = await purge("fail-object");
      check.controlledObjectFailure = failure;
      assert.equal(failure.failed, 1);
      assert.equal(failure.remaining, true);
      assert.equal(hash(await readFile(deletedObject)), fixtures[0]!.checksum);
      report.phase = "replay_kill_after_object";
      await assert.rejects(
        () => purge("crash-after-object"),
        (error) => {
          const e = error as { stderr?: string; stdout?: string; code?: unknown; signal?: unknown };
          const reached = Boolean(e.stderr?.includes("RECOVERY_CRASH_AFTER_OBJECT")),
            killed = e.code === 137 || e.signal === "SIGKILL" || /SIGKILL/.test(e.stdout ?? "");
          check.objectDeletionCrash = {
            boundaryReached: reached,
            killReported: killed,
            wrapperExitCode: typeof e.code === "number" ? e.code : undefined,
          };
          return reached && killed;
        },
      );
      await assert.rejects(() => readFile(deletedObject), { code: "ENOENT" });
      assert.equal(
        Number(
          (
            await client.query("SELECT count(*) FROM valo_documents WHERE workspace_id=$1", [
              fixtures[0]!.workspaceId,
            ])
          ).rows[0].count,
        ),
        1,
      );
      report.phase = "finish_physical_replay";
      const finished = await purge("complete");
      assert.equal(finished.physicalApplicationReplayComplete, true);
      assert.equal((await purge("complete")).physicalApplicationReplayComplete, true);
      await assert.rejects(() => readFile(deletedObject), { code: "ENOENT" });
      for (const table of [
        "valo_documents",
        "valo_document_revisions",
        "valo_profile_versions",
        "valo_file_assets",
        "valo_export_jobs",
      ])
        assert.equal(
          Number(
            (
              await client.query(`SELECT count(*) FROM ${table} WHERE workspace_id=$1`, [
                fixtures[0]!.workspaceId,
              ])
            ).rows[0].count,
          ),
          0,
        );
      assert.equal(
        Number(
          (
            await client.query("SELECT count(*) FROM valo_jobs.job WHERE data->>'workspaceId'=$1", [
              fixtures[0]!.workspaceId,
            ])
          ).rows[0].count,
        ),
        0,
      );
      assert.equal(
        Number(
          (
            await client.query("SELECT count(*) FROM valo_documents WHERE workspace_id=ANY($1::uuid[])", [
              fixtures.slice(1).map((f) => f.workspaceId),
            ])
          ).rows[0].count,
        ),
        2,
      );
      check.physicalApplicationPurgeWithStorageFailureAndProcessRestart = true;
      check.queuePayloadPurgedBeforeTrackingRows = true;
      check.otherTenantsPreserved = true;
      for (const table of ["valo_privacy_cases", "valo_privacy_events", "valo_privacy_redactions"])
        assert.equal(
          Number(
            (
              await client.query(
                `SELECT count(*) FROM ${table} r WHERE workspace_id=$1
          AND to_jsonb(r)::text LIKE '%SYNTHETIC-OLDER-PRIVACY-COPY%'`,
                [fixtures[0]!.workspaceId],
              )
            ).rows[0].count,
          ),
          0,
        );
      check.preCutoffPrivacyCopiesNotResurrected = true;
      report.physicalApplicationReplayComplete = true;
      report.externalSystemsFulfilled = false;
    } finally {
      client.release();
    }
    env.DATABASE_URL = url("valo_restore_target");
    report.phase = "verify_customer_authorisation";
    const verified = await exec(
      "pnpm",
      [
        "--filter",
        "@workspace/api-server",
        "exec",
        "tsx",
        script,
        "--verify-access",
        join(directory, "fixtures.json"),
      ],
      options,
    );
    check.customerAccess = JSON.parse(verified.stdout);
    report.restoreCompletedAt = new Date().toISOString();
    report.restoreAndValidationElapsedMs = Math.round(performance.now() - restoreStart);
    report.recoveryCutoffAgeMs = Date.now() - Date.parse(String(report.cutoffAt));
    report.passed = true;
    report.phase = "completed";
  } catch (error) {
    report.passed = false;
    report.failureType = error instanceof assert.AssertionError ? "ASSERTION_FAILED" : "DRILL_FAILED";
    const safeCode = /Error: ([A-Z][A-Z0-9_]{3,79})(?:\s|$)/.exec(
      String((error as { stderr?: unknown })?.stderr ?? ""),
    )?.[1];
    if (safeCode) report.failureCode = safeCode;
    const diagnostic = /RECOVERY_CHILD_FAILURE:(\{[^\n]+\})/.exec(
      String((error as { stderr?: unknown })?.stderr ?? ""),
    )?.[1];
    if (diagnostic) report.childFailure = JSON.parse(diagnostic);
    // No child stdout/stderr, credentials, user text or raw error details retained.
    process.exitCode = 1;
  } finally {
    await source?.end();
    await target?.end();
    if (running)
      await exec("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"], options).catch(() => {
        report.cleanupFailed = true;
        process.exitCode = 1;
      });
    await rm(directory, { recursive: true, force: true });
    report.elapsedMs = Math.round(performance.now() - started);
    report.completedAt = new Date().toISOString();
    const output = resolve("generated-artifacts/valo-recovery");
    await mkdir(output, { recursive: true });
    await writeFile(join(output, "isolated-recovery.json"), JSON.stringify(report, null, 2) + "\n");
    await writeFile(
      join(output, `isolated-recovery-${String(report.startedAt).replace(/[^0-9TZ]/g, "")}.json`),
      JSON.stringify(report, null, 2) + "\n",
    );
    logger.info({ event: "recovery.isolated_drill", report });
  }
}
try {
  if (mode === "--fixture-seed") await fixtureSeed();
  else if (mode === "--capture-erasure") await captureErasure();
  else if (mode === "--purge-restored") await purgeRestored();
  else if (mode === "--replay-controls") await fixtureReplay();
  else if (mode === "--verify-access") await verifyAccess();
  else await drill();
} catch (error) {
  // Fixed metadata/locations only: never error messages, SQL parameters, raw
  // child output, signing keys or privacy-case bodies.
  const e = error as Error & {
    code?: unknown;
    status?: unknown;
    cause?: { code?: unknown; constraint?: unknown; table?: unknown };
  };
  const fixed = /^(?:RECOVERY|ERASURE|PRIVACY|LOCAL|OWNED|ONE|INDEPENDENT)_[A-Z0-9_]{3,79}$/.test(e.message)
    ? e.message
    : undefined;
  const fault = (e.cause ?? e) as { code?: unknown; constraint?: unknown };
  const diagnostic = {
    code: typeof e.code === "string" && /^[A-Z0-9_]{3,80}$/.test(e.code) ? e.code : fixed,
    status: typeof e.status === "number" ? e.status : undefined,
    databaseCode:
      typeof e.cause?.code === "string" && /^[A-Z0-9_]{3,80}$/.test(e.cause.code) ? e.cause.code : undefined,
    constraint:
      typeof fault.constraint === "string" && /^[a-z_]{1,100}$/.test(fault.constraint)
        ? fault.constraint
        : undefined,
    locations: [...(e.stack ?? "").matchAll(/\/(valo-[a-z-]+\.ts):(\d+):(\d+)/g)]
      .slice(0, 5)
      .map((m) => ({ file: m[1], line: Number(m[2]) })),
  };
  process.stderr.write("RECOVERY_CHILD_FAILURE:" + JSON.stringify(diagnostic) + "\n");
  process.exitCode = 1;
}
