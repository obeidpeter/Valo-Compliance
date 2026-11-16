import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:net";
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const run = promisify(execFile),
  folder = fileURLToPath(new URL("../drizzle/", import.meta.url));
const baseline = JSON.parse(
  await readFile(new URL("../../../docs/valo/phase1-migration-baseline.json", import.meta.url), "utf8"),
);
const journal = JSON.parse(await readFile(join(folder, "meta/_journal.json"), "utf8"));
// Phase 1 is already applied on development. Never renumber or rewrite it.
const phase1Applied = [
  ["0030_workspace_export_convergence", "62d1e4d45305826d677bc30d1dafe99d313df7c903784b8b29f13f5727689d70"],
  ["0031_dispute_convergence", "81a6149d35da229264493a6244e950da99e33c925d5fa2f5c086ef6ece9ffca4"],
];
const staffMigration = "0032_staff_role_governance";
const cleanupMigration = "0033_workspace_cleanup_retry";
const runtimeMigration = "0034_runtime_identity";
const savedTemplatesMigration = "0035_saved_templates";
const auditMigration = "0036_audit_append_only";
// Completes an unjournalled upgrade with every journalled migration from `tag` onwards,
// so adding a migration never requires editing these upgrade paths.
const journalTagsFrom = (tag) => {
  const start = journal.entries.findIndex((entry) => entry.tag === tag);
  if (start < 0) throw new Error(`Unknown migration ${tag}`);
  return journal.entries.slice(start).map((entry) => entry.tag);
};
const tail = [
  ...phase1Applied.map(([tag]) => tag),
  staffMigration,
  cleanupMigration,
  runtimeMigration,
  savedTemplatesMigration,
  auditMigration,
];
const hash = (value) =>
  createHash("sha256")
    .update(typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value))
    .digest("hex");
const executable = (name) =>
  process.env.VALO_TEST_PG_BIN
    ? join(process.env.VALO_TEST_PG_BIN, name + (process.platform === "win32" ? ".exe" : ""))
    : name;

async function schema(client) {
  const queries = {
    columns: `SELECT table_name,column_name,ordinal_position,data_type,udt_name,is_nullable,column_default,is_identity,is_generated
      FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position`,
    constraints: `SELECT c.relname,k.conname,k.contype,pg_get_constraintdef(k.oid,true) AS definition
      FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' ORDER BY c.relname,k.conname`,
    indexes: `SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname`,
    triggers: `SELECT c.relname,t.tgname,pg_get_triggerdef(t.oid,true) AS definition FROM pg_trigger t
      JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY c.relname,t.tgname`,
    functions: `SELECT p.proname,pg_get_function_identity_arguments(p.oid) AS arguments,pg_get_functiondef(p.oid) AS definition
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f'
      ORDER BY p.proname,arguments`,
    grants: `SELECT grantee,table_name,privilege_type,is_grantable FROM information_schema.role_table_grants
      WHERE table_schema='public' ORDER BY grantee,table_name,privilege_type`,
    columnGrants: `SELECT grantee,table_name,column_name,privilege_type FROM information_schema.role_column_grants
      WHERE table_schema='public' ORDER BY grantee,table_name,column_name,privilege_type`,
    roles: `SELECT rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolbypassrls
      FROM pg_roles WHERE rolname LIKE 'valo_content_%' ORDER BY rolname`,
  };
  const result = {};
  for (const [key, query] of Object.entries(queries)) result[key] = (await client.query(query)).rows;
  return result;
}
async function freePort() {
  const server = createServer();
  await new Promise((ok, no) => {
    server.once("error", no);
    server.listen(0, "127.0.0.1", ok);
  });
  const port = server.address().port;
  await new Promise((ok) => server.close(ok));
  return port;
}
async function cluster(callback) {
  // Always create a new local cluster. Never consume DATABASE_URL/PGHOST or
  // connect to a developer, workspace, managed or production database.
  const directory = await mkdtemp(join(tmpdir(), "valo-phase1-migration-")),
    data = join(directory, "data"),
    port = await freePort();
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      /^(PATH|Path|SYSTEMROOT|SystemRoot|WINDIR|TEMP|TMP|LANG|LC_ALL|LD_LIBRARY_PATH)$/i.test(key),
    ),
  );
  let started = false,
    client;
  try {
    await run(
      executable("initdb"),
      ["-D", data, "-U", "valo_phase1", "--auth=trust", "--no-locale", "-E", "UTF8"],
      { env, windowsHide: true, timeout: 30000 },
    );
    const options = `-h 127.0.0.1 -p ${port} -F` + (process.platform === "win32" ? "" : ` -k "${directory}"`);
    await run(
      executable("pg_ctl"),
      ["-D", data, "-l", join(directory, "postgres.log"), "-o", options, "-w", "start"],
      { env, windowsHide: true, timeout: 30000 },
    );
    started = true;
    client = new pg.Client({
      host: "127.0.0.1",
      port,
      user: "valo_phase1",
      database: "postgres",
      connectionTimeoutMillis: 5000,
    });
    await client.connect();
    await callback(client, directory);
  } finally {
    await client?.end();
    if (started)
      await run(executable("pg_ctl"), ["-D", data, "-m", "fast", "-w", "stop"], {
        env,
        windowsHide: true,
        timeout: 30000,
      });
    const scoped = relative(resolve(tmpdir()), resolve(directory));
    assert.ok(!isAbsolute(scoped) && !scoped.startsWith("..") && scoped.startsWith("valo-phase1-migration-"));
    await rm(directory, { recursive: true, force: true });
  }
}
async function baselineFolder(directory, entries = journal.entries.slice(0, baseline.entries.length)) {
  const target = join(directory, "baseline");
  await mkdir(join(target, "meta"), { recursive: true });
  await writeFile(join(target, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
  for (const entry of entries)
    await copyFile(join(folder, entry.tag + ".sql"), join(target, entry.tag + ".sql"));
  return target;
}
async function raw(client, tags) {
  for (const tag of tags) await client.query(await readFile(join(folder, tag + ".sql"), "utf8"));
}
async function applyTail(client) {
  await client.query("BEGIN");
  try {
    await raw(client, tail);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
async function seed(client) {
  const ids = Object.fromEntries(
    ["workspace", "job", "attempt", "content", "price", "order", "dispute", "information", "action"].map(
      (key) => [key, randomUUID()],
    ),
  );
  await client.query("INSERT INTO valo_workspaces(id,owner_identity_id) VALUES($1,$2)", [
    ids.workspace,
    "synthetic-phase1-" + ids.workspace,
  ]);
  await client.query(
    `INSERT INTO valo_workspace_exports(id,workspace_id,requester_id,request_key,status,current_attempt_id,checksum,size,counts,expires_at)
    VALUES($1,$2,'synthetic-phase1-owner',$3,'ready',$4,$5,42,'{"documents":1}',now()+interval '1 day')`,
    [ids.job, ids.workspace, randomUUID(), ids.attempt, "a".repeat(64)],
  );
  await client.query(
    `INSERT INTO valo_workspace_export_attempts(id,workspace_id,job_id,object_key,status)
    VALUES($1,$2,$3,$4,'ready')`,
    [ids.attempt, ids.workspace, ids.job, `valo/development/${ids.workspace}/${ids.attempt}.json`],
  );
  await client.query(
    `INSERT INTO valo_publication_policies(id,hash,policy,authority) VALUES('phase1-synthetic','not-approved','{}','{}')`,
  );
  await client.query(
    `INSERT INTO valo_content_versions(id,template_id,version,slug,policy_id,candidate_hash,bundle,attestations,review_by)
    VALUES($1,'SYNTHETIC',1,'phase1-synthetic','phase1-synthetic','not-approved','{}','{}',now())`,
    [ids.content],
  );
  await client.query(
    `INSERT INTO valo_prices(id,content_version_id,title,amount_kobo,licence_version,licence_text,tax_treatment,approval_reference,effective_from)
    VALUES($1,$2,'Synthetic migration fixture',100,'synthetic','Not a sales licence','No tax assertion','SYNTHETIC-NOT-APPROVED',now())`,
    [ids.price, ids.content],
  );
  await client.query(
    `INSERT INTO valo_orders(id,workspace_id,requested_by,reference,request_key,price_id,line,amount_kobo)
    VALUES($1,$2,'synthetic-phase1-owner',$3,$4,$5,'{}',100)`,
    [ids.order, ids.workspace, "synthetic-" + ids.order, randomUUID(), ids.price],
  );
  await client.query(
    `INSERT INTO valo_payment_disputes(id,workspace_id,order_id,provider_id,status,amount_kobo)
    VALUES($1,$2,$3,$4,'pending',100)`,
    [ids.dispute, ids.workspace, ids.order, "synthetic-" + ids.dispute],
  );
  await client.query(
    `INSERT INTO valo_dispute_information(id,workspace_id,order_id,dispute_id,actor_id,request_key,information,consent_version)
    VALUES($1,$2,$3,$4,'synthetic-phase1-owner',$5,'{"statement":"synthetic retained input"}','synthetic')`,
    [ids.information, ids.workspace, ids.order, ids.dispute, randomUUID()],
  );
  await client.query(
    `INSERT INTO valo_dispute_actions(id,workspace_id,order_id,dispute_id,request_key,kind,information_id,payload,source_hash,policy_version,authorised_by)
    VALUES($1,$2,$3,$4,$5,'submit_evidence',$6,'{"statement":"synthetic retained input","amountKobo":50}',$7,'synthetic','synthetic-finance')`,
    [ids.action, ids.workspace, ids.order, ids.dispute, randomUUID(), ids.information, "b".repeat(64)],
  );
  return ids;
}
async function rows(client) {
  const result = {};
  for (const table of [
    "valo_workspaces",
    "valo_workspace_exports",
    "valo_workspace_export_attempts",
    "valo_orders",
    "valo_payment_disputes",
    "valo_dispute_information",
    "valo_dispute_actions",
  ]) {
    const added =
      table === "valo_workspace_exports"
        ? ["version", "queue_id", "rows_processed", "bytes_prepared", "progress_section"]
        : table === "valo_payment_disputes"
          ? ["held", "control_version"]
          : table === "valo_dispute_actions"
            ? ["lease_until"]
            : table === "valo_workspace_export_attempts"
              ? ["next_cleanup_at", "cleanup_attempts", "cleanup_error_code"]
              : [];
    result[table] = (
      await client.query(
        `SELECT to_jsonb(t)${added.map((key) => `-'${key}'`).join("")} AS record FROM ${table} t ORDER BY id`,
      )
    ).rows;
  }
  return result;
}
async function cleanupRows(client) {
  const result = {};
  for (const table of ["valo_workspaces", "valo_workspace_exports", "valo_workspace_export_attempts"]) {
    const added =
      table === "valo_workspace_export_attempts"
        ? ["next_cleanup_at", "cleanup_attempts", "cleanup_error_code"]
        : [];
    result[table] = (
      await client.query(
        `SELECT to_jsonb(t)${added.map((key) => `-'${key}'`).join("")} AS record FROM ${table} t ORDER BY id`,
      )
    ).rows;
  }
  return result;
}

test(
  "phase 2 migration chain preserves applied phase 1 SQL, staff access and history",
  { timeout: 480000 },
  async (t) => {
    assert.equal(
      process.env.VALO_RUN_MIGRATION_TESTS,
      "synthetic-isolated-only",
      "Explicit isolated-cluster test opt-in required",
    );
    let finalSchema, baselineSchema;
    await t.test("applied journal entries and raw SQL bytes remain pinned to development", async () => {
      assert.deepEqual(
        journal.entries.slice(0, baseline.entries.length),
        baseline.entries.map(({ sha256, ...entry }) => entry),
      );
      assert.deepEqual(
        journal.entries.slice(baseline.entries.length).map((entry) => entry.tag),
        tail,
      );
      for (const entry of baseline.entries)
        assert.equal(hash(await readFile(join(folder, entry.tag + ".sql"))), entry.sha256, entry.tag);
      for (const [tag, sha256] of phase1Applied)
        assert.equal(hash(await readFile(join(folder, tag + ".sql"))), sha256, tag);
      assert.equal(
        hash(await readFile(join(folder, staffMigration + ".sql"))),
        "9d32fdb51bde36e50b1feec0fdba65269cb1039251beec6c0781926ae1a2bfca",
      );
      for (let i = 0; i < journal.entries.length; i++) {
        assert.equal(journal.entries[i].idx, i, "journal indexes must be contiguous");
        if (i)
          assert.ok(
            journal.entries[i].when > journal.entries[i - 1].when,
            "an older timestamp would silently skip an upgrade",
          );
      }
    });
    await t.test(
      "real Drizzle migration runner installs the complete clean chain and reruns without effects",
      async () =>
        cluster(async (client) => {
          await migrate(drizzle(client), { migrationsFolder: folder });
          finalSchema = await schema(client);
          const before = (await client.query("SELECT * FROM drizzle.__drizzle_migrations ORDER BY id")).rows;
          assert.equal(before.length, journal.entries.length);
          await migrate(drizzle(client), { migrationsFolder: folder });
          assert.deepEqual(
            (await client.query("SELECT * FROM drizzle.__drizzle_migrations ORDER BY id")).rows,
            before,
          );
          assert.deepEqual(await schema(client), finalSchema);
        }),
    );
    await t.test(
      "tracked upgrade preserves export IDs, keys, financial history and rolls back an interrupted tail",
      async () =>
        cluster(async (client, directory) => {
          await migrate(drizzle(client), { migrationsFolder: await baselineFolder(directory) });
          baselineSchema = await schema(client);
          const ids = await seed(client),
            before = await rows(client);
          await client.query("BEGIN");
          await raw(client, [tail[0]]);
          await assert.rejects(client.query("SELECT 1/0"));
          await client.query("ROLLBACK");
          assert.deepEqual(await schema(client), baselineSchema);
          assert.deepEqual(await rows(client), before);
          await migrate(drizzle(client), { migrationsFolder: folder });
          assert.deepEqual(await rows(client), before);
          assert.deepEqual(await schema(client), finalSchema);
          await assert.rejects(
            client.query(`UPDATE valo_dispute_actions SET payload='{}' WHERE id=$1`, [ids.action]),
            /immutable/,
          );
          await assert.rejects(
            client.query("DELETE FROM valo_dispute_actions WHERE id=$1", [ids.action]),
            /immutable/,
          );
        }),
    );
    await t.test(
      "unjournalled native-shaped baseline uses only the additive tail and invents no migration history",
      async () =>
        cluster(async (client) => {
          await raw(
            client,
            baseline.entries.map((entry) => entry.tag),
          );
          assert.deepEqual(await schema(client), baselineSchema);
          const ids = await seed(client),
            before = await rows(client);
          assert.equal(
            (await client.query(`SELECT to_regclass('drizzle.__drizzle_migrations') AS ledger`)).rows[0]
              .ledger,
            null,
          );
          await applyTail(client);
          assert.deepEqual(await schema(client), finalSchema);
          assert.deepEqual(await rows(client), before);
          assert.equal(
            (await client.query(`SELECT to_regclass('drizzle.__drizzle_migrations') AS ledger`)).rows[0]
              .ledger,
            null,
          );
          await assert.rejects(applyTail(client), /already exists/);
          assert.deepEqual(await rows(client), before);
          assert.equal(
            (await client.query("SELECT status FROM valo_workspace_exports WHERE id=$1", [ids.job])).rows[0]
              .status,
            "ready",
          );
        }),
    );
    for (const tracked of [true, false])
      await t.test(
        `0031 to 0032 ${tracked ? "tracked" : "unjournalled"} upgrade preserves existing staff and rolls back an interrupted migration`,
        async () =>
          cluster(async (client, directory) => {
            const prior = journal.entries.slice(
              0,
              journal.entries.findIndex((entry) => entry.tag === staffMigration),
            );
            if (tracked)
              await migrate(drizzle(client), { migrationsFolder: await baselineFolder(directory, prior) });
            else
              await raw(
                client,
                prior.map((entry) => entry.tag),
              );
            const active = randomUUID(),
              inactive = randomUUID(),
              audit = randomUUID();
            await client.query(
              `INSERT INTO valo_staff_assignments(id,identity_id,role,active,granted_by,reason,created_at)
      VALUES($1,'synthetic-existing-system','system',true,'synthetic-bootstrap','Preserve existing administrator',now()-interval '1 day'),
            ($2,'synthetic-revoked-support','support',false,'synthetic-bootstrap','Preserve revoked assignment',now()-interval '2 days')`,
              [active, inactive],
            );
            await client.query(
              `INSERT INTO valo_staff_access_audit(id,assignment_id,actor_id,area,reason)
      VALUES($1,$2,'synthetic-existing-system','system','Existing immutable access evidence')`,
              [audit, active],
            );
            const staffRows = async () => ({
              assignments: (
                await client.query(
                  `SELECT id,identity_id,role,active,granted_by,reason,created_at FROM valo_staff_assignments ORDER BY id`,
                )
              ).rows,
              audit: (await client.query("SELECT * FROM valo_staff_access_audit ORDER BY id")).rows,
            });
            const before = await staffRows(),
              beforeSchema = await schema(client);
            await client.query("BEGIN");
            await raw(client, [staffMigration]);
            await assert.rejects(client.query("SELECT 1/0"));
            await client.query("ROLLBACK");
            assert.deepEqual(await staffRows(), before);
            assert.deepEqual(await schema(client), beforeSchema);
            if (tracked) await migrate(drizzle(client), { migrationsFolder: folder });
            else {
              await client.query("BEGIN");
              await raw(client, journalTagsFrom(staffMigration));
              await client.query("COMMIT");
            }
            assert.deepEqual(await schema(client), finalSchema);
            assert.deepEqual(await staffRows(), before);
            assert.equal(
              (await client.query("SELECT count(*)::integer AS count FROM valo_staff_role_changes")).rows[0]
                .count,
              0,
              "migration grants no role and invents no audit",
            );
            const assigned = (
              await client.query(
                "SELECT active,grant_mode,expires_at,version FROM valo_staff_assignments ORDER BY active DESC",
              )
            ).rows;
            assert.deepEqual(assigned, [
              { active: true, grant_mode: "permanent", expires_at: null, version: 1 },
              { active: false, grant_mode: "permanent", expires_at: null, version: 1 },
            ]);
            // SQL CHECK must reject NULL explicitly: PostgreSQL accepts UNKNOWN checks.
            for (const duration of [null, 4, 61])
              await assert.rejects(
                client.query(
                  `UPDATE valo_staff_assignments SET grant_mode='break_glass',
      expires_at=granted_at+($1::integer*interval '1 minute') WHERE id=$2`,
                  [duration, inactive],
                ),
                /valo_staff_expiry_shape/,
              );
            await assert.rejects(
              client.query(
                `UPDATE valo_staff_assignments SET expires_at=granted_at+interval '5 minutes' WHERE id=$1`,
                [active],
              ),
              /valo_staff_expiry_shape/,
            );
            for (const duration of [5, 60])
              await client.query(
                `UPDATE valo_staff_assignments SET grant_mode='break_glass',expires_at=granted_at+($1::integer*interval '1 minute') WHERE id=$2`,
                [duration, inactive],
              );
            if (tracked) {
              const ledger = (await client.query("SELECT * FROM drizzle.__drizzle_migrations ORDER BY id"))
                .rows;
              assert.equal(ledger.length, journal.entries.length);
              await migrate(drizzle(client), { migrationsFolder: folder });
              assert.deepEqual(
                (await client.query("SELECT * FROM drizzle.__drizzle_migrations ORDER BY id")).rows,
                ledger,
              );
            } else {
              assert.equal(
                (await client.query(`SELECT to_regclass('drizzle.__drizzle_migrations') AS ledger`)).rows[0]
                  .ledger,
                null,
              );
              await assert.rejects(
                client.query(await readFile(join(folder, staffMigration + ".sql"), "utf8")),
                /already exists/,
              );
            }
          }),
      );
    for (const tracked of [true, false])
      await t.test(
        `0032 to 0033 ${tracked ? "tracked" : "unjournalled"} cleanup upgrade preserves reservations and restores its checkpoint`,
        async () =>
          cluster(async (client, directory) => {
            const prior = journal.entries.slice(
              0,
              journal.entries.findIndex((entry) => entry.tag === cleanupMigration),
            );
            if (tracked)
              await migrate(drizzle(client), { migrationsFolder: await baselineFolder(directory, prior) });
            else
              await raw(
                client,
                prior.map((entry) => entry.tag),
              );
            const ids = await seed(client),
              legacy = randomUUID(),
              checked = new Date("2026-01-01T12:00:00Z");
            await client.query(
              `UPDATE valo_workspace_export_attempts SET status='cleanup',cleanup_checked_at=$1 WHERE id=$2`,
              [checked, ids.attempt],
            );
            await client.query(
              `INSERT INTO valo_workspace_export_attempts(id,workspace_id,job_id,object_key,status)
      VALUES($1,$2,$3,$4,'cleanup')`,
              [legacy, ids.workspace, ids.job, `valo/development/${ids.workspace}/${randomUUID()}.json`],
            );
            const before = await cleanupRows(client),
              beforeSchema = await schema(client);
            const ledgerBefore = tracked
              ? (await client.query("SELECT * FROM drizzle.__drizzle_migrations ORDER BY id")).rows
              : null;
            await client.query("BEGIN");
            await raw(client, [cleanupMigration]);
            await assert.rejects(client.query("SELECT 1/0"));
            await client.query("ROLLBACK");
            assert.deepEqual(await cleanupRows(client), before);
            assert.deepEqual(await schema(client), beforeSchema);
            if (tracked)
              assert.deepEqual(
                (await client.query("SELECT * FROM drizzle.__drizzle_migrations ORDER BY id")).rows,
                ledgerBefore,
              );
            if (tracked) await migrate(drizzle(client), { migrationsFolder: folder });
            else {
              await client.query("BEGIN");
              await raw(client, journalTagsFrom(cleanupMigration));
              await client.query("COMMIT");
            }
            assert.deepEqual(await cleanupRows(client), before);
            assert.deepEqual(await schema(client), finalSchema);
            const upgraded = (
              await client.query(
                "SELECT id,cleanup_checked_at,next_cleanup_at,cleanup_attempts,cleanup_error_code FROM valo_workspace_export_attempts ORDER BY id",
              )
            ).rows;
            for (const row of upgraded) {
              assert.equal(row.cleanup_attempts, 0);
              assert.equal(row.cleanup_error_code, null);
            }
            assert.equal(
              upgraded.find((row) => row.id === ids.attempt).next_cleanup_at.getTime(),
              checked.getTime() + 3_600_000,
            );
            assert.equal(upgraded.find((row) => row.id === legacy).cleanup_checked_at, null);
            await assert.rejects(
              client.query("UPDATE valo_workspace_export_attempts SET cleanup_attempts=-1 WHERE id=$1", [
                legacy,
              ]),
              /check constraint/,
            );
            await assert.rejects(
              client.query(
                "UPDATE valo_workspace_export_attempts SET cleanup_error_code='PRIVATE_RAW_PROVIDER_ERROR' WHERE id=$1",
                [legacy],
              ),
              /check constraint/,
            );
            if (!tracked)
              assert.equal(
                (await client.query("SELECT to_regclass('drizzle.__drizzle_migrations') AS ledger")).rows[0]
                  .ledger,
                null,
              );
            // Restore the exact pre-upgrade SQL checkpoint into another fresh cluster.
            await cluster(async (restored) => {
              await raw(
                restored,
                prior.map((entry) => entry.tag),
              );
              for (const [table, records] of Object.entries(before))
                for (const { record } of records) {
                  const keys = Object.keys(record),
                    values = keys.map((key) =>
                      typeof record[key] === "object" && record[key] !== null
                        ? JSON.stringify(record[key])
                        : record[key],
                    );
                  await restored.query(
                    `INSERT INTO ${table}(${keys.map((key) => '"' + key + '"').join(",")}) VALUES(${keys.map((_, i) => "$" + (i + 1)).join(",")})`,
                    values,
                  );
                }
              const result = await cleanupRows(restored);
              for (const table of [
                "valo_workspaces",
                "valo_workspace_exports",
                "valo_workspace_export_attempts",
              ])
                assert.deepEqual(result[table], before[table]);
              assert.deepEqual(await schema(restored), beforeSchema);
            });
          }),
      );
    for (const tracked of [true, false])
      await t.test(
        `0033 to 0034 ${tracked ? "tracked" : "unjournalled"} identity migration is inert and transactional`,
        async () =>
          cluster(async (client, directory) => {
            const prior = journal.entries.slice(
              0,
              journal.entries.findIndex((entry) => entry.tag === runtimeMigration),
            );
            if (tracked)
              await migrate(drizzle(client), { migrationsFolder: await baselineFolder(directory, prior) });
            else
              await raw(
                client,
                prior.map((entry) => entry.tag),
              );
            await seed(client);
            const before = await rows(client),
              beforeSchema = await schema(client);
            await client.query("BEGIN");
            await raw(client, [runtimeMigration]);
            await assert.rejects(client.query("SELECT 1/0"));
            await client.query("ROLLBACK");
            assert.deepEqual(await rows(client), before);
            assert.deepEqual(await schema(client), beforeSchema);
            if (tracked) await migrate(drizzle(client), { migrationsFolder: folder });
            else {
              await client.query("BEGIN");
              await raw(client, [runtimeMigration]);
              await client.query("COMMIT");
            }
            assert.deepEqual(await rows(client), before);
            const marker = (await client.query("SELECT * FROM valo_runtime_identity")).rows;
            assert.equal(marker.length, 1);
            assert.equal(marker[0].environment, "development");
            assert.equal(marker[0].storage_fingerprint, null);
            assert.match(marker[0].instance_id, /^[a-f0-9-]{36}$/);
            await assert.rejects(
              client.query("INSERT INTO valo_runtime_identity(singleton) VALUES(false)"),
              /check constraint/,
            );
            await assert.rejects(
              client.query("UPDATE valo_runtime_identity SET environment='production-rehearsal'"),
              /check constraint/,
            );
            if (!tracked)
              assert.equal(
                (await client.query("SELECT to_regclass('drizzle.__drizzle_migrations') AS ledger")).rows[0]
                  .ledger,
                null,
              );
          }),
      );
    for (const tracked of [true, false])
      await t.test(
        `0034 to 0035 ${tracked ? "tracked" : "unjournalled"} saved-template migration is additive and transactional`,
        async () =>
          cluster(async (client, directory) => {
            const prior = journal.entries.slice(
              0,
              journal.entries.findIndex((entry) => entry.tag === savedTemplatesMigration),
            );
            if (tracked)
              await migrate(drizzle(client), { migrationsFolder: await baselineFolder(directory, prior) });
            else
              await raw(
                client,
                prior.map((entry) => entry.tag),
              );
            await seed(client);
            const before = await rows(client),
              beforeSchema = await schema(client);
            await client.query("BEGIN");
            await raw(client, [savedTemplatesMigration]);
            await assert.rejects(client.query("SELECT 1/0"));
            await client.query("ROLLBACK");
            assert.deepEqual(await rows(client), before);
            assert.deepEqual(await schema(client), beforeSchema);
            if (tracked) await migrate(drizzle(client), { migrationsFolder: folder });
            else {
              await client.query("BEGIN");
              await raw(client, [savedTemplatesMigration]);
              await client.query("COMMIT");
            }
            assert.deepEqual(await rows(client), before);
            const columns = (
              await client.query(
                "SELECT column_name FROM information_schema.columns WHERE table_name='valo_saved_templates' ORDER BY ordinal_position",
              )
            ).rows.map((row) => row.column_name);
            assert.deepEqual(columns, [
              "id",
              "workspace_id",
              "template_id",
              "saved_title",
              "saved_version",
              "created_at",
            ]);
            await assert.rejects(
              client.query(
                "INSERT INTO valo_saved_templates VALUES (gen_random_uuid(),gen_random_uuid(),'TPL-01','Title',1,now())",
              ),
              /foreign key/,
            );
          }),
      );
    for (const tracked of [true, false])
      await t.test(
        `0035 to 0036 ${tracked ? "tracked" : "unjournalled"} audit migration keeps rows and makes staff audit append-only`,
        async () =>
          cluster(async (client, directory) => {
            const prior = journal.entries.slice(
              0,
              journal.entries.findIndex((entry) => entry.tag === auditMigration),
            );
            if (tracked)
              await migrate(drizzle(client), { migrationsFolder: await baselineFolder(directory, prior) });
            else
              await raw(
                client,
                prior.map((entry) => entry.tag),
              );
            await seed(client);
            const assignment = randomUUID(),
              real = randomUUID(),
              synthetic = randomUUID();
            await client.query(
              "INSERT INTO valo_staff_assignments(id,identity_id,role,granted_by,reason) VALUES($1,'operator-fixture','support','synthetic-migration','Migration fixture assignment')",
              [assignment],
            );
            await client.query(
              "INSERT INTO valo_staff_access_audit(id,assignment_id,actor_id,area,reason) VALUES($1,$3,'operator-fixture','support','Fixture'),($2,$3,'synthetic-operator-fixture','support','Fixture')",
              [real, synthetic, assignment],
            );
            const before = await rows(client),
              beforeSchema = await schema(client);
            await client.query("BEGIN");
            await raw(client, [auditMigration]);
            await assert.rejects(client.query("SELECT 1/0"));
            await client.query("ROLLBACK");
            assert.deepEqual(await rows(client), before);
            assert.deepEqual(await schema(client), beforeSchema);
            if (tracked) await migrate(drizzle(client), { migrationsFolder: folder });
            else {
              await client.query("BEGIN");
              await raw(client, [auditMigration]);
              await client.query("COMMIT");
            }
            assert.deepEqual(await rows(client), before);
            await assert.rejects(
              client.query("UPDATE valo_staff_access_audit SET reason='changed' WHERE id=$1", [real]),
              /append-only/,
            );
            await assert.rejects(
              client.query("DELETE FROM valo_staff_access_audit WHERE id=$1", [real]),
              /append-only/,
            );
            await assert.rejects(client.query("TRUNCATE valo_staff_access_audit"), /cannot be truncated/);
            await assert.rejects(client.query("TRUNCATE valo_staff_role_changes"), /cannot be truncated/);
            const removed = await client.query("DELETE FROM valo_staff_access_audit WHERE id=$1", [
              synthetic,
            ]);
            assert.equal(removed.rowCount, 1);
          }),
      );
    console.log(
      JSON.stringify({
        scope: "fresh invocation-owned PostgreSQL clusters only",
        baselineCommit: baseline.commit,
        baselineMigrations: baseline.entries.length,
        finalMigrations: journal.entries.length,
        schemaSha256: hash(finalSchema),
        clean: true,
        trackedUpgrade: true,
        unjournalledUpgrade: true,
        interruptedTailRolledBack: true,
        staffUpgradeFrom0031: true,
        existingStaffPreserved: true,
        emergencyExpiryConstraints: true,
        cleanupUpgradeFrom0032: true,
        cleanupCheckpointRestore: true,
        nativeDatabaseTouched: false,
      }),
    );
  },
);
