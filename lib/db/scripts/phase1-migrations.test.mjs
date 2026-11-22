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
import { latestSnapshot, snapshotDifferences } from "./snapshot-parity.mjs";
import { enterWorkspaceScope, rowSecurityGaps } from "./workspace-row-security.mjs";

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
const sourceControlsMigration = "0037_source_correction_controls";
const lifecycleMigration = "0038_editorial_lifecycle_integrity";
const supportMigration = "0039_support_lifecycle";
const namesMigration = "20261117112017_constraint_names";
const securityMigration = "20261117125444_workspace_row_security";
const signalsMigration = "20261118002215_security_signals";
const priceLogMigration = "20261118013843_price_change_log";
const preparedMigration = "20261120002839_prepared_candidates";
const publisherLoginMigration = "20261121190325_publisher_login";
const manualLibraryMigration = "20261122124112_manual_library";
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
  sourceControlsMigration,
  lifecycleMigration,
  supportMigration,
  namesMigration,
  securityMigration,
  signalsMigration,
  priceLogMigration,
  preparedMigration,
  publisherLoginMigration,
  manualLibraryMigration,
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
      "every key, check, index and policy has the name and shape in the latest Drizzle snapshot",
      async () =>
        cluster(async (client) => {
          await migrate(drizzle(client), { migrationsFolder: folder });
          const snapshot = await latestSnapshot(folder);
          assert.deepEqual(await snapshotDifferences(client, snapshot), []);
          // The comparison must still see a key or check PostgreSQL named, as hand-written SQL used to
          // leave them, and a check whose expression differs from the snapshot's.
          await client.query("BEGIN");
          try {
            await client.query(
              "ALTER TABLE valo_orders RENAME CONSTRAINT valo_orders_workspace_id_valo_workspaces_id_fk TO valo_orders_workspace_id_fkey",
            );
            await client.query("CREATE INDEX ON valo_orders(created_at)");
            await client.query("ALTER TABLE valo_orders ADD CHECK (amount_kobo < 1000000000)");
            await client.query(
              "ALTER TABLE valo_orders DROP CONSTRAINT valo_orders_currency_check, ADD CONSTRAINT valo_orders_currency_check CHECK (currency IN ('NGN','USD'))",
            );
            assert.deepEqual(await snapshotDifferences(client, snapshot), [
              "valo_orders: valo_orders_amount_kobo_check1 is only in the database: CHECK (amount_kobo < 1000000000)",
              "valo_orders: valo_orders_created_at_idx is only in the database: index (created_at)",
              "valo_orders: valo_orders_currency_check differs: database CHECK (currency = ANY (ARRAY['NGN'::text, 'USD'::text])), snapshot CHECK (currency = 'NGN'::text)",
              "valo_orders: valo_orders_workspace_id_fkey is only in the database: foreign key (workspace_id) references valo_workspaces(id) on delete no action on update no action",
              "valo_orders: valo_orders_workspace_id_valo_workspaces_id_fk is only in the snapshot: foreign key (workspace_id) references valo_workspaces(id) on delete no action on update no action",
            ]);
          } finally {
            await client.query("ROLLBACK");
          }
          // Every workspace table keeps the scoped role to the current workspace and the role
          // holds exactly the pinned privileges. The check still sees a table without row
          // security, a widening policy, an extra grant on a listed table, a grant on an
          // unlisted table, an extra column, a missing lock-only trigger, default privileges
          // for new tables and a function that would run as its owner.
          assert.deepEqual(await rowSecurityGaps(client), []);
          await client.query("BEGIN");
          try {
            await client.query("ALTER TABLE valo_orders DISABLE ROW LEVEL SECURITY");
            await client.query("CREATE POLICY widen ON valo_tasks TO PUBLIC USING (true)");
            await client.query("GRANT TRUNCATE ON valo_documents TO valo_workspace_scope");
            await client.query("GRANT SELECT ON valo_staff_assignments TO valo_workspace_scope");
            await client.query("GRANT UPDATE (owner_identity_id) ON valo_workspaces TO valo_workspace_scope");
            await client.query("DROP TRIGGER valo_workspace_scope_lock_only ON valo_memberships");
            await client.query(
              "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO valo_workspace_scope",
            );
            await client.query(
              "CREATE FUNCTION valo_peek() RETURNS bigint LANGUAGE sql SECURITY DEFINER AS 'SELECT count(*) FROM valo_documents'",
            );
            // The login may not inherit privileges, hold any of its own, belong to another role
            // or create objects, and no other role may become the scoped one.
            const { user, database } = (
              await client.query("SELECT current_user AS user, current_database() AS database")
            ).rows[0];
            await client.query("ALTER ROLE valo_workspace_login INHERIT");
            await client.query("GRANT valo_workspace_scope TO CURRENT_USER");
            await client.query("GRANT SELECT ON valo_documents TO valo_workspace_login");
            await client.query("GRANT CREATE ON SCHEMA public TO valo_workspace_login");
            await client.query(`GRANT CREATE ON DATABASE "${database}" TO valo_workspace_login`);
            await client.query("CREATE ROLE synthetic_phase1_canary NOLOGIN");
            await client.query("GRANT synthetic_phase1_canary TO valo_workspace_login");
            // Grants outside public count too.
            await client.query("CREATE SCHEMA synthetic_phase1_canary");
            await client.query("GRANT USAGE ON SCHEMA synthetic_phase1_canary TO valo_workspace_scope");
            assert.deepEqual(
              await rowSecurityGaps(client),
              [
                `${user} is a member of valo_workspace_scope`,
                "default privileges grant valo_workspace_scope access to new objects of type r",
                "valo_documents: valo_workspace_scope has insert select truncate update, expected insert select update",
                "valo_memberships: no valo_workspace_scope_lock_only trigger refusing the scoped role's updates",
                "valo_orders: row security is off",
                "valo_peek: valo_workspace_scope may call it, and it runs as its owner",
                "valo_staff_assignments: valo_workspace_scope has select, expected none",
                "valo_tasks: policy widen for public is not the workspace policy",
                "valo_workspace_login can create objects in public",
                "valo_workspace_login can create schemas",
                "valo_workspace_login holds a privilege on public itself",
                "valo_workspace_login holds a privilege on public.valo_documents itself",
                "valo_workspace_scope holds a privilege on synthetic_phase1_canary outside public",
                "valo_workspace_login is a member of synthetic_phase1_canary",
                "valo_workspace_login uses its roles' privileges without becoming them",
                "valo_workspaces: valo_workspace_scope has select update(owner_identity_id) update(profile_revision), expected select update(profile_revision)",
              ].sort(),
            );
          } finally {
            await client.query("ROLLBACK");
          }
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
    const applyThrough = async (client, directory, tag, tracked) => {
      const prior = journal.entries.slice(
        0,
        journal.entries.findIndex((entry) => entry.tag === tag),
      );
      if (tracked)
        await migrate(drizzle(client), { migrationsFolder: await baselineFolder(directory, prior) });
      else
        await raw(
          client,
          prior.map((entry) => entry.tag),
        );
    };
    // Interrupted inside its transaction, a migration must leave rows and schema unchanged.
    const assertRollsBack = async (client, tag) => {
      const before = await rows(client),
        beforeSchema = await schema(client);
      await client.query("BEGIN");
      await raw(client, [tag]);
      await assert.rejects(client.query("SELECT 1/0"));
      await client.query("ROLLBACK");
      assert.deepEqual(await rows(client), before);
      assert.deepEqual(await schema(client), beforeSchema);
      return before;
    };
    const applyFor = async (client, tag, tracked) => {
      if (tracked) await migrate(drizzle(client), { migrationsFolder: folder });
      else {
        await client.query("BEGIN");
        await raw(client, [tag]);
        await client.query("COMMIT");
      }
    };
    for (const tracked of [true, false])
      await t.test(
        `0036 to 0037 ${tracked ? "tracked" : "unjournalled"} source correction migration keeps rows and makes safety audit append-only`,
        async () =>
          cluster(async (client, directory) => {
            await applyThrough(client, directory, sourceControlsMigration, tracked);
            await seed(client);
            const before = await assertRollsBack(client, sourceControlsMigration);
            await applyFor(client, sourceControlsMigration, tracked);
            assert.deepEqual(await rows(client), before);
            const assignment = randomUUID(),
              audit = randomUUID();
            await client.query(
              "INSERT INTO valo_staff_assignments(id,identity_id,role,granted_by,reason) VALUES($1,'synthetic-source-operator','support','synthetic-migration','Migration fixture assignment')",
              [assignment],
            );
            await client.query(
              "INSERT INTO valo_safety_control_audit(id,request_key,actor_id,assignment_id,area,action,target,reason,previous,current,payload_hash) VALUES($1,$2,'synthetic-source-operator',$3,'system','pause_service','ai','Migration fixture pause','{}','{}','fixture')",
              [audit, randomUUID(), assignment],
            );
            await assert.rejects(
              client.query("UPDATE valo_safety_control_audit SET reason='changed' WHERE id=$1", [audit]),
              /append only/,
            );
            await assert.rejects(
              client.query("DELETE FROM valo_safety_control_audit WHERE id=$1", [audit]),
              /append only/,
            );
          }),
      );
    for (const tracked of [true, false])
      await t.test(
        `0037 to 0038 ${tracked ? "tracked" : "unjournalled"} lifecycle migration keeps snapshots append-only and adds a read-only reviewer role`,
        async () =>
          cluster(async (client, directory) => {
            await applyThrough(client, directory, lifecycleMigration, tracked);
            await seed(client);
            const snapshot = randomUUID();
            await client.query(
              "INSERT INTO valo_source_snapshots(id,source_id,url,attempted_at,status,extraction_version,metadata) VALUES($1,'S01','https://example.invalid/synthetic-source',now(),'held_test_fixture','synthetic-fixture','{}')",
              [snapshot],
            );
            const before = await assertRollsBack(client, lifecycleMigration);
            const role = async () =>
              (
                await client.query(
                  "SELECT count(*)::int AS n FROM pg_roles WHERE rolname='valo_content_reviewer_dev'",
                )
              ).rows[0].n;
            assert.equal(await role(), 0, "the interrupted migration created no role");
            await applyFor(client, lifecycleMigration, tracked);
            assert.deepEqual(await rows(client), before);
            await assert.rejects(
              client.query("UPDATE valo_source_snapshots SET status='changed' WHERE id=$1", [snapshot]),
              /append-only/,
            );
            await assert.rejects(
              client.query("DELETE FROM valo_source_snapshots WHERE id=$1", [snapshot]),
              /append-only/,
            );
            assert.equal(await role(), 1);
            const privileges = await client.query(
              "SELECT has_table_privilege('valo_content_reviewer_dev','valo_content_versions','SELECT') AS read, has_table_privilege('valo_content_reviewer_dev','valo_content_versions','UPDATE') AS update_content, has_table_privilege('valo_content_reviewer_dev','valo_publication_policies','UPDATE') AS update_policy",
            );
            assert.deepEqual(privileges.rows[0], { read: true, update_content: false, update_policy: false });
          }),
      );
    for (const tracked of [true, false])
      await t.test(
        `0038 to 0039 ${tracked ? "tracked" : "unjournalled"} support migration opens one case per retained request and keeps case history append-only`,
        async () =>
          cluster(async (client, directory) => {
            await applyThrough(client, directory, supportMigration, tracked);
            await seed(client);
            const [kept, erased, ticket, erasedTicket, access] = Array.from({ length: 5 }, () =>
              randomUUID(),
            );
            await client.query(
              "INSERT INTO valo_workspaces(id,owner_identity_id) VALUES($1,'synthetic-support-kept'),($2,'synthetic-support-erased')",
              [kept, erased],
            );
            await client.query(
              `INSERT INTO valo_support_tickets(id,workspace_id,category,scope,contact_email,sharing_consent,consent_version)
              VALUES($1,$2,'support','Synthetic retained support request','synthetic@example.invalid',false,'service-sharing-v1'),
              ($3,$4,'support','Synthetic request in an erased workspace','synthetic@example.invalid',false,'service-sharing-v1')`,
              [ticket, kept, erasedTicket, erased],
            );
            await client.query(
              "INSERT INTO valo_privacy_tombstones(id,workspace_id,case_id,identity_hash,phase) VALUES($1,$2,$3,$4,'synthetic-quarantine-only')",
              [randomUUID(), erased, randomUUID(), hash("synthetic-erased-identity")],
            );
            await client.query(
              "INSERT INTO valo_access_support(id,idempotency_key,payload_hash,contact_email,topic,message,notice_version) VALUES($1,$2,$3,'synthetic@example.invalid','account_access','Synthetic account access request','synthetic-notice')",
              [access, randomUUID(), hash("synthetic-access-payload")],
            );
            const before = await assertRollsBack(client, supportMigration);
            await applyFor(client, supportMigration, tracked);
            assert.deepEqual(await rows(client), before);
            const cases = await client.query(
              "SELECT id,source_kind,ticket_id,access_id,workspace_id,status,assigned_to,version FROM valo_support_cases ORDER BY source_kind",
            );
            // Retained intake becomes open cases with the original identifiers; an erased
            // workspace's request gets none, and nothing is assigned, replied to or resolved.
            assert.deepEqual(cases.rows, [
              {
                id: access,
                source_kind: "access",
                ticket_id: null,
                access_id: access,
                workspace_id: null,
                status: "open",
                assigned_to: null,
                version: 1,
              },
              {
                id: ticket,
                source_kind: "workspace",
                ticket_id: ticket,
                access_id: null,
                workspace_id: kept,
                status: "open",
                assigned_to: null,
                version: 1,
              },
            ]);
            const event = randomUUID();
            await client.query(
              "INSERT INTO valo_support_events(id,case_id,actor_id,action) VALUES($1,$2,'synthetic-support-staff','staff_replied')",
              [event, ticket],
            );
            await assert.rejects(
              client.query("UPDATE valo_support_events SET action='changed' WHERE id=$1", [event]),
              /append only/,
            );
            await assert.rejects(
              client.query("DELETE FROM valo_support_events WHERE id=$1", [event]),
              /append only/,
            );
          }),
      );
    // Key and index definitions without their names, so a rename leaves them unchanged.
    const unnamedDefinitions = async (client) =>
      (
        await client.query(`SELECT c.relname||' '||k.contype::text||' '||pg_get_constraintdef(k.oid,true) AS definition
          FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='public'
          UNION ALL SELECT regexp_replace(indexdef,'^CREATE (UNIQUE )?INDEX \\S+ ON','CREATE \\1INDEX ON')
          FROM pg_indexes WHERE schemaname='public' ORDER BY 1`)
      ).rows.map((row) => row.definition);
    for (const tracked of [true, false])
      await t.test(
        `0039 to the constraint names migration ${tracked ? "tracked" : "unjournalled"} renames keys to the snapshot names and changes nothing else`,
        async () =>
          cluster(async (client, directory) => {
            await applyThrough(client, directory, namesMigration, tracked);
            const ids = await seed(client),
              snapshot = await latestSnapshot(folder);
            // Row security, the table of keys its credentials are checked with, the security
            // signals table, the price change log and the prepared candidates arrive with later
            // migrations; this one is about every other object.
            const later = (d) =>
              /: (?:policy |row security)/.test(d) ||
              /^valo_scope_keys[ :]|ON public\.valo_scope_keys /.test(d) ||
              /^valo_security_signals[ :]|ON public\.valo_security_signals /.test(d) ||
              /^valo_price_changes[ :]|ON public\.valo_price_changes /.test(d) ||
              /^valo_prepared_candidates[ :]|ON public\.valo_prepared_candidates /.test(d);
            const keyDifferences = async () =>
              (await snapshotDifferences(client, snapshot)).filter((d) => !later(d));
            const ownDefinitions = async () => (await unnamedDefinitions(client)).filter((d) => !later(d));
            const definitions = await ownDefinitions(),
              renamed = (await keyDifferences()).length;
            assert.ok(renamed > 0, "the database before the migration uses other names");
            const before = await assertRollsBack(client, namesMigration);
            await applyFor(client, namesMigration, tracked);
            assert.deepEqual(await rows(client), before);
            assert.deepEqual(await ownDefinitions(), definitions);
            assert.deepEqual(await keyDifferences(), []);
            if (!tracked) {
              await client.query("BEGIN");
              await raw(client, journalTagsFrom(namesMigration).slice(1));
              await client.query("COMMIT");
            }
            assert.deepEqual(await schema(client), finalSchema);
            // Renamed keys still hold, and their errors now carry the snapshot names.
            await assert.rejects(
              client.query(
                `INSERT INTO valo_orders(id,workspace_id,requested_by,reference,request_key,price_id,line,amount_kobo)
                SELECT gen_random_uuid(),gen_random_uuid(),'synthetic-phase1-owner','synthetic-unknown-workspace',
                  gen_random_uuid(),price_id,line,amount_kobo FROM valo_orders WHERE id=$1`,
                [ids.order],
              ),
              /valo_orders_workspace_id_valo_workspaces_id_fk/,
            );
            await assert.rejects(
              client.query(
                `INSERT INTO valo_workspace_exports(id,workspace_id,requester_id,request_key,status,expires_at)
                SELECT gen_random_uuid(),workspace_id,requester_id,request_key,'cancelled',expires_at
                FROM valo_workspace_exports WHERE id=$1`,
                [ids.job],
              ),
              /valo_workspace_export_request/,
            );
            if (tracked) {
              const ledger = (await client.query("SELECT * FROM drizzle.__drizzle_migrations ORDER BY id"))
                .rows;
              assert.equal(ledger.length, journal.entries.length);
            } else {
              assert.equal(
                (await client.query("SELECT to_regclass('drizzle.__drizzle_migrations') AS ledger")).rows[0]
                  .ledger,
                null,
              );
              await assert.rejects(
                client.query(await readFile(join(folder, namesMigration + ".sql"), "utf8")),
                /does not exist/,
              );
            }
          }),
      );
    for (const tracked of [true, false])
      await t.test(
        `constraint names to the row security migration ${tracked ? "tracked" : "unjournalled"} keeps rows and limits the scoped role to one workspace`,
        async () =>
          cluster(async (client, directory) => {
            await applyThrough(client, directory, securityMigration, tracked);
            const ids = await seed(client);
            const role = async () =>
              (
                await client.query(
                  "SELECT count(*)::int AS n FROM pg_roles WHERE rolname IN ('valo_workspace_scope','valo_workspace_login')",
                )
              ).rows[0].n;
            const before = await assertRollsBack(client, securityMigration);
            assert.equal(await role(), 0, "the interrupted migration created no role");
            await applyFor(client, securityMigration, tracked);
            assert.deepEqual(await rows(client), before);
            if (!tracked) {
              await client.query("BEGIN");
              await raw(client, journalTagsFrom(securityMigration).slice(1));
              await client.query("COMMIT");
            }
            assert.deepEqual(await schema(client), finalSchema);
            assert.deepEqual(await rowSecurityGaps(client), []);
            // The existing rows are visible to the scoped role only in their own workspace.
            const visible = async (workspaceId) => {
              await client.query("BEGIN");
              try {
                await enterWorkspaceScope(client, workspaceId);
                return (
                  await client.query(
                    "SELECT (SELECT count(*) FROM valo_orders)::int AS orders,(SELECT count(*) FROM valo_dispute_actions)::int AS actions",
                  )
                ).rows[0];
              } finally {
                await client.query("ROLLBACK");
              }
            };
            assert.deepEqual(await visible(ids.workspace), { orders: 1, actions: 1 });
            assert.deepEqual(await visible(randomUUID()), { orders: 0, actions: 0 });
            // The role holds only what customer requests use: a staff table is refused, a row
            // it may lock cannot be changed, and the AI limits still count every workspace.
            await client.query(
              `INSERT INTO valo_ai_drafts(id,workspace_id,actor_id,idempotency_key,input_hash,task,status,prompt_version,budget_reserved,preview)
              VALUES($1,$2,'synthetic-phase1-owner',$3,$4,'invoice','manual_fallback','phase1',true,'{}')`,
              [randomUUID(), ids.workspace, randomUUID(), "0".repeat(64)],
            );
            const scoped = async (workspaceId, statement, values = []) => {
              await client.query("BEGIN");
              try {
                await enterWorkspaceScope(client, workspaceId);
                return (await client.query(statement, values)).rows;
              } finally {
                await client.query("ROLLBACK");
              }
            };
            await assert.rejects(
              scoped(ids.workspace, "SELECT count(*) FROM valo_staff_assignments"),
              /permission denied for table valo_staff_assignments/,
            );
            assert.equal(
              (await scoped(ids.workspace, "SELECT id FROM valo_prices WHERE id=$1 FOR SHARE", [ids.price]))
                .length,
              1,
            );
            await assert.rejects(
              scoped(ids.workspace, "UPDATE valo_prices SET title=title WHERE id=$1", [ids.price]),
              /may lock rows of valo_prices but not change them/,
            );
            assert.deepEqual(
              await scoped(
                randomUUID(),
                "SELECT * FROM valo_customer_ai_reservations(now()-interval '1 day',now()-interval '1 minute','synthetic-phase1-owner')",
              ),
              [{ global_today: 1, identity_last_minute: 1 }],
            );
            // The workspace comes only from a credential the application signed for this
            // transaction: a forged one, the setting alone, or a genuine credential from an
            // earlier transaction shows no workspace's rows.
            const forged = async (credential) => {
              await client.query("BEGIN");
              try {
                await client.query(
                  "SELECT set_config('valo.workspace_credential',$1,true),set_config('role','valo_workspace_scope',true)",
                  [credential],
                );
                return (await client.query("SELECT count(*)::int AS n FROM valo_orders")).rows[0].n;
              } finally {
                await client.query("ROLLBACK");
              }
            };
            assert.equal(await forged(`${ids.workspace}:${randomUUID()}:${"0".repeat(64)}`), 0);
            assert.equal(await forged(ids.workspace), 0);
            await client.query("BEGIN");
            await enterWorkspaceScope(client, ids.workspace);
            const genuine = (
              await client.query(
                "SELECT current_setting('valo.workspace_credential') AS credential,(SELECT count(*) FROM valo_orders)::int AS n",
              )
            ).rows[0];
            assert.equal(genuine.n, 1);
            await client.query("COMMIT");
            assert.equal(
              await forged(genuine.credential),
              0,
              "a credential is refused in another transaction",
            );
          }),
      );
    for (const tracked of [true, false])
      await t.test(
        `row security to the security signals migration ${tracked ? "tracked" : "unjournalled"} keeps rows and gives the scoped role nothing`,
        async () =>
          cluster(async (client, directory) => {
            await applyThrough(client, directory, signalsMigration, tracked);
            const ids = await seed(client);
            const table = async () =>
              (await client.query("SELECT to_regclass('valo_security_signals') AS t")).rows[0].t;
            const before = await assertRollsBack(client, signalsMigration);
            assert.equal(await table(), null, "the interrupted migration created no table");
            await applyFor(client, signalsMigration, tracked);
            assert.deepEqual(await rows(client), before);
            if (!tracked) {
              await client.query("BEGIN");
              await raw(client, journalTagsFrom(signalsMigration).slice(1));
              await client.query("COMMIT");
            }
            assert.deepEqual(await schema(client), finalSchema);
            assert.deepEqual(await rowSecurityGaps(client), []);
            // The application role counts signals; the checks refuse any other kind or subject.
            const insert = (kind, subject) =>
              client.query(
                `INSERT INTO valo_security_signals(kind,subject_hash,window_started_at,count,expires_at)
                VALUES($1,$2,date_trunc('minute',now()),1,now()+interval '1 day')`,
                [kind, subject],
              );
            await insert("denied_access", "a".repeat(64));
            await insert("signature_failure", "b".repeat(64));
            await assert.rejects(insert("sign_in", "c".repeat(64)), /valo_security_signals_kind_check/);
            await assert.rejects(
              insert("denied_access", "203.0.113.7"),
              /valo_security_signals_subject_hash_check/,
            );
            // A customer request's scoped role can neither read nor write them.
            const scoped = async (statement, values = []) => {
              await client.query("BEGIN");
              try {
                await enterWorkspaceScope(client, ids.workspace);
                return (await client.query(statement, values)).rows;
              } finally {
                await client.query("ROLLBACK");
              }
            };
            await assert.rejects(
              scoped("SELECT count(*) FROM valo_security_signals"),
              /permission denied for table valo_security_signals/,
            );
            await assert.rejects(
              scoped(
                `INSERT INTO valo_security_signals(kind,subject_hash,window_started_at,count,expires_at)
                VALUES('denied_access',$1,now(),1,now())`,
                ["d".repeat(64)],
              ),
              /permission denied for table valo_security_signals/,
            );
          }),
      );
    for (const tracked of [true, false])
      await t.test(
        `security signals to the price change log migration ${tracked ? "tracked" : "unjournalled"} logs existing prices, versions prices and gives the scoped role nothing`,
        async () =>
          cluster(async (client, directory) => {
            await applyThrough(client, directory, priceLogMigration, tracked);
            const ids = await seed(client);
            const table = async () =>
              (await client.query("SELECT to_regclass('valo_price_changes') AS t")).rows[0].t;
            const before = await assertRollsBack(client, priceLogMigration);
            assert.equal(await table(), null, "the interrupted migration created no table");
            await applyFor(client, priceLogMigration, tracked);
            assert.deepEqual(await rows(client), before);
            if (!tracked) {
              await client.query("BEGIN");
              await raw(client, journalTagsFrom(priceLogMigration).slice(1));
              await client.query("COMMIT");
            }
            assert.deepEqual(await schema(client), finalSchema);
            assert.deepEqual(await rowSecurityGaps(client), []);
            const log = async (priceId) =>
              (
                await client.query(
                  "SELECT action, price->>'amount_kobo' AS amount, price->>'effective_to' IS NOT NULL AS closed FROM valo_price_changes WHERE price_id=$1 ORDER BY changed_at, action",
                  [priceId],
                )
              ).rows.map((r) => [r.action, Number(r.amount), r.closed]);
            // The price that existed before the migration is in the log, unchanged.
            assert.deepEqual(await log(ids.price), [["existing", 100, false]]);
            // Its terms never change in place, and it is closed once, not backdated.
            for (const change of [
              "amount_kobo=200",
              "title='Changed title'",
              "effective_from=now()-interval '1 day'",
            ])
              await assert.rejects(
                client.query(`UPDATE valo_prices SET ${change} WHERE id=$1`, [ids.price]),
                /Price terms never change in place/,
                change,
              );
            await assert.rejects(
              client.query("UPDATE valo_prices SET effective_to=now()-interval '1 hour' WHERE id=$1", [
                ids.price,
              ]),
              /closed once, from now or later/,
            );
            await client.query("UPDATE valo_prices SET effective_to=now()+interval '1 hour' WHERE id=$1", [
              ids.price,
            ]);
            await assert.rejects(
              client.query("UPDATE valo_prices SET effective_to=now()+interval '2 hours' WHERE id=$1", [
                ids.price,
              ]),
              /closed once, from now or later/,
            );
            // A new price is a new row, and every insert, close and delete is logged.
            const next = randomUUID();
            await client.query(
              `INSERT INTO valo_prices(id,content_version_id,title,amount_kobo,licence_version,licence_text,tax_treatment,approval_reference,effective_from)
              VALUES($1,$2,'Synthetic migration fixture',150,'synthetic','Not a sales licence','No tax assertion','SYNTHETIC-NOT-APPROVED',now()+interval '1 hour')`,
              [next, ids.content],
            );
            await client.query("DELETE FROM valo_prices WHERE id=$1", [next]);
            assert.deepEqual(await log(ids.price), [
              ["existing", 100, false],
              ["closed", 100, true],
            ]);
            assert.deepEqual(await log(next), [
              ["created", 150, false],
              ["deleted", 150, false],
            ]);
            // The order keeps its own amount, and the price it was made under stays.
            await assert.rejects(
              client.query("DELETE FROM valo_prices WHERE id=$1", [ids.price]),
              /foreign key/,
            );
            assert.equal(
              (await client.query("SELECT amount_kobo FROM valo_orders WHERE id=$1", [ids.order])).rows[0]
                .amount_kobo,
              100,
            );
            // The log itself is append-only.
            await assert.rejects(
              client.query("UPDATE valo_price_changes SET action='created'"),
              /append-only/,
            );
            await assert.rejects(client.query("DELETE FROM valo_price_changes"), /append-only/);
            await assert.rejects(client.query("TRUNCATE valo_price_changes"), /cannot be truncated/);
            // A customer request's scoped role can neither read nor write it.
            const scoped = async (statement, values = []) => {
              await client.query("BEGIN");
              try {
                await enterWorkspaceScope(client, ids.workspace);
                return (await client.query(statement, values)).rows;
              } finally {
                await client.query("ROLLBACK");
              }
            };
            await assert.rejects(
              scoped("SELECT count(*) FROM valo_price_changes"),
              /permission denied for table valo_price_changes/,
            );
          }),
      );
    for (const tracked of [true, false])
      await t.test(
        `price change log to the prepared candidates migration ${tracked ? "tracked" : "unjournalled"} lets the drafter role only read and add rows and gives the scoped role nothing`,
        async () =>
          cluster(async (client, directory) => {
            await applyThrough(client, directory, preparedMigration, tracked);
            const ids = await seed(client);
            const table = async () =>
              (await client.query("SELECT to_regclass('valo_prepared_candidates') AS t")).rows[0].t;
            const before = await assertRollsBack(client, preparedMigration);
            assert.equal(await table(), null, "the interrupted migration created no table");
            await applyFor(client, preparedMigration, tracked);
            assert.deepEqual(await rows(client), before);
            if (!tracked) {
              await client.query("BEGIN");
              await raw(client, journalTagsFrom(preparedMigration).slice(1));
              await client.query("COMMIT");
            }
            assert.deepEqual(await schema(client), finalSchema);
            assert.deepEqual(await rowSecurityGaps(client), []);
            const insert = `INSERT INTO valo_prepared_candidates
              (artifact_id,artifact_hash,version_id,template_id,version,candidate_hash,prepared_at,review_by)
              VALUES($1,$2,$3,'TPL-07',1,$4,now(),now()+interval '30 days') RETURNING artifact_id`;
            const values = () => [randomUUID(), "a".repeat(64), randomUUID(), "b".repeat(64)];
            const as = async (role, statement, parameters = []) => {
              await client.query("BEGIN");
              try {
                await client.query(`SET LOCAL ROLE ${role}`);
                return (await client.query(statement, parameters)).rows;
              } finally {
                await client.query("ROLLBACK");
              }
            };
            // The preparer's drafter role reads and adds rows, and can change or remove none.
            assert.equal((await as("valo_content_drafter_dev", insert, values())).length, 1);
            assert.equal(
              (
                await as(
                  "valo_content_drafter_dev",
                  "SELECT count(*)::int AS n FROM valo_prepared_candidates",
                )
              )[0].n,
              0,
            );
            for (const statement of [
              "UPDATE valo_prepared_candidates SET version=2",
              "DELETE FROM valo_prepared_candidates",
            ])
              await assert.rejects(
                as("valo_content_drafter_dev", statement),
                /permission denied for table valo_prepared_candidates/,
                statement,
              );
            // The publisher role has no use for it and gets nothing.
            await assert.rejects(
              as("valo_content_publisher_dev", "SELECT count(*) FROM valo_prepared_candidates"),
              /permission denied for table valo_prepared_candidates/,
            );
            // Hashes are 64 hex characters, versions positive, and a version ID is named once.
            const [artifact, , versionId, candidate] = values();
            await assert.rejects(
              client.query(insert, [artifact, "short", versionId, candidate]),
              /valo_prepared_candidates_artifact_hash_check/,
            );
            await assert.rejects(
              client.query(insert, [artifact, "a".repeat(64), versionId, "short"]),
              /valo_prepared_candidates_candidate_hash_check/,
            );
            await client.query(insert, [artifact, "a".repeat(64), versionId, candidate]);
            await assert.rejects(
              client.query(insert, [randomUUID(), "c".repeat(64), versionId, candidate]),
              /valo_prepared_candidates_version_id_unique/,
            );
            // A customer request's scoped role can neither read nor write it.
            const scoped = async (statement, parameters = []) => {
              await client.query("BEGIN");
              try {
                await enterWorkspaceScope(client, ids.workspace);
                return (await client.query(statement, parameters)).rows;
              } finally {
                await client.query("ROLLBACK");
              }
            };
            await assert.rejects(
              scoped("SELECT count(*) FROM valo_prepared_candidates"),
              /permission denied for table valo_prepared_candidates/,
            );
            await assert.rejects(
              scoped(insert, values()),
              /permission denied for table valo_prepared_candidates/,
            );
          }),
      );
    for (const tracked of [true, false])
      await t.test(
        `prepared candidates to the publisher login migration ${tracked ? "tracked" : "unjournalled"} lets a version be published only by a session that logged in as the publisher`,
        async () =>
          cluster(async (client, directory) => {
            await applyThrough(client, directory, publisherLoginMigration, tracked);
            await seed(client);
            const login = async () =>
              (
                await client.query(
                  "SELECT rolcanlogin,rolinherit,rolsuper,rolcreaterole,rolcreatedb,rolbypassrls FROM pg_roles WHERE rolname='valo_publisher_login'",
                )
              ).rows[0];
            const before = await assertRollsBack(client, publisherLoginMigration);
            assert.equal(await login(), undefined, "the interrupted migration created no login");
            await applyFor(client, publisherLoginMigration, tracked);
            assert.deepEqual(await rows(client), before);
            if (!tracked) {
              await client.query("BEGIN");
              await raw(client, journalTagsFrom(publisherLoginMigration).slice(1));
              await client.query("COMMIT");
            }
            assert.deepEqual(await schema(client), finalSchema);
            assert.deepEqual(await rowSecurityGaps(client), []);
            // The login is created unable to log in, inherits nothing, and may become the publisher
            // role and no other.
            assert.deepEqual(await login(), {
              rolcanlogin: false,
              rolinherit: false,
              rolsuper: false,
              rolcreaterole: false,
              rolcreatedb: false,
              rolbypassrls: false,
            });
            assert.deepEqual(
              (
                await client.query(
                  "SELECT r.rolname FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid JOIN pg_roles u ON u.oid=m.member WHERE u.rolname='valo_publisher_login'",
                )
              ).rows.map((row) => row.rolname),
              ["valo_content_publisher_dev"],
            );
            // A synthetic candidate that passed no gate: only the database's own rule is under test.
            const version = randomUUID(),
              policy = `synthetic-publisher-login-${version}`;
            await client.query(
              "INSERT INTO valo_publication_policies(id,hash,policy,authority) VALUES($1,'synthetic','{}','{}')",
              [policy],
            );
            await client.query(
              `INSERT INTO valo_content_versions(id,template_id,version,slug,policy_id,candidate_hash,bundle,attestations,review_by)
               VALUES($1,$2,1,$2,$2,'synthetic','{}','{}',now()+interval '30 days')`,
              [version, policy],
            );
            const publish =
              "UPDATE valo_content_versions SET status='published',published_at=now() WHERE id=$1";
            const status = async () =>
              (await client.query("SELECT status FROM valo_content_versions WHERE id=$1", [version])).rows[0]
                .status;
            // This session logged in as the cluster's owner. It cannot publish the candidate, as
            // itself or as the publisher role.
            const refused = /published only by a session that logged in as valo_publisher_login/;
            await assert.rejects(client.query(publish, [version]), refused);
            await client.query("BEGIN");
            await client.query("SET LOCAL ROLE valo_content_publisher_dev");
            await assert.rejects(client.query(publish, [version]), refused);
            await client.query("ROLLBACK");
            assert.equal(await status(), "candidate");
            // A session that logged in as the publisher can, as the publisher role only.
            await client.query("ALTER ROLE valo_publisher_login LOGIN");
            const publisher = new pg.Client({
              host: "127.0.0.1",
              port: client.port,
              user: "valo_publisher_login",
              database: "postgres",
              connectionTimeoutMillis: 5000,
            });
            await publisher.connect();
            try {
              await assert.rejects(publisher.query(publish, [version]), /permission denied/);
              await assert.rejects(
                publisher.query("SET ROLE valo_content_drafter_dev"),
                /permission denied to set role/,
              );
              await publisher.query("BEGIN");
              await publisher.query("SET LOCAL ROLE valo_content_publisher_dev");
              await publisher.query(publish, [version]);
              await assert.rejects(
                publisher.query("SELECT count(*) FROM valo_documents"),
                /permission denied for table valo_documents/,
              );
              // Rolled back: the synthetic candidate is never left published.
              await publisher.query("ROLLBACK");
              const regulatory = randomUUID();
              await client.query(
                `INSERT INTO valo_content_versions(id,template_id,version,slug,policy_id,candidate_hash,bundle,attestations,review_by)
                  VALUES($1,$2,1,$2,$3,'synthetic',$4,'{}',now()+interval '30 days')`,
                [
                  regulatory,
                  "synthetic-regulatory-" + regulatory,
                  policy,
                  JSON.stringify({ candidate: { contentClass: "sourced_guidance" } }),
                ],
              );
              await publisher.query("BEGIN");
              await publisher.query("SET LOCAL ROLE valo_content_publisher_dev");
              await assert.rejects(publisher.query(publish, [regulatory]), /Owner source check required/);
              await publisher.query("ROLLBACK");
            } finally {
              await publisher.end();
            }
            assert.equal(await status(), "candidate");
            // Holding takes content away, and stays open to the application's login.
            await client.query("UPDATE valo_content_versions SET status='held' WHERE id=$1", [version]);
            assert.equal(await status(), "held");
          }),
      );
    for (const tracked of [true, false])
      await t.test(
        `manual library upgrade preserves data and rolls back cleanly (tracked=${tracked})`,
        async () =>
          cluster(async (client, directory) => {
            await applyThrough(client, directory, manualLibraryMigration, tracked);
            await seed(client);
            const before = await assertRollsBack(client, manualLibraryMigration);
            await applyFor(client, manualLibraryMigration, tracked);
            assert.deepEqual(await rows(client), before);
            assert.deepEqual(await schema(client), finalSchema);
            assert.equal(
              (await client.query("SELECT count(*)::int AS n FROM valo_manual_library")).rows[0].n,
              0,
            );
            for (const role of [
              "valo_workspace_login",
              "valo_content_publisher_dev",
              "valo_content_drafter_dev",
            ])
              assert.equal(
                (
                  await client.query(
                    "SELECT has_table_privilege($1,'valo_manual_library','SELECT') AS allowed",
                    [role],
                  )
                ).rows[0].allowed,
                false,
              );
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
        sourceControlsUpgradeFrom0036: true,
        lifecycleUpgradeFrom0037: true,
        supportUpgradeFrom0038: true,
        constraintNamesUpgradeFrom0039: true,
        keysChecksAndIndexesMatchSnapshot: true,
        rowSecurityUpgradeFromConstraintNames: true,
        workspaceRowSecurity: true,
        securitySignalsUpgradeFromRowSecurity: true,
        priceChangeLogUpgradeFromSecuritySignals: true,
        preparedCandidatesUpgradeFromPriceChangeLog: true,
        nativeDatabaseTouched: false,
      }),
    );
  },
);
