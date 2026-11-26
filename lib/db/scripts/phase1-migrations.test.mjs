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
const manualRegulatoryMigration = "20261122160736_manual_regulatory_source_signoff";
const premiumTemplatesMigration = "20261122183800_manual_premium_templates";
const hotTableIndexesMigration = "20261123072608_hot_table_indexes";
const manualPacksMigration = "20261123165814_manual_industry_packs";
const ruleOwnerSignoffsMigration = "20261123184636_rule_owner_signoffs";
const formPurchasesMigration = "20261124163621_form_template_purchases";
const formTextMigration = "20261124171830_manual_form_text";
const documentFormsMigration = "20261124175837_document_forms";
const premiumFormDocumentsMigration = "20261124203124_premium_form_documents";
const exportFinishedFilesMigration = "20261124221556_export_finished_files";
const libraryEntryDetailsMigration = "20261124232729_library_entry_details";
const librarySavesCopiesMigration = "20261125000142_library_saves_and_copies";
const documentEditionsMigration = "20261125005307_document_editions";
const editionPurchasesMigration = "20261125010627_edition_purchases";
const editionNoticesMigration = "20261125012048_edition_notices";
const ruleChangesMigration = "20261125084317_rule_changes";
const ruleChangeNoticesMigration = "20261125090832_rule_change_notices";
const manualRegulatoryWordsMigration = "20261125112436_manual_regulatory_words";
const manualReviewsMigration = "20261125122001_manual_reviews";
const manualChangesMigration = "20261125132218_manual_changes";
const manualReachMigration = "20261125134530_manual_reach";
const manualHoldsMigration = "20261125140207_manual_holds";
const libraryEscalationsMigration = "20261125145208_library_escalations";
const guidanceRecordMigration = "20261125153830_guidance_record";
const sourceRegisterMigration = "20261125164717_source_register";
const sourceWatchStopsMigration = "20261125171850_source_watch_stops";
const sourceReviewOwnersMigration = "20261125174829_source_review_owners";
const sourceReviewPreparationsMigration = "20261125183409_source_review_preparations";
const acceptanceReviewsMigration = "20261125191813_acceptance_reviews";
const acceptanceRunsMigration = "20261125201543_acceptance_runs";
const staffAccessObjectMigration = "20261125221340_staff_access_object";
const auditHistoryGuardsMigration = "20261125221351_audit_history_guards";
const staffAccessReadingIndexMigration = "20261125224750_staff_access_reading_index";
const historyDigestsMigration = "20261125230026_history_digests";
const historyDigestTriggersMigration = "20261125230122_history_digest_triggers";
const historyDigestReseedMigration = "20261126001058_history_digest_reseed";
const priceCarriesMigration = "20261126001634_price_carries";
const priceCarryOnReleaseMigration = "20261126001834_price_carry_on_release";
const commercialSettingsMigration = "20261126005336_commercial_settings";
const commercialSettingGuardsMigration = "20261126005419_commercial_setting_guards";
const orderAccessRuleMigration = "20261126014905_order_access_rule";
const orderAccessRuleGuardsMigration = "20261126014911_order_access_rule_guards";
const orderTermsMigration = "20261126023013_order_terms";
const bundlesMigration = "20261126025626_bundles";
const bundleGuardsMigration = "20261126025633_bundle_guards";
const bundleOrdersMigration = "20261126032901_bundle_orders";
const bundleOrderGuardsMigration = "20261126032944_bundle_order_guards";
const replacedReviewedVersionsMigration = "20261126041618_replaced_reviewed_versions";
const reviewedGuideChecksMigration = "20261126043629_reviewed_guide_checks";
const reviewedGuideCheckGuardsMigration = "20261126043631_reviewed_guide_check_guards";
const consentChangesMigration = "20261126064714_consent_changes";
const consentChangeGrantsMigration = "20261126064724_consent_change_grants";
const privacyHoldsMigration = "20261126091824_privacy_holds";
const privacyHoldGuardsMigration = "20261126091827_privacy_hold_guards";
const operationalAlertsMigration = "20261126125400_operational_alerts";
const operationalAlertGuardsMigration = "20261126125423_operational_alert_guards";
const requestMinutesMigration = "20261126134418_request_minutes";
const securitySignalKindsMigration = "20261126141258_security_signal_guard_refusal";
const securitySignalLimitsMigration = "20261126142600_security_signal_limits_and_input";
const drafterLoginMigration = "20261126151429_drafter_login";
const reviewerLoginMigration = "20261126160415_reviewer_login";
// A template is released only with its entry details, since the library entries migration
// (docs/architecture/library-entries.md). An upgrade test that releases a template after every later
// migration has run gives them, as an editor would.
const releaseDetails = {
  columns: ",purpose,limits,ai_drafted",
  values: ",'Synthetic purpose','Synthetic limits',true",
};
// A version that follows an earlier release is released only with what changed, since the manual changes
// migration (docs/architecture/guidance-currency.md, slice 3). An upgrade test that releases such a
// version after every later migration has run writes the note first, as the staff library does, and the
// notice that the earlier edition was replaced carries it.
const changeNote = "Synthetic: what changed in this version, as its readers see it.";
const noteChange = (client, edition, recordedBy) =>
  client.query("INSERT INTO valo_manual_changes(edition,note,recorded_by) VALUES($1,$2,$3)", [
    edition,
    changeNote,
    recordedBy,
  ]);
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
  manualRegulatoryMigration,
  premiumTemplatesMigration,
  hotTableIndexesMigration,
  manualPacksMigration,
  ruleOwnerSignoffsMigration,
  formPurchasesMigration,
  formTextMigration,
  documentFormsMigration,
  premiumFormDocumentsMigration,
  exportFinishedFilesMigration,
  libraryEntryDetailsMigration,
  librarySavesCopiesMigration,
  documentEditionsMigration,
  editionPurchasesMigration,
  editionNoticesMigration,
  ruleChangesMigration,
  ruleChangeNoticesMigration,
  manualRegulatoryWordsMigration,
  manualReviewsMigration,
  manualChangesMigration,
  manualReachMigration,
  manualHoldsMigration,
  libraryEscalationsMigration,
  guidanceRecordMigration,
  sourceRegisterMigration,
  sourceWatchStopsMigration,
  sourceReviewOwnersMigration,
  sourceReviewPreparationsMigration,
  acceptanceReviewsMigration,
  acceptanceRunsMigration,
  staffAccessObjectMigration,
  auditHistoryGuardsMigration,
  staffAccessReadingIndexMigration,
  historyDigestsMigration,
  historyDigestTriggersMigration,
  historyDigestReseedMigration,
  priceCarriesMigration,
  priceCarryOnReleaseMigration,
  commercialSettingsMigration,
  commercialSettingGuardsMigration,
  orderAccessRuleMigration,
  orderAccessRuleGuardsMigration,
  orderTermsMigration,
  bundlesMigration,
  bundleGuardsMigration,
  bundleOrdersMigration,
  bundleOrderGuardsMigration,
  replacedReviewedVersionsMigration,
  reviewedGuideChecksMigration,
  reviewedGuideCheckGuardsMigration,
  consentChangesMigration,
  consentChangeGrantsMigration,
  privacyHoldsMigration,
  privacyHoldGuardsMigration,
  operationalAlertsMigration,
  operationalAlertGuardsMigration,
  requestMinutesMigration,
  securitySignalKindsMigration,
  securitySignalLimitsMigration,
  drafterLoginMigration,
  reviewerLoginMigration,
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
/**
 * Runs one statement that adds content as drafting does, in a transaction of its own that it commits.
 * Since the drafter login migration, the database adds a content version or a prepared candidate only
 * in a session that logged in as valo_drafter_login, as the drafter role: this cluster's owner is a
 * superuser, so its session may become that login for the transaction. Before that migration the owner
 * adds content as it always could.
 */
async function drafting(client, statement, parameters = []) {
  const guarded = (
    await client.query("SELECT 1 FROM pg_trigger WHERE tgname = 'valo_version_requires_drafter_login'")
  ).rowCount;
  await client.query("BEGIN");
  try {
    if (guarded) {
      await client.query("SET LOCAL SESSION AUTHORIZATION valo_drafter_login");
      await client.query("SET LOCAL ROLE valo_content_drafter_dev");
    }
    const result = await client.query(statement, parameters);
    await client.query("COMMIT");
    return result;
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
  await drafting(
    client,
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
              : table === "valo_orders"
                ? ["carries_to_later_editions", "bundle_id"]
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
          // ADM-009: after every migration, over rows written before them, each history still matches its
          // digest. A migration that changes a history's columns reseeds its digest
          // (20261126001058_history_digest_reseed), or this fails.
          assert.deepEqual(
            (
              await client.query(
                "SELECT array_agg(name ORDER BY name) AS names FROM valo_history_digest_mismatches() AS name",
              )
            ).rows[0].names ?? [],
            [],
          );
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
              // The columns an access row had at 0031; each one added later has its own upgrade check.
              audit: (
                await client.query(
                  "SELECT id,assignment_id,actor_id,area,reason,created_at FROM valo_staff_access_audit ORDER BY id",
                )
              ).rows,
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
            const ids = await seed(client);
            // Check the rename against its own snapshot before applying later migrations
            // that legitimately add tables or change the targets of foreign keys.
            const snapshot = JSON.parse(
              await readFile(join(folder, "meta", namesMigration.split("_")[0] + "_snapshot.json"), "utf8"),
            );
            const definitions = await unnamedDefinitions(client),
              renamed = (await snapshotDifferences(client, snapshot)).length;
            assert.ok(renamed > 0, "the database before the migration uses other names");
            const before = await assertRollsBack(client, namesMigration);
            if (tracked) {
              const throughNames = journal.entries.slice(
                0,
                journal.entries.findIndex((entry) => entry.tag === namesMigration) + 1,
              );
              const migrationsFolder = await baselineFolder(join(directory, "renamed"), throughNames);
              await migrate(drizzle(client), { migrationsFolder });
            } else {
              await applyFor(client, namesMigration, false);
            }
            assert.deepEqual(await rows(client), before);
            assert.deepEqual(await unnamedDefinitions(client), definitions);
            assert.deepEqual(await snapshotDifferences(client, snapshot), []);
            if (tracked) {
              await migrate(drizzle(client), { migrationsFolder: folder });
            } else {
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
            // Since the drafter login migration the drafter role adds rows only from drafting's own
            // login, which this cluster's owner may become.
            const as = async (role, statement, parameters = []) => {
              await client.query("BEGIN");
              try {
                if (role === "valo_content_drafter_dev")
                  await client.query("SET LOCAL SESSION AUTHORIZATION valo_drafter_login");
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
              drafting(client, insert, [artifact, "short", versionId, candidate]),
              /valo_prepared_candidates_artifact_hash_check/,
            );
            await assert.rejects(
              drafting(client, insert, [artifact, "a".repeat(64), versionId, "short"]),
              /valo_prepared_candidates_candidate_hash_check/,
            );
            await drafting(client, insert, [artifact, "a".repeat(64), versionId, candidate]);
            await assert.rejects(
              drafting(client, insert, [randomUUID(), "c".repeat(64), versionId, candidate]),
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
            await drafting(
              client,
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
              await drafting(
                client,
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
            if (!tracked) await raw(client, journalTagsFrom(manualLibraryMigration).slice(1));
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
    for (const tracked of [true, false])
      await t.test(
        `regulatory source sign-off preserves existing drafts and records (tracked=${tracked})`,
        async () =>
          cluster(async (client, directory) => {
            await applyThrough(client, directory, manualRegulatoryMigration, tracked);
            await seed(client);
            const id = randomUUID(),
              editor = "synthetic-migration-" + id;
            await client.query(
              "INSERT INTO valo_staff_assignments(id,identity_id,role,granted_by,reason) VALUES($1,$2,'content','synthetic migration','Synthetic draft preservation')",
              [randomUUID(), editor],
            );
            await client.query(
              `INSERT INTO valo_manual_library(id,item_id,version,slug,kind,title,body,digest,created_by)
            VALUES($1::uuid,$1::uuid,1,'manual-'||($1::uuid)::text,'regulatory_article','Synthetic draft','Original text',repeat('a',64),$2)`,
              [id, editor],
            );
            const before = await assertRollsBack(client, manualRegulatoryMigration);
            await applyFor(client, manualRegulatoryMigration, tracked);
            if (!tracked) await raw(client, journalTagsFrom(manualRegulatoryMigration).slice(1));
            assert.deepEqual(await rows(client), before);
            assert.deepEqual(await schema(client), finalSchema);
            assert.deepEqual(
              (
                await client.query(
                  "SELECT state,body,regulatory_check_id FROM valo_manual_library WHERE id=$1",
                  [id],
                )
              ).rows,
              [{ state: "draft", body: "Original text", regulatory_check_id: null }],
            );
            assert.equal(
              (await client.query("SELECT count(*)::int AS n FROM valo_manual_regulatory_checks")).rows[0].n,
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
                    "SELECT has_table_privilege($1,'valo_manual_regulatory_checks','SELECT,INSERT,UPDATE,DELETE') AS allowed",
                    [role],
                  )
                ).rows[0].allowed,
                false,
              );
          }),
      );
    for (const tracked of [true, false])
      await t.test(
        `premium template upgrade preserves historical prices and entitlements (tracked=${tracked})`,
        async () =>
          cluster(async (client, directory) => {
            await applyThrough(client, directory, premiumTemplatesMigration, tracked);
            const { workspace, order, price, content } = await seed(client);
            const entitlement = randomUUID();
            await client.query(
              "INSERT INTO valo_entitlements(id,workspace_id,order_id,content_version_id) VALUES($1,$2,$3,$4)",
              [entitlement, workspace, order, content],
            );
            const historical = async () =>
              (
                await client.query(
                  // The price carries migration adds two columns, which its own check reads; every column a price
                  // held before is compared here.
                  "SELECT to_jsonb(p) - 'carries_to_later_editions' - 'carried_from' AS price, to_jsonb(e) AS entitlement FROM valo_prices p JOIN valo_entitlements e ON p.content_version_id=e.content_version_id WHERE p.id=$1 AND e.id=$2",
                  [price, entitlement],
                )
              ).rows;
            const before = await historical();
            assert.equal(before.length, 1);
            await assertRollsBack(client, premiumTemplatesMigration);
            assert.deepEqual(await historical(), before);
            await applyFor(client, premiumTemplatesMigration, tracked);
            if (!tracked) await raw(client, journalTagsFrom(premiumTemplatesMigration).slice(1));
            assert.deepEqual(await historical(), before);
            assert.deepEqual(
              (
                await client.query(
                  "SELECT reviewed_version_id,manual_version_id FROM valo_commerce_versions WHERE id=$1",
                  [content],
                )
              ).rows,
              [{ reviewed_version_id: content, manual_version_id: null }],
            );
            assert.deepEqual(await schema(client), finalSchema);
            assert.deepEqual(await rowSecurityGaps(client), []);
          }),
      );
    for (const tracked of [true, false])
      await t.test(
        `hot-table index migration preserves rows and registers all nine indexes (tracked=${tracked})`,
        async () =>
          cluster(async (client, directory) => {
            await applyThrough(client, directory, hotTableIndexesMigration, tracked);
            await seed(client);
            const before = await assertRollsBack(client, hotTableIndexesMigration);
            await applyFor(client, hotTableIndexesMigration, tracked);
            if (!tracked) await raw(client, journalTagsFrom(hotTableIndexesMigration).slice(1));
            assert.deepEqual(await rows(client), before);
            assert.deepEqual(await schema(client), finalSchema);
            assert.deepEqual(await rowSecurityGaps(client), []);
            const expectedIndexes = [
              "valo_concern_events_concern_visible_idx",
              "valo_dispute_workspace_order_idx",
              "valo_events_workspace_created_idx",
              "valo_events_workspace_entity_action_idx",
              "valo_export_workspace_document_idx",
              "valo_file_assets_retention_idx",
              "valo_file_assets_workspace_created_idx",
              "valo_refund_workspace_order_idx",
              "valo_support_case_workspace_updated_idx",
            ];
            const found = (
              await client.query(
                "SELECT indexname FROM pg_indexes WHERE schemaname='public' AND indexname=ANY($1) ORDER BY indexname",
                [expectedIndexes],
              )
            ).rows.map((row) => row.indexname);
            assert.deepEqual(found, expectedIndexes);
          }),
      );
    for (const tracked of [true, false])
      await t.test(
        `industry pack migration preserves rows, adds the pack kind with its industry and one published pack per industry (tracked=${tracked})`,
        async () =>
          cluster(async (client, directory) => {
            await applyThrough(client, directory, manualPacksMigration, tracked);
            await seed(client);
            const before = await assertRollsBack(client, manualPacksMigration);
            await applyFor(client, manualPacksMigration, tracked);
            if (!tracked) await raw(client, journalTagsFrom(manualPacksMigration).slice(1));
            assert.deepEqual(await rows(client), before);
            assert.deepEqual(await schema(client), finalSchema);
            assert.deepEqual(await rowSecurityGaps(client), []);
            const definition = async (name) =>
              (
                await client.query(
                  "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname=$1 AND conrelid='public.valo_manual_library'::regclass",
                  [name],
                )
              ).rows[0]?.def ?? "";
            assert.match(await definition("valo_manual_kind"), /'industry_pack'::text/);
            assert.match(
              await definition("valo_manual_text"),
              /\(kind <> ALL \(ARRAY\['industry_introduction'::text, 'industry_pack'::text\]\)\) OR \(industry IS NOT NULL\)/,
            );
            const index = (
              await client.query(
                "SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND indexname='valo_manual_one_pack'",
              )
            ).rows[0]?.indexdef;
            assert.match(
              index ?? "",
              /UNIQUE INDEX valo_manual_one_pack .*\(industry\) WHERE .*'industry_pack'::text/,
            );
          }),
      );
    for (const tracked of [true, false])
      await t.test(
        `rule sign-off migration preserves rows, keeps a sign-off unchanged and refuses an owner-signed release without one (tracked=${tracked})`,
        async () =>
          cluster(async (client, directory) => {
            await applyThrough(client, directory, ruleOwnerSignoffsMigration, tracked);
            await seed(client);
            const before = await assertRollsBack(client, ruleOwnerSignoffsMigration);
            await applyFor(client, ruleOwnerSignoffsMigration, tracked);
            if (!tracked) await raw(client, journalTagsFrom(ruleOwnerSignoffsMigration).slice(1));
            assert.deepEqual(await rows(client), before);
            assert.deepEqual(await schema(client), finalSchema);
            assert.deepEqual(await rowSecurityGaps(client), []);
            const manifest = "a".repeat(64);
            const release = (version, rule, bundle) =>
              client.query(
                `INSERT INTO valo_rule_releases(id,rule_id,version,status,rule,publication_bundle,manifest_hash,published_at)
                 VALUES (gen_random_uuid(),'synthetic-migration-rule',$1,'published',$2::jsonb,$3::jsonb,$4,now())`,
                [version, JSON.stringify(rule), JSON.stringify(bundle), manifest],
              );
            const ruleJson = (version, provenance) => ({
              id: "synthetic-migration-rule",
              version,
              provenance,
              manifestHash: manifest,
            });
            // A release on the reviewed route is unchanged.
            await release(1, ruleJson(1, "editorial_release"), { candidate: { risk: "privacy" } });
            // An owner-signed release needs a sign-off of its exact manifest, made in its transaction.
            await assert.rejects(
              release(2, ruleJson(2, "owner_signoff"), {
                kind: "owner_signoff",
                candidate: { risk: "privacy" },
              }),
              /sign-off of this exact rule version is required/,
            );
            await assert.rejects(
              release(2, ruleJson(2, "editorial_release"), {
                kind: "owner_signoff",
                candidate: { risk: "privacy" },
              }),
              /must name each other/,
            );
            await client.query("BEGIN");
            await client.query(
              `INSERT INTO valo_rule_owner_signoffs(id,rule_id,version,manifest_hash,owner_identity_id,source_checked_at,confirmed_checks)
               VALUES (gen_random_uuid(),'synthetic-migration-rule',2,$1,'synthetic-not-the-owner',now(),'[]'::jsonb)`,
              [manifest],
            );
            // A sign-off by an identity that is not the designated development owner does not count.
            await assert.rejects(
              release(2, ruleJson(2, "owner_signoff"), {
                kind: "owner_signoff",
                candidate: { risk: "privacy" },
              }),
              /sign-off of this exact rule version is required/,
            );
            await client.query("ROLLBACK");
            await client.query(
              `INSERT INTO valo_rule_owner_signoffs(id,rule_id,version,manifest_hash,owner_identity_id,source_checked_at,confirmed_checks)
               VALUES (gen_random_uuid(),'synthetic-migration-rule',3,$1,'synthetic-not-the-owner',now(),'[]'::jsonb)`,
              [manifest],
            );
            await assert.rejects(
              client.query("UPDATE valo_rule_owner_signoffs SET confirmed_checks='[\"amendments\"]'::jsonb"),
              /never changed or removed/,
            );
            await assert.rejects(
              client.query("DELETE FROM valo_rule_owner_signoffs"),
              /never changed or removed/,
            );
            await assert.rejects(
              client.query("TRUNCATE valo_rule_owner_signoffs"),
              /never changed or removed/,
            );
            await assert.rejects(
              client.query(`INSERT INTO valo_rule_owner_signoffs(id,rule_id,version,manifest_hash,owner_identity_id,source_checked_at,confirmed_checks)
               VALUES (gen_random_uuid(),'synthetic-migration-rule',4,'not-a-manifest','synthetic-not-the-owner',now(),'[]'::jsonb)`),
              /valo_rule_owner_signoff_manifest/,
            );
            // The designated development owner: a permanent system role the operator bootstrap granted.
            const ownerAssignment = randomUUID(),
              owner = "synthetic-migration-rule-owner";
            await client.query(
              "INSERT INTO valo_staff_assignments(id,identity_id,role,granted_by,reason) VALUES($1,$2,'system','synthetic migration','Synthetic rule owner fixture')",
              [ownerAssignment, owner],
            );
            await client.query(
              `INSERT INTO valo_staff_role_changes(id,request_key,input_hash,actor_id,actor_assignment_id,assignment_id,target_identity_id,action,role,reason,after_state)
               VALUES (gen_random_uuid(),gen_random_uuid(),repeat('b',64),'operator-bootstrap:synthetic',$1,$1,$2,'grant','system','Synthetic rule owner bootstrap','{"active":true}'::jsonb)`,
              [ownerAssignment, owner],
            );
            const allChecks = [
              "controlling_text",
              "amendments",
              "effective_dates",
              "exceptions",
              "jurisdiction",
            ];
            const signOff = (version, checkedAt, checks) =>
              client.query(
                `INSERT INTO valo_rule_owner_signoffs(id,rule_id,version,manifest_hash,owner_identity_id,source_checked_at,confirmed_checks)
                 VALUES (gen_random_uuid(),'synthetic-migration-rule',$1,$2,$3,${checkedAt},$4::jsonb)`,
                [version, manifest, owner, JSON.stringify(checks)],
              );
            const signed = async (
              version,
              { checkedAt = "now()", checks = allChecks, risk = "privacy" } = {},
            ) => {
              await client.query("BEGIN");
              try {
                await signOff(version, checkedAt, checks);
                await release(version, ruleJson(version, "owner_signoff"), {
                  kind: "owner_signoff",
                  candidate: { risk },
                });
                await client.query("COMMIT");
              } catch (error) {
                await client.query("ROLLBACK");
                throw error;
              }
            };
            const required = /sign-off of this exact rule version is required/;
            // The owner's sign-off on a source check over a day old, or missing an enhanced check, does
            // not count; for general risk the enhanced checks are not required.
            await assert.rejects(signed(5, { checkedAt: "now() - interval '2 days'" }), required);
            await assert.rejects(signed(5, { checkedAt: "now() + interval '1 minute'" }), required);
            await assert.rejects(signed(5, { checks: allChecks.slice(0, 4) }), required);
            await signed(5, { risk: "general", checks: [] });
            // A sign-off made in an earlier transaction does not count either.
            await signOff(6, "now()", allChecks);
            await assert.rejects(
              release(6, ruleJson(6, "owner_signoff"), {
                kind: "owner_signoff",
                candidate: { risk: "privacy" },
              }),
              required,
            );
            await signed(7);
            const status = async (version) =>
              (
                await client.query(
                  "SELECT status FROM valo_rule_releases WHERE rule_id='synthetic-migration-rule' AND version=$1",
                  [version],
                )
              ).rows[0]?.status;
            assert.equal(await status(7), "published");
            // An owner-signed release keeps everything but its status, and is never deleted.
            for (const change of [
              "manifest_hash=repeat('c',64)",
              `rule=rule||'{"reason":"Changed"}'::jsonb`,
              `publication_bundle=publication_bundle||'{"scenarios":[]}'::jsonb`,
              "published_at=now() - interval '1 day'",
            ])
              await assert.rejects(
                client.query(
                  `UPDATE valo_rule_releases SET ${change} WHERE rule_id='synthetic-migration-rule' AND version=7`,
                ),
                /changes only its status/,
              );
            await assert.rejects(
              client.query(
                "DELETE FROM valo_rule_releases WHERE rule_id='synthetic-migration-rule' AND version=7",
              ),
              /is kept/,
            );
            // It leaves publication once, superseded or withdrawn, and is never published again. Since the
            // rule changes migration, a published version leaves only with its change's record, written in
            // the same transaction (docs/architecture/rule-changes.md). This test changes a status after
            // every later migration has run, so it records the change as a release would, naming a later
            // version on the reviewed route as the replacement.
            await release(8, ruleJson(8, "editorial_release"), { candidate: { risk: "privacy" } });
            const setStatus = async (version, value) => {
              await client.query("BEGIN");
              try {
                const [row] = (
                  await client.query(
                    "SELECT status FROM valo_rule_releases WHERE rule_id='synthetic-migration-rule' AND version=$1",
                    [version],
                  )
                ).rows;
                if (row?.status === "published" && (value === "superseded" || value === "withdrawn"))
                  await client.query(
                    `INSERT INTO valo_rule_changes(rule_id,version,kind,replacement_version,reason,recorded_by)
                     VALUES('synthetic-migration-rule',$1,$2,$3,'A synthetic reason for this version''s change.','synthetic-migration-rule-owner')`,
                    [
                      version,
                      value === "superseded" ? "replaced" : "withdrawn",
                      value === "superseded" ? 8 : null,
                    ],
                  );
                await client.query(
                  "UPDATE valo_rule_releases SET status=$2 WHERE rule_id='synthetic-migration-rule' AND version=$1",
                  [version, value],
                );
                await client.query("COMMIT");
              } catch (error) {
                await client.query("ROLLBACK");
                throw error;
              }
            };
            const once = /leaves publication once/;
            await assert.rejects(setStatus(7, "held"), once);
            await setStatus(7, "withdrawn");
            await assert.rejects(setStatus(7, "published"), once);
            await assert.rejects(setStatus(7, "superseded"), once);
            await setStatus(5, "superseded");
            await assert.rejects(setStatus(5, "published"), once);
            assert.deepEqual([await status(5), await status(7)], ["superseded", "withdrawn"]);
            // A release on the reviewed route still changes as before.
            await setStatus(1, "superseded");
            await setStatus(1, "published");
            await client.query(
              "DELETE FROM valo_rule_releases WHERE rule_id='synthetic-migration-rule' AND version=1",
            );
          }),
      );
    for (const tracked of [true, false])
      await t.test(
        `form purchase migration preserves rows and adds the scoped workspace's template purchase check, which only the scoped role may call (tracked=${tracked})`,
        async () =>
          cluster(async (client, directory) => {
            await applyThrough(client, directory, formPurchasesMigration, tracked);
            await seed(client);
            const before = await assertRollsBack(client, formPurchasesMigration);
            await applyFor(client, formPurchasesMigration, tracked);
            if (!tracked) await raw(client, journalTagsFrom(formPurchasesMigration).slice(1));
            assert.deepEqual(await rows(client), before);
            assert.deepEqual(await schema(client), finalSchema);
            assert.deepEqual(await rowSecurityGaps(client), []);
            const { rows: found } = await client.query(
              `SELECT p.prosecdef AS definer, p.provolatile AS volatility,
                 has_function_privilege('valo_workspace_scope', p.oid, 'EXECUTE') AS scoped,
                 has_function_privilege('public', p.oid, 'EXECUTE') AS everyone
               FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
               WHERE n.nspname='public' AND p.proname='valo_workspace_holds_template'`,
            );
            assert.deepEqual(found, [{ definer: true, volatility: "s", scoped: true, everyone: false }]);
          }),
      );
    for (const tracked of [true, false])
      await t.test(
        `form text migration keeps every revision, and a template's form text is saved once and never changed (tracked=${tracked})`,
        async () =>
          cluster(async (client, directory) => {
            await applyThrough(client, directory, formTextMigration, tracked);
            await seed(client);
            const editor = "synthetic-migration-form-text-" + randomUUID();
            await client.query(
              "INSERT INTO valo_staff_assignments(id,identity_id,role,granted_by,reason) VALUES($1,$2,'content','synthetic migration','Synthetic form text')",
              [randomUUID(), editor],
            );
            const insert = (id, kind, formText, details = false) =>
              client.query(
                `INSERT INTO valo_manual_library(id,item_id,version,slug,kind,title,body,digest,file_format,file_bytes,created_by${formText === undefined ? "" : ",form_text"}${details ? releaseDetails.columns : ""})
                 VALUES($1::uuid,$1::uuid,1,'manual-'||($1::uuid)::text,$2,'Synthetic item','Original text',repeat('a',64),
                   ${kind === "template" ? "'docx','\\x01'::bytea" : "NULL,NULL"},$3${formText === undefined ? "" : ",$4"}${details ? releaseDetails.values : ""})`,
                formText === undefined ? [id, kind, editor] : [id, kind, editor, formText],
              );
            const existing = randomUUID();
            await insert(existing, "template");
            const before = await assertRollsBack(client, formTextMigration);
            await applyFor(client, formTextMigration, tracked);
            if (!tracked) await raw(client, journalTagsFrom(formTextMigration).slice(1));
            assert.deepEqual(await rows(client), before);
            assert.deepEqual(await schema(client), finalSchema);
            const read = async (id) =>
              (await client.query("SELECT state,body,form_text FROM valo_manual_library WHERE id=$1", [id]))
                .rows[0];
            assert.deepEqual(await read(existing), {
              state: "draft",
              body: "Original text",
              form_text: null,
            });
            // A template's new revision may carry form text; nothing else may, and none may be empty.
            const filled = randomUUID();
            await insert(filled, "template", "# Synthetic item\n\nSigned: [ ]{=signature}", true);
            await assert.rejects(
              insert(randomUUID(), "practical_guide", "# Synthetic"),
              /valo_manual_form_text/,
            );
            await assert.rejects(insert(randomUUID(), "template", ""), /valo_manual_form_text/);
            // Once saved, it changes no more than the rest of the revision, before or after release.
            const change = (id, value) =>
              client.query("UPDATE valo_manual_library SET form_text=$2 WHERE id=$1", [id, value]);
            await assert.rejects(
              change(existing, "# Synthetic added later"),
              /Save corrections as a new revision/,
            );
            await assert.rejects(change(filled, "# Synthetic changed"), /Save corrections as a new revision/);
            await assert.rejects(change(filled, null), /Save corrections as a new revision/);
            await client.query(
              "UPDATE valo_manual_library SET state='published',published_by=$2,published_at=now() WHERE id=$1",
              [filled, editor],
            );
            await assert.rejects(change(filled, "# Synthetic changed"), /Save corrections as a new revision/);
            assert.deepEqual(await read(filled), {
              state: "published",
              body: "Original text",
              form_text: "# Synthetic item\n\nSigned: [ ]{=signature}",
            });
          }),
      );
    for (const tracked of [true, false])
      await t.test(
        `document form migration keeps every document, and a form is recorded only from a released edition's exact wording, once (tracked=${tracked})`,
        async () =>
          cluster(async (client, directory) => {
            await applyThrough(client, directory, documentFormsMigration, tracked);
            const { workspace } = await seed(client);
            const document = randomUUID();
            await client.query("INSERT INTO valo_documents(id,workspace_id) VALUES($1,$2)", [
              document,
              workspace,
            ]);
            const before = await assertRollsBack(client, documentFormsMigration);
            await applyFor(client, documentFormsMigration, tracked);
            if (!tracked) await raw(client, journalTagsFrom(documentFormsMigration).slice(1));
            assert.deepEqual(await rows(client), before);
            assert.deepEqual(await schema(client), finalSchema);
            assert.deepEqual(await rowSecurityGaps(client), []);
            const record = async (id) =>
              (
                await client.query(
                  "SELECT form_version,form_edition,form_digest FROM valo_documents WHERE id=$1",
                  [id],
                )
              ).rows[0];
            assert.deepEqual(await record(document), {
              form_version: null,
              form_edition: null,
              form_digest: null,
            });
            // A released free template with form text, and a draft one.
            const editor = "synthetic-migration-document-form-" + randomUUID();
            await client.query(
              "INSERT INTO valo_staff_assignments(id,identity_id,role,granted_by,reason) VALUES($1,$2,'content','synthetic migration','Synthetic document form')",
              [randomUUID(), editor],
            );
            const formText = "# Synthetic form\n\nSigned: [ ]{=signature}";
            const edition = async (state) => {
              const id = randomUUID();
              await client.query(
                `INSERT INTO valo_manual_library(id,item_id,version,slug,kind,title,body,digest,file_format,file_bytes,created_by,form_text${releaseDetails.columns})
                 VALUES($1::uuid,$1::uuid,1,'manual-'||($1::uuid)::text,'template','Synthetic form','Synthetic text',repeat('a',64),'docx','\\x01'::bytea,$2,$3${releaseDetails.values})`,
                [id, editor, formText],
              );
              if (state === "published")
                await client.query(
                  "UPDATE valo_manual_library SET state='published',published_by=$2,published_at=now() WHERE id=$1",
                  [id, editor],
                );
              return id;
            };
            const released = await edition("published"),
              draft = await edition("draft");
            const digest = hash(formText);
            const start = (edition, formDigest = digest) =>
              client.query(
                "INSERT INTO valo_documents(id,workspace_id,form_version,form_edition,form_digest) VALUES($1,$2,2,$3,$4)",
                [randomUUID(), workspace, edition, formDigest],
              );
            await assert.rejects(start(draft), /released edition with its exact wording/);
            await assert.rejects(start(released, "b".repeat(64)), /released edition with its exact wording/);
            // A record with a digest but no edition is refused by the table's own check.
            await assert.rejects(
              client.query(
                "INSERT INTO valo_documents(id,workspace_id,form_version,form_digest) VALUES($1,$2,2,$3)",
                [randomUUID(), workspace, digest],
              ),
              /valo_document_form/,
            );
            const formed = randomUUID();
            await client.query(
              "INSERT INTO valo_documents(id,workspace_id,form_version,form_edition,form_digest) VALUES($1,$2,2,$3,$4)",
              [formed, workspace, released, digest],
            );
            // The record never changes, and a document without one never gains one; the rest still does.
            for (const [id, change] of [
              [formed, "form_digest=repeat('c',64)"],
              [formed, "form_edition=NULL,form_digest=NULL,form_version=NULL"],
              [document, `form_version=2,form_edition='${released}',form_digest='${digest}'`],
            ])
              await assert.rejects(
                client.query(`UPDATE valo_documents SET ${change} WHERE id=$1`, [id]),
                /keeps the form it was started with/,
              );
            await client.query("UPDATE valo_documents SET current_revision=2 WHERE id=$1", [formed]);
            assert.deepEqual(await record(formed), {
              form_version: 2,
              form_edition: released,
              form_digest: digest,
            });
            const { rows: found } = await client.query(
              `SELECT p.proname AS name, p.prosecdef AS definer, p.provolatile AS volatility,
                 has_function_privilege('valo_workspace_scope', p.oid, 'EXECUTE') AS scoped,
                 has_function_privilege('public', p.oid, 'EXECUTE') AS everyone
               FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
               WHERE n.nspname='public' AND p.proname IN ('valo_free_form_edition','valo_document_form_text','valo_guard_document_form')
               ORDER BY p.proname`,
            );
            assert.deepEqual(found, [
              {
                name: "valo_document_form_text",
                definer: true,
                volatility: "s",
                scoped: true,
                everyone: false,
              },
              {
                name: "valo_free_form_edition",
                definer: true,
                volatility: "s",
                scoped: true,
                everyone: false,
              },
              {
                name: "valo_guard_document_form",
                definer: true,
                volatility: "v",
                scoped: false,
                everyone: false,
              },
            ]);
            // Without a workspace credential, neither function reveals anything.
            assert.equal(
              (
                await client.query(
                  "SELECT count(*)::int AS n FROM public.valo_free_form_edition('Synthetic form')",
                )
              ).rows[0].n,
              0,
            );
            assert.equal(
              (
                await client.query("SELECT count(*)::int AS n FROM public.valo_document_form_text($1)", [
                  formed,
                ])
              ).rows[0].n,
              0,
            );
          }),
      );
    for (const tracked of [true, false])
      await t.test(
        `premium form document migration keeps every document, and a premium form is recorded only under the workspace's own verified order of that edition, once (tracked=${tracked})`,
        async () =>
          cluster(async (client, directory) => {
            await applyThrough(client, directory, premiumFormDocumentsMigration, tracked);
            const { workspace } = await seed(client);
            const document = randomUUID();
            await client.query("INSERT INTO valo_documents(id,workspace_id) VALUES($1,$2)", [
              document,
              workspace,
            ]);
            const before = await assertRollsBack(client, premiumFormDocumentsMigration);
            await applyFor(client, premiumFormDocumentsMigration, tracked);
            if (!tracked) await raw(client, journalTagsFrom(premiumFormDocumentsMigration).slice(1));
            assert.deepEqual(await rows(client), before);
            assert.deepEqual(await schema(client), finalSchema);
            assert.deepEqual(await rowSecurityGaps(client), []);
            const order = async (id) =>
              (await client.query("SELECT form_order FROM valo_documents WHERE id=$1", [id])).rows[0]
                .form_order;
            assert.equal(await order(document), null);
            // A released free edition, a released premium edition, both with form text, and a second
            // workspace.
            const editor = "synthetic-migration-premium-form-" + randomUUID();
            await client.query(
              "INSERT INTO valo_staff_assignments(id,identity_id,role,granted_by,reason) VALUES($1,$2,'content','synthetic migration','Synthetic premium form')",
              [randomUUID(), editor],
            );
            const formText = "# Synthetic agreement\n\nSigned: [ ]{=signature}";
            const digest = hash(formText);
            const release = async (kind) => {
              const id = randomUUID();
              await client.query(
                `INSERT INTO valo_manual_library(id,item_id,version,slug,kind,title,body,digest,file_format,file_bytes,created_by,form_text${releaseDetails.columns})
                 VALUES($1::uuid,$1::uuid,1,'manual-'||($1::uuid)::text,$2,'Synthetic agreement','Synthetic description',repeat('a',64),'docx','\\x01'::bytea,$3,$4${releaseDetails.values})`,
                [id, kind, editor, formText],
              );
              await client.query(
                "UPDATE valo_manual_library SET state='published',published_by=$2,published_at=now() WHERE id=$1",
                [id, editor],
              );
              return id;
            };
            const free = await release("template"),
              premium = await release("premium_template");
            const other = randomUUID();
            await client.query("INSERT INTO valo_workspaces(id,owner_identity_id) VALUES($1,$2)", [
              other,
              "synthetic-phase1-" + other,
            ]);
            // A price for the premium edition, and orders of it: one verified with its entitlement,
            // one only started, and another workspace's verified one.
            const price = randomUUID();
            await client.query(
              `INSERT INTO valo_prices(id,content_version_id,title,amount_kobo,licence_version,licence_text,tax_treatment,approval_reference,effective_from)
               VALUES($1,$2,'Synthetic premium form',100,'synthetic-licence','Not a sales licence','No tax assertion','SYNTHETIC-NOT-APPROVED',now())`,
              [price, premium],
            );
            const buy = async (workspaceId, status) => {
              const id = randomUUID();
              await client.query(
                `INSERT INTO valo_orders(id,workspace_id,requested_by,reference,request_key,price_id,line,amount_kobo,status,provider_transaction_id)
                 VALUES($1,$2,'synthetic-phase1-owner',$3,$4,$5,$6,100,$7,$8)`,
                [
                  id,
                  workspaceId,
                  "synthetic-" + id,
                  randomUUID(),
                  price,
                  JSON.stringify({ contentVersionId: premium, licenceVersion: "synthetic-licence" }),
                  status,
                  status === "verified_success" ? "synthetic-" + id : null,
                ],
              );
              if (status === "verified_success")
                await client.query(
                  "INSERT INTO valo_entitlements(id,workspace_id,order_id,content_version_id) VALUES($1,$2,$3,$4)",
                  [randomUUID(), workspaceId, id, premium],
                );
              return id;
            };
            const paid = await buy(workspace, "verified_success"),
              started = await buy(workspace, "pending"),
              theirs = await buy(other, "verified_success");
            const start = (edition, formOrder) =>
              client.query(
                "INSERT INTO valo_documents(id,workspace_id,form_version,form_edition,form_digest,form_order) VALUES($1,$2,2,$3,$4,$5)",
                [randomUUID(), workspace, edition, digest, formOrder],
              );
            // A premium edition needs the workspace's own verified order of it; a free one takes none.
            await assert.rejects(start(premium, null), /released edition with its exact wording/);
            await assert.rejects(start(premium, started), /released edition with its exact wording/);
            // Another workspace's order is refused too; the foreign key to the workspace's own orders
            // backs the check.
            await assert.rejects(start(premium, theirs), /released edition with its exact wording/);
            await assert.rejects(start(free, paid), /released edition with its exact wording/);
            await assert.rejects(
              client.query("INSERT INTO valo_documents(id,workspace_id,form_order) VALUES($1,$2,$3)", [
                randomUUID(),
                workspace,
                paid,
              ]),
              /valo_document_form_order/,
            );
            await start(free, null);
            const formed = randomUUID();
            await client.query(
              "INSERT INTO valo_documents(id,workspace_id,form_version,form_edition,form_digest,form_order) VALUES($1,$2,2,$3,$4,$5)",
              [formed, workspace, premium, digest, paid],
            );
            assert.equal(await order(formed), paid);
            // The order is part of the record, which never changes, before or after a refund.
            for (const change of ["form_order=NULL", `form_order='${started}'`])
              await assert.rejects(
                client.query(`UPDATE valo_documents SET ${change} WHERE id=$1`, [formed]),
                /keeps the form it was started with/,
              );
            await client.query("UPDATE valo_entitlements SET status='suspended' WHERE order_id=$1", [paid]);
            await client.query("UPDATE valo_documents SET current_revision=2 WHERE id=$1", [formed]);
            assert.equal(await order(formed), paid);
            await assert.rejects(start(premium, paid), /released edition with its exact wording/);
            const { rows: found } = await client.query(
              `SELECT p.prosecdef AS definer, p.provolatile AS volatility,
                 has_function_privilege('valo_workspace_scope', p.oid, 'EXECUTE') AS scoped,
                 has_function_privilege('public', p.oid, 'EXECUTE') AS everyone
               FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
               WHERE n.nspname='public' AND p.proname='valo_premium_form_edition'`,
            );
            assert.deepEqual(found, [{ definer: true, volatility: "s", scoped: true, everyone: false }]);
            // Without a workspace credential, the function reveals nothing.
            assert.equal(
              (
                await client.query(
                  "SELECT count(*)::int AS n FROM public.valo_premium_form_edition('Synthetic agreement')",
                )
              ).rows[0].n,
              0,
            );
          }),
      );
    for (const tracked of [true, false])
      await t.test(
        `export finished-file migration keeps every file already asked for as a marked draft, and lets one finished file and one marked draft of a version stand side by side (tracked=${tracked})`,
        async () =>
          cluster(async (client, directory) => {
            await applyThrough(client, directory, exportFinishedFilesMigration, tracked);
            const { workspace } = await seed(client);
            const document = randomUUID(),
              revision = randomUUID(),
              asked = randomUUID();
            await client.query("INSERT INTO valo_documents(id,workspace_id) VALUES($1,$2)", [
              document,
              workspace,
            ]);
            await client.query(
              `INSERT INTO valo_document_revisions(id,workspace_id,document_id,revision,title,content,content_hash,actor_id)
               VALUES($1,$2,$3,1,'Synthetic invoice','{}','synthetic-hash','synthetic-migration-actor')`,
              [revision, workspace, document],
            );
            const job = (id, finished) =>
              client.query(
                `INSERT INTO valo_export_jobs(id,workspace_id,document_id,revision_id,revision,format,render_version,source_hash,requested_by,queue_id${finished === undefined ? "" : ",finished"})
                 VALUES($1,$2,$3,$4,1,'pdf','synthetic-render','synthetic-hash','synthetic-migration-actor',$5${finished === undefined ? "" : ",$6"})`,
                [
                  id,
                  workspace,
                  document,
                  revision,
                  randomUUID(),
                  ...(finished === undefined ? [] : [finished]),
                ],
              );
            await job(asked);
            const before = await assertRollsBack(client, exportFinishedFilesMigration);
            await applyFor(client, exportFinishedFilesMigration, tracked);
            if (!tracked) await raw(client, journalTagsFrom(exportFinishedFilesMigration).slice(1));
            assert.deepEqual(await rows(client), before);
            assert.deepEqual(await schema(client), finalSchema);
            assert.deepEqual(await rowSecurityGaps(client), []);
            // The file asked for before is a marked draft, and so is one asked for without saying.
            const kinds = async () =>
              (
                await client.query(
                  "SELECT id, finished FROM valo_export_jobs WHERE revision_id=$1 ORDER BY finished, created_at",
                  [revision],
                )
              ).rows;
            assert.deepEqual(await kinds(), [{ id: asked, finished: false }]);
            // A finished file of the same version and format stands beside it; a second of either
            // kind does not.
            const finished = randomUUID();
            await job(finished, true);
            assert.deepEqual(await kinds(), [
              { id: asked, finished: false },
              { id: finished, finished: true },
            ]);
            await assert.rejects(job(randomUUID(), true), /valo_export_revision_format_unique/);
            await assert.rejects(job(randomUUID(), false), /valo_export_revision_format_unique/);
            await assert.rejects(job(randomUUID()), /valo_export_revision_format_unique/);
            await assert.rejects(job(randomUUID(), null), /finished/);
          }),
      );
    for (const tracked of [true, false])
      await t.test(
        `library entry details migration keeps every revision and release, and a template is released only with what it is for, its limits and how it was written, never changed once saved (tracked=${tracked})`,
        async () =>
          cluster(async (client, directory) => {
            await applyThrough(client, directory, libraryEntryDetailsMigration, tracked);
            await seed(client);
            const editor = "synthetic-migration-entry-details-" + randomUUID();
            await client.query(
              "INSERT INTO valo_staff_assignments(id,identity_id,role,granted_by,reason) VALUES($1,$2,'content','synthetic migration','Synthetic entry details')",
              [randomUUID(), editor],
            );
            const insert = (id, kind, details = "") =>
              client.query(
                `INSERT INTO valo_manual_library(id,item_id,version,slug,kind,title,body,digest,file_format,file_bytes,created_by${details ? ",purpose,needs,limits,related_items,ai_drafted" : ""})
                 VALUES($1::uuid,$1::uuid,1,'manual-'||($1::uuid)::text,$2,'Synthetic item','Synthetic text',repeat('a',64),
                   ${kind.endsWith("template") ? "'docx','\\x01'::bytea" : "NULL,NULL"},$3${details})`,
                [id, kind, editor],
              );
            const publish = (id) =>
              client.query(
                "UPDATE valo_manual_library SET state='published',published_by=$2,published_at=now() WHERE id=$1",
                [id, editor],
              );
            // A template released before the migration, and one still in draft.
            const released = randomUUID(),
              waiting = randomUUID();
            await insert(released, "template");
            await publish(released);
            await insert(waiting, "template");
            const before = await assertRollsBack(client, libraryEntryDetailsMigration);
            await applyFor(client, libraryEntryDetailsMigration, tracked);
            if (!tracked) await raw(client, journalTagsFrom(libraryEntryDetailsMigration).slice(1));
            assert.deepEqual(await rows(client), before);
            assert.deepEqual(await schema(client), finalSchema);
            const read = async (id) =>
              (
                await client.query(
                  "SELECT state,purpose,needs,limits,related_items,ai_drafted FROM valo_manual_library WHERE id=$1",
                  [id],
                )
              ).rows[0];
            // The earlier release stands, with no details, and can still be withdrawn.
            assert.deepEqual(await read(released), {
              state: "published",
              purpose: null,
              needs: null,
              limits: null,
              related_items: null,
              ai_drafted: null,
            });
            await client.query(
              "UPDATE valo_manual_library SET state='withdrawn',closed_by=$2,closed_at=now() WHERE id=$1",
              [released, editor],
            );
            // A draft without its details is not released; saved again with them, it is.
            await assert.rejects(
              publish(waiting),
              /released with what it is for, its limits and how it was written/,
            );
            const detailed = randomUUID(),
              guide = randomUUID();
            await insert(
              detailed,
              "template",
              `,'Synthetic purpose','Synthetic need one' || chr(10) || 'Synthetic need two','Synthetic limits',ARRAY['${guide}']::uuid[],true`,
            );
            await publish(detailed);
            assert.deepEqual(await read(detailed), {
              state: "published",
              purpose: "Synthetic purpose",
              needs: "Synthetic need one\nSynthetic need two",
              limits: "Synthetic limits",
              related_items: [guide],
              ai_drafted: true,
            });
            // A guide has no details, and none is empty or too long.
            await assert.rejects(
              insert(randomUUID(), "practical_guide", ",'For',NULL,NULL,NULL,NULL"),
              /valo_manual_entry_details/,
            );
            await assert.rejects(
              insert(randomUUID(), "template", ",'',NULL,NULL,NULL,NULL"),
              /valo_manual_entry_details/,
            );
            await assert.rejects(
              insert(randomUUID(), "template", `,'${"x".repeat(401)}',NULL,NULL,NULL,NULL`),
              /valo_manual_entry_details/,
            );
            await assert.rejects(
              insert(randomUUID(), "template", ",NULL,NULL,NULL,ARRAY[]::uuid[],NULL"),
              /valo_manual_entry_details/,
            );
            // Once saved, the details change no more than the text, before or after release: none can
            // be changed on a released version, nor added to a draft saved without them.
            for (const change of [
              "purpose='Changed'",
              "needs=NULL",
              "related_items=NULL",
              "ai_drafted=false",
            ])
              await assert.rejects(
                client.query(`UPDATE valo_manual_library SET ${change} WHERE id=$1`, [detailed]),
                /Save corrections as a new revision/,
              );
            for (const change of ["purpose='Added later'", "limits='Added later'", "ai_drafted=true"])
              await assert.rejects(
                client.query(`UPDATE valo_manual_library SET ${change} WHERE id=$1`, [waiting]),
                /Save corrections as a new revision/,
              );
          }),
      );
    for (const tracked of [true, false])
      await t.test(
        `library saves and copies migration keeps every document, records a copy's release once from a released free template, and lets only the scoped workspace read released templates (tracked=${tracked})`,
        async () =>
          cluster(async (client, directory) => {
            await applyThrough(client, directory, librarySavesCopiesMigration, tracked);
            const { workspace } = await seed(client);
            const document = randomUUID();
            await client.query("INSERT INTO valo_documents(id,workspace_id) VALUES($1,$2)", [
              document,
              workspace,
            ]);
            const before = await assertRollsBack(client, librarySavesCopiesMigration);
            await applyFor(client, librarySavesCopiesMigration, tracked);
            if (!tracked) await raw(client, journalTagsFrom(librarySavesCopiesMigration).slice(1));
            assert.deepEqual(await rows(client), before);
            assert.deepEqual(await schema(client), finalSchema);
            assert.deepEqual(await rowSecurityGaps(client), []);
            const copiedFrom = async (id) =>
              (await client.query("SELECT library_edition FROM valo_documents WHERE id=$1", [id])).rows[0]
                .library_edition;
            assert.equal(await copiedFrom(document), null);
            // A released free template, a released premium one, and a free one still in draft.
            const editor = "synthetic-migration-library-copy-" + randomUUID();
            await client.query(
              "INSERT INTO valo_staff_assignments(id,identity_id,role,granted_by,reason) VALUES($1,$2,'content','synthetic migration','Synthetic library copy')",
              [randomUUID(), editor],
            );
            const edition = async (kind, state) => {
              const id = randomUUID();
              await client.query(
                `INSERT INTO valo_manual_library(id,item_id,version,slug,kind,title,body,digest,file_format,file_bytes,created_by${releaseDetails.columns})
                 VALUES($1::uuid,$1::uuid,1,'manual-'||($1::uuid)::text,$2,'Synthetic template','Synthetic text',repeat('a',64),'docx','\\x01'::bytea,$3${releaseDetails.values})`,
                [id, kind, editor],
              );
              if (state === "published")
                await client.query(
                  "UPDATE valo_manual_library SET state='published',published_by=$2,published_at=now() WHERE id=$1",
                  [id, editor],
                );
              return id;
            };
            const free = await edition("template", "published"),
              premium = await edition("premium_template", "published"),
              draft = await edition("template", "draft");
            // A copy records a released free template, once, and nothing else.
            const copy = (id) =>
              client.query(
                "INSERT INTO valo_documents(id,workspace_id,library_edition) VALUES($1,$2,$3) RETURNING id",
                [randomUUID(), workspace, id],
              );
            const made = (await copy(free)).rows[0].id;
            assert.equal(await copiedFrom(made), free);
            await assert.rejects(copy(premium), /A copy is made only of a released free template/);
            await assert.rejects(copy(draft), /A copy is made only of a released free template/);
            await assert.rejects(
              client.query(
                "INSERT INTO valo_documents(id,workspace_id,library_edition,template_version_id) VALUES($1,$2,$3,$4)",
                [randomUUID(), workspace, free, randomUUID()],
              ),
              /valo_document_library_edition/,
            );
            for (const value of [null, premium])
              await assert.rejects(
                client.query("UPDATE valo_documents SET library_edition=$2 WHERE id=$1", [made, value]),
                /A document keeps the template release it was copied from/,
              );
            await assert.rejects(
              client.query("UPDATE valo_documents SET library_edition=$2 WHERE id=$1", [document, free]),
              /A document keeps the template release it was copied from/,
            );
            // The three readers run as their owner, and only the scoped role may call them.
            const { rows: readers } = await client.query(
              `SELECT p.proname AS name, p.prosecdef AS definer, p.provolatile AS volatility,
                 has_function_privilege('valo_workspace_scope', p.oid, 'EXECUTE') AS scoped,
                 has_function_privilege('public', p.oid, 'EXECUTE') AS everyone
               FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
               WHERE n.nspname='public' AND p.proname IN ('valo_live_manual_templates','valo_free_library_edition','valo_workspace_library_editions')
               ORDER BY p.proname`,
            );
            assert.deepEqual(
              readers,
              [
                "valo_free_library_edition",
                "valo_live_manual_templates",
                "valo_workspace_library_editions",
              ].map((name) => ({ name, definer: true, volatility: "s", scoped: true, everyone: false })),
            );
            // Unscoped, they read nothing. In the workspace's scope, they read the released templates,
            // the free one's text, and the release of the workspace's copy.
            assert.equal(
              (await client.query("SELECT count(*)::int AS n FROM valo_live_manual_templates()")).rows[0].n,
              0,
            );
            await client.query("BEGIN");
            try {
              await enterWorkspaceScope(client, workspace);
              const live = (await client.query("SELECT id, kind FROM valo_live_manual_templates()")).rows;
              assert.deepEqual(new Set(live.map((row) => row.id)), new Set([free, premium]));
              const text = async (id) =>
                (await client.query("SELECT edition, body FROM valo_free_library_edition($1)", [id])).rows;
              assert.deepEqual(await text(free), [{ edition: free, body: "Synthetic text" }]);
              assert.deepEqual(await text(premium), []);
              assert.deepEqual(await text(draft), []);
              assert.deepEqual(
                (
                  await client.query(
                    "SELECT document, edition, title, version FROM valo_workspace_library_editions()",
                  )
                ).rows,
                [{ document: made, edition: free, title: "Synthetic template", version: 1 }],
              );
              await assert.rejects(
                client.query("SELECT count(*) FROM valo_manual_library"),
                /permission denied/,
              );
            } finally {
              await client.query("ROLLBACK");
            }
          }),
      );
    for (const tracked of [true, false])
      await t.test(
        `document editions migration keeps every row and lets only the scoped workspace read where its documents' library editions stand (tracked=${tracked})`,
        async () =>
          cluster(async (client, directory) => {
            await applyThrough(client, directory, documentEditionsMigration, tracked);
            const { workspace } = await seed(client);
            const before = await assertRollsBack(client, documentEditionsMigration);
            await applyFor(client, documentEditionsMigration, tracked);
            if (!tracked) await raw(client, journalTagsFrom(documentEditionsMigration).slice(1));
            assert.deepEqual(await rows(client), before);
            assert.deepEqual(await schema(client), finalSchema);
            assert.deepEqual(await rowSecurityGaps(client), []);
            // A free template released, copied, then replaced by a second version.
            const editor = "synthetic-migration-edition-" + randomUUID();
            await client.query(
              "INSERT INTO valo_staff_assignments(id,identity_id,role,granted_by,reason) VALUES($1,$2,'content','synthetic migration','Synthetic document editions')",
              [randomUUID(), editor],
            );
            const item = randomUUID();
            const edition = async (version) => {
              const id = version === 1 ? item : randomUUID();
              await client.query(
                `INSERT INTO valo_manual_library(id,item_id,version,slug,kind,title,body,digest,file_format,file_bytes,created_by${releaseDetails.columns})
                 VALUES($1::uuid,$2::uuid,$3,'manual-'||($2::uuid)::text,'template','Synthetic edition','Synthetic text',repeat('a',64),'docx','\\x01'::bytea,$4${releaseDetails.values})`,
                [id, item, version, editor],
              );
              return id;
            };
            const first = await edition(1);
            await client.query(
              "UPDATE valo_manual_library SET state='published',published_by=$2,published_at=now() WHERE id=$1",
              [first, editor],
            );
            const copy = randomUUID();
            await client.query(
              "INSERT INTO valo_documents(id,workspace_id,library_edition) VALUES($1,$2,$3)",
              [copy, workspace, first],
            );
            const second = await edition(2);
            await noteChange(client, second, editor);
            await client.query(
              "UPDATE valo_manual_library SET state='replaced',closed_by=$2,closed_at=now() WHERE id=$1",
              [first, editor],
            );
            await client.query(
              "UPDATE valo_manual_library SET state='published',published_by=$2,published_at=now() WHERE id=$1",
              [second, editor],
            );
            // The reader runs as its owner, and only the scoped role may call it.
            const { rows: reader } = await client.query(
              `SELECT p.prosecdef AS definer, p.provolatile AS volatility,
                 has_function_privilege('valo_workspace_scope', p.oid, 'EXECUTE') AS scoped,
                 has_function_privilege('public', p.oid, 'EXECUTE') AS everyone
               FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
               WHERE n.nspname='public' AND p.proname='valo_workspace_document_editions'`,
            );
            assert.deepEqual(reader, [{ definer: true, volatility: "s", scoped: true, everyone: false }]);
            // Unscoped, it reads nothing. In the workspace's scope, the copy's edition and the later release.
            assert.equal(
              (await client.query("SELECT count(*)::int AS n FROM valo_workspace_document_editions()"))
                .rows[0].n,
              0,
            );
            await client.query("BEGIN");
            try {
              await enterWorkspaceScope(client, workspace);
              assert.deepEqual(
                (
                  await client.query(
                    "SELECT document, edition, version, latest_version, latest_state FROM valo_workspace_document_editions()",
                  )
                ).rows,
                [
                  {
                    document: copy,
                    edition: first,
                    version: 1,
                    latest_version: 2,
                    latest_state: "published",
                  },
                ],
              );
            } finally {
              await client.query("ROLLBACK");
            }
          }),
      );
    for (const tracked of [true, false])
      await t.test(
        `edition purchases migration keeps every row, and a purchase carries to its template's next released edition only for its own workspace while it stands (tracked=${tracked})`,
        async () =>
          cluster(async (client, directory) => {
            await applyThrough(client, directory, editionPurchasesMigration, tracked);
            const { workspace } = await seed(client);
            const before = await assertRollsBack(client, editionPurchasesMigration);
            await applyFor(client, editionPurchasesMigration, tracked);
            if (!tracked) await raw(client, journalTagsFrom(editionPurchasesMigration).slice(1));
            assert.deepEqual(await rows(client), before);
            assert.deepEqual(await schema(client), finalSchema);
            assert.deepEqual(await rowSecurityGaps(client), []);
            // A premium template's first edition, bought, then replaced by a second.
            const editor = "synthetic-migration-carried-" + randomUUID();
            await client.query(
              "INSERT INTO valo_staff_assignments(id,identity_id,role,granted_by,reason) VALUES($1,$2,'content','synthetic migration','Synthetic carried purchase')",
              [randomUUID(), editor],
            );
            const formText = "# Synthetic agreement\n\nSigned: [ ]{=signature}";
            const digest = hash(formText);
            const item = randomUUID();
            const edition = async (version) => {
              const id = version === 1 ? item : randomUUID();
              await client.query(
                `INSERT INTO valo_manual_library(id,item_id,version,slug,kind,title,body,digest,file_format,file_bytes,created_by,form_text${releaseDetails.columns})
                 VALUES($1::uuid,$2::uuid,$3,'manual-'||($2::uuid)::text,'premium_template','Synthetic agreement','Synthetic description',repeat('a',64),'docx','\\x01'::bytea,$4,$5${releaseDetails.values})`,
                [id, item, version, editor, formText],
              );
              return id;
            };
            const publish = (id) =>
              client.query(
                "UPDATE valo_manual_library SET state='published',published_by=$2,published_at=now() WHERE id=$1",
                [id, editor],
              );
            const first = await edition(1);
            await publish(first);
            const other = randomUUID();
            await client.query("INSERT INTO valo_workspaces(id,owner_identity_id) VALUES($1,$2)", [
              other,
              "synthetic-phase1-" + other,
            ]);
            const price = randomUUID();
            await client.query(
              `INSERT INTO valo_prices(id,content_version_id,title,amount_kobo,licence_version,licence_text,tax_treatment,approval_reference,effective_from)
               VALUES($1,$2,'Synthetic carried purchase',100,'synthetic-licence','Not a sales licence','No tax assertion','SYNTHETIC-NOT-APPROVED',now())`,
              [price, first],
            );
            const paid = randomUUID();
            await client.query(
              `INSERT INTO valo_orders(id,workspace_id,requested_by,reference,request_key,price_id,line,amount_kobo,status,provider_transaction_id)
               VALUES($1,$2,'synthetic-phase1-owner',$3,$4,$5,$6,100,'verified_success',$7)`,
              [
                paid,
                workspace,
                "synthetic-" + paid,
                randomUUID(),
                price,
                JSON.stringify({ contentVersionId: first, licenceVersion: "synthetic-licence" }),
                "synthetic-" + paid,
              ],
            );
            await client.query(
              "INSERT INTO valo_entitlements(id,workspace_id,order_id,content_version_id) VALUES($1,$2,$3,$4)",
              [randomUUID(), workspace, paid, first],
            );
            const second = await edition(2);
            await noteChange(client, second, editor);
            await client.query(
              "UPDATE valo_manual_library SET state='replaced',closed_by=$2,closed_at=now() WHERE id=$1",
              [first, editor],
            );
            await publish(second);
            const readAs = async (workspaceId) => {
              await client.query("BEGIN");
              try {
                await enterWorkspaceScope(client, workspaceId);
                const one = async (text, values = []) => (await client.query(text, values)).rows;
                return {
                  files: [
                    (await one("SELECT version FROM valo_manual_purchased_file($1)", [first])).length,
                    (await one("SELECT version FROM valo_manual_purchased_file($1)", [second])).length,
                  ],
                  holds: (
                    await one("SELECT valo_workspace_holds_template('TPL-17','Synthetic agreement') AS holds")
                  )[0].holds,
                  carried: await one(
                    "SELECT bought, bought_version, edition, version FROM valo_workspace_carried_editions()",
                  ),
                  form: await one(
                    "SELECT edition, version, purchase FROM valo_premium_form_edition('Synthetic agreement')",
                  ),
                };
              } finally {
                await client.query("ROLLBACK");
              }
            };
            // The buyer downloads the second edition, not the first, holds the template, and starts its
            // form from the second edition under the order for the first.
            assert.deepEqual(await readAs(workspace), {
              files: [0, 1],
              holds: true,
              carried: [{ bought: first, bought_version: 1, edition: second, version: 2 }],
              form: [{ edition: second, version: 2, purchase: paid }],
            });
            // Another workspace holds nothing of it.
            assert.deepEqual(await readAs(other), { files: [0, 0], holds: false, carried: [], form: [] });
            // The form guard records the second edition under the order for the first, while the
            // purchase stands.
            const start = () =>
              client.query(
                "INSERT INTO valo_documents(id,workspace_id,form_version,form_edition,form_digest,form_order) VALUES($1,$2,2,$3,$4,$5)",
                [randomUUID(), workspace, second, digest, paid],
              );
            await start();
            await client.query("UPDATE valo_entitlements SET status='suspended' WHERE order_id=$1", [paid]);
            await assert.rejects(start(), /released edition with its exact wording/);
            assert.deepEqual(await readAs(workspace), { files: [0, 0], holds: false, carried: [], form: [] });
            // The new reader runs as its owner, and only the scoped role may call it.
            const { rows: reader } = await client.query(
              `SELECT p.prosecdef AS definer, has_function_privilege('valo_workspace_scope', p.oid, 'EXECUTE') AS scoped,
                 has_function_privilege('public', p.oid, 'EXECUTE') AS everyone
               FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
               WHERE n.nspname='public' AND p.proname='valo_workspace_carried_editions'`,
            );
            assert.deepEqual(reader, [{ definer: true, scoped: true, everyone: false }]);
          }),
      );
    for (const tracked of [true, false])
      await t.test(
        `edition notices migration keeps every row, tells each workspace that holds or used an edition once when it is replaced or withdrawn, and lets that workspace only read its notices and mark them read (tracked=${tracked})`,
        async () =>
          cluster(async (client, directory) => {
            await applyThrough(client, directory, editionNoticesMigration, tracked);
            const { workspace: holder } = await seed(client);
            const before = await assertRollsBack(client, editionNoticesMigration);
            await applyFor(client, editionNoticesMigration, tracked);
            if (!tracked) await raw(client, journalTagsFrom(editionNoticesMigration).slice(1));
            assert.deepEqual(await rows(client), before);
            assert.deepEqual(await schema(client), finalSchema);
            assert.deepEqual(await rowSecurityGaps(client), []);
            const workspaceNamed = async () => {
              const id = randomUUID();
              await client.query("INSERT INTO valo_workspaces(id,owner_identity_id) VALUES($1,$2)", [
                id,
                "synthetic-phase1-" + id,
              ]);
              return id;
            };
            const user = await workspaceNamed(),
              stranger = await workspaceNamed();
            const editor = "synthetic-migration-notices-" + randomUUID();
            await client.query(
              "INSERT INTO valo_staff_assignments(id,identity_id,role,granted_by,reason) VALUES($1,$2,'content','synthetic migration','Synthetic edition notices')",
              [randomUUID(), editor],
            );
            const edition = async (item, version, kind, title) => {
              const id = version === 1 ? item : randomUUID();
              await client.query(
                `INSERT INTO valo_manual_library(id,item_id,version,slug,kind,title,body,digest,file_format,file_bytes,created_by${releaseDetails.columns})
                 VALUES($1::uuid,$2::uuid,$3,'manual-'||($2::uuid)::text,$4,$5,'Synthetic text',repeat('a',64),'docx','\x01'::bytea,$6${releaseDetails.values})`,
                [id, item, version, kind, title, editor],
              );
              return id;
            };
            const publish = (id) =>
              client.query(
                "UPDATE valo_manual_library SET state='published',published_by=$2,published_at=now() WHERE id=$1",
                [id, editor],
              );
            const replace = (id) =>
              client.query(
                "UPDATE valo_manual_library SET state='replaced',closed_by=$2,closed_at=now() WHERE id=$1",
                [id, editor],
              );
            const reason = "A synthetic reason the customers who bought or used this version read.";
            const withdraw = async (id) => {
              await client.query(
                "INSERT INTO valo_manual_withdrawals(edition,reason,recorded_by) VALUES($1,$2,$3)",
                [id, reason, editor],
              );
              await client.query(
                "UPDATE valo_manual_library SET state='withdrawn',closed_by=$2,closed_at=now() WHERE id=$1",
                [id, editor],
              );
            };
            const written = async (editionId) =>
              (
                await client.query(
                  `SELECT workspace_id, route, kind, title, version, replacement_version, reason, held, documents
                     FROM valo_edition_notices WHERE edition=$1 ORDER BY workspace_id, kind`,
                  [editionId],
                )
              ).rows;
            // A free template's first edition, used for two documents in one workspace, then replaced.
            const free = randomUUID();
            const freeFirst = await edition(free, 1, "template", "Synthetic register");
            await publish(freeFirst);
            for (const _document of [1, 2])
              await client.query(
                "INSERT INTO valo_documents(id,workspace_id,library_edition) VALUES($1,$2,$3)",
                [randomUUID(), user, freeFirst],
              );
            assert.deepEqual(await written(freeFirst), []);
            const freeSecond = await edition(free, 2, "template", "Synthetic register");
            await noteChange(client, freeSecond, editor);
            await replace(freeFirst);
            await publish(freeSecond);
            const replacedFree = {
              workspace_id: user,
              route: "library",
              kind: "replaced",
              title: "Synthetic register",
              version: 1,
              replacement_version: 2,
              reason: changeNote,
              held: false,
              documents: 2,
            };
            assert.deepEqual(await written(freeFirst), [replacedFree]);
            // Withdrawn with a reason, the second edition tells nobody: no workspace used it. The editions
            // reader now gives the reason to the workspace whose documents came from the first edition.
            await withdraw(freeSecond);
            assert.deepEqual(await written(freeSecond), []);
            await client.query("BEGIN");
            try {
              await enterWorkspaceScope(client, user);
              assert.deepEqual(
                (
                  await client.query(
                    "SELECT DISTINCT version, latest_version, latest_state, latest_reason FROM valo_workspace_document_editions()",
                  )
                ).rows,
                [{ version: 1, latest_version: 2, latest_state: "withdrawn", latest_reason: reason }],
              );
            } finally {
              await client.query("ROLLBACK");
            }
            // The reason is written once, of 20 to 1,000 characters, and never changed.
            await assert.rejects(
              client.query("UPDATE valo_manual_withdrawals SET reason=$2 WHERE edition=$1", [
                freeSecond,
                reason + " Changed.",
              ]),
              /A withdrawal keeps the reason it was given/,
            );
            await assert.rejects(
              client.query("DELETE FROM valo_manual_withdrawals WHERE edition=$1", [freeSecond]),
              /A withdrawal keeps the reason it was given/,
            );
            await assert.rejects(
              client.query(
                "INSERT INTO valo_manual_withdrawals(edition,reason,recorded_by) VALUES($1,'Too short',$2)",
                [freeFirst, editor],
              ),
              /valo_manual_withdrawal_reason/,
            );
            // A premium template's edition, held through a verified purchase, then withdrawn.
            const premium = randomUUID();
            const premiumFirst = await edition(premium, 1, "premium_template", "Synthetic agreement");
            await publish(premiumFirst);
            const price = randomUUID();
            await client.query(
              `INSERT INTO valo_prices(id,content_version_id,title,amount_kobo,licence_version,licence_text,tax_treatment,approval_reference,effective_from)
               VALUES($1,$2,'Synthetic noticed purchase',100,'synthetic-licence','Not a sales licence','No tax assertion','SYNTHETIC-NOT-APPROVED',now())`,
              [price, premiumFirst],
            );
            const buy = async (workspaceId, status) => {
              const order = randomUUID();
              await client.query(
                `INSERT INTO valo_orders(id,workspace_id,requested_by,reference,request_key,price_id,line,amount_kobo,status,provider_transaction_id)
                 VALUES($1,$2,'synthetic-phase1-owner',$3,$4,$5,$6,100,$7,$8)`,
                [
                  order,
                  workspaceId,
                  "synthetic-" + order,
                  randomUUID(),
                  price,
                  JSON.stringify({ contentVersionId: premiumFirst, licenceVersion: "synthetic-licence" }),
                  status,
                  "synthetic-" + order,
                ],
              );
              await client.query(
                "INSERT INTO valo_entitlements(id,workspace_id,order_id,content_version_id) VALUES($1,$2,$3,$4)",
                [randomUUID(), workspaceId, order, premiumFirst],
              );
            };
            await buy(holder, "verified_success");
            // A reversed purchase holds nothing.
            await buy(stranger, "reversed");
            await withdraw(premiumFirst);
            assert.deepEqual(await written(premiumFirst), [
              {
                workspace_id: holder,
                route: "library",
                kind: "withdrawn",
                title: "Synthetic agreement",
                version: 1,
                replacement_version: null,
                reason,
                held: true,
                documents: 0,
              },
            ]);
            // A new edition released after the withdrawn one tells the holder that it was replaced too,
            // with what changed.
            const premiumSecond = await edition(premium, 2, "premium_template", "Synthetic agreement");
            await noteChange(client, premiumSecond, editor);
            await publish(premiumSecond);
            assert.deepEqual(
              (await written(premiumFirst)).map((row) => [row.kind, row.replacement_version, row.reason]),
              [
                ["replaced", 2, changeNote],
                ["withdrawn", null, reason],
              ],
            );
            // On the reviewed route, publishing a template's next version tells the workspaces that hold
            // the template or made a document from the version before it. Only the publisher's login
            // publishes; in this throwaway cluster the synthetic versions stay published, so that the
            // notices they wrote can be read.
            const policy = "synthetic-notices-" + randomUUID();
            await client.query(
              "INSERT INTO valo_publication_policies(id,hash,policy,authority) VALUES($1,'synthetic','{}','{}')",
              [policy],
            );
            const template = "SYNTHETIC-NOTICED-" + randomUUID();
            const reviewed = async (version, bundle) => {
              const id = randomUUID();
              await drafting(
                client,
                `INSERT INTO valo_content_versions(id,template_id,version,slug,policy_id,candidate_hash,bundle,attestations,review_by)
                 VALUES($1,$2,$3,$4,$5,'synthetic',$6,'{}',now()+interval '30 days')`,
                [
                  id,
                  template,
                  version,
                  template.toLowerCase() + "-" + version,
                  policy,
                  JSON.stringify(bundle),
                ],
              );
              return id;
            };
            await client.query("ALTER ROLE valo_publisher_login LOGIN");
            const publisher = new pg.Client({
              host: "127.0.0.1",
              port: client.port,
              user: "valo_publisher_login",
              database: "postgres",
              connectionTimeoutMillis: 5000,
            });
            await publisher.connect();
            const release = async (id) => {
              await publisher.query("BEGIN");
              await publisher.query("SET LOCAL ROLE valo_content_publisher_dev");
              await publisher.query(
                "UPDATE valo_content_versions SET status='published',published_at=now() WHERE id=$1",
                [id],
              );
              await publisher.query("COMMIT");
            };
            try {
              const reviewedFirst = await reviewed(1, {
                candidate: { body: JSON.stringify({ title: "Synthetic reviewed invoice" }) },
              });
              await release(reviewedFirst);
              await client.query(
                "INSERT INTO valo_documents(id,workspace_id,template_version_id) VALUES($1,$2,$3)",
                [randomUUID(), user, reviewedFirst],
              );
              // The second version's bundle names no title, so a later notice of it would name the template.
              await release(await reviewed(2, {}));
              assert.deepEqual(await written(reviewedFirst), [
                {
                  workspace_id: user,
                  route: "reviewed",
                  kind: "replaced",
                  title: "Synthetic reviewed invoice",
                  version: 1,
                  replacement_version: 2,
                  reason: null,
                  held: false,
                  documents: 1,
                },
              ]);
            } finally {
              await publisher.end();
            }
            // No other workspace was told anything.
            assert.equal(
              (
                await client.query(
                  "SELECT count(*)::int AS n FROM valo_edition_notices WHERE workspace_id=$1",
                  [stranger],
                )
              ).rows[0].n,
              0,
            );
            // In its scope, a workspace reads only its own notices and may mark them read, and nothing else.
            await client.query("BEGIN");
            try {
              await enterWorkspaceScope(client, holder);
              const seen = (await client.query("SELECT id, kind FROM valo_edition_notices ORDER BY kind"))
                .rows;
              assert.deepEqual(
                seen.map((row) => row.kind),
                ["replaced", "withdrawn"],
              );
              const marked = await client.query("UPDATE valo_edition_notices SET read_at=now() WHERE id=$1", [
                seen[0].id,
              ]);
              assert.equal(marked.rowCount, 1);
              await client.query("SAVEPOINT refused");
              for (const statement of [
                "UPDATE valo_edition_notices SET title='Changed'",
                "DELETE FROM valo_edition_notices",
                `INSERT INTO valo_edition_notices(workspace_id,route,edition,kind,title,version,held,documents)
                   VALUES('${holder}','library','${freeFirst}','withdrawn','Forged',1,true,0)`,
              ]) {
                await assert.rejects(
                  client.query(statement),
                  /permission denied for table valo_edition_notices/,
                );
                await client.query("ROLLBACK TO SAVEPOINT refused");
              }
            } finally {
              await client.query("ROLLBACK");
            }
            await client.query("BEGIN");
            try {
              await enterWorkspaceScope(client, stranger);
              assert.equal(
                (await client.query("SELECT count(*)::int AS n FROM valo_edition_notices")).rows[0].n,
                0,
              );
            } finally {
              await client.query("ROLLBACK");
            }
            // The functions that write the notices run as their owner, with a fixed search path.
            const { rows: writers } = await client.query(
              `SELECT p.proname AS name, p.prosecdef AS definer,
                 array_to_string(p.proconfig, ',') AS config
               FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
               WHERE n.nspname='public' AND p.proname IN ('valo_note_library_edition','valo_note_reviewed_edition')
               ORDER BY p.proname`,
            );
            assert.deepEqual(writers, [
              { name: "valo_note_library_edition", definer: true, config: "search_path=pg_catalog, pg_temp" },
              {
                name: "valo_note_reviewed_edition",
                definer: true,
                config: "search_path=pg_catalog, pg_temp",
              },
            ]);
          }),
      );
    for (const tracked of [true, false])
      await t.test(
        `rule changes migration keeps every row, and lets a released rule version leave the check only with the reason, maker and counts recorded in the same transaction, which are never changed (tracked=${tracked})`,
        async () =>
          cluster(async (client, directory) => {
            await applyThrough(client, directory, ruleChangesMigration, tracked);
            await seed(client);
            const before = await assertRollsBack(client, ruleChangesMigration);
            await applyFor(client, ruleChangesMigration, tracked);
            if (!tracked) await raw(client, journalTagsFrom(ruleChangesMigration).slice(1));
            assert.deepEqual(await rows(client), before);
            assert.deepEqual(await schema(client), finalSchema);
            assert.deepEqual(await rowSecurityGaps(client), []);
            const ruleId = "synthetic-migration-change-" + randomUUID();
            const release = (version) =>
              client.query(
                `INSERT INTO valo_rule_releases(id,rule_id,version,status,rule,publication_bundle,manifest_hash,published_at)
                 VALUES($1,$2,$3,'published','{"provenance":"editorial_release"}'::jsonb,'{}'::jsonb,repeat('a',64),now())`,
                [randomUUID(), ruleId, version],
              );
            const setStatus = (version, status) =>
              client.query("UPDATE valo_rule_releases SET status=$3 WHERE rule_id=$1 AND version=$2", [
                ruleId,
                version,
                status,
              ]);
            const reason = "A synthetic reason the businesses that used this version read.";
            const record = (version, kind, replacement = null, extra = {}) =>
              client.query(
                `INSERT INTO valo_rule_changes(rule_id,version,kind,replacement_version,reason,recorded_by,recorded_at,workspaces,results,tasks)
                 VALUES($1,$2,$3,$4,$5,'synthetic-migration-owner',$6,$7,$7,$7)`,
                [
                  ruleId,
                  version,
                  kind,
                  replacement,
                  extra.reason ?? reason,
                  extra.at ?? "2020-01-01T00:00:00Z",
                  99,
                ],
              );
            const inTransaction = async (work) => {
              await client.query("BEGIN");
              try {
                await work();
                await client.query("COMMIT");
              } catch (error) {
                await client.query("ROLLBACK");
                throw error;
              }
            };
            // A workspace saved a result listing version 1 and made a task from it, and deleted another;
            // a second workspace saved a result listing only version 2.
            const workspace = async () => {
              const id = randomUUID();
              await client.query("INSERT INTO valo_workspaces(id,owner_identity_id) VALUES($1,$2)", [
                id,
                "synthetic-phase1-" + id,
              ]);
              return id;
            };
            const user = await workspace(),
              other = await workspace();
            const saved = async (workspaceId, version) => {
              const id = randomUUID();
              await client.query(
                `INSERT INTO valo_assessments(id,workspace_id,facts,facts_hash,result,result_hash,ruleset_version,as_of_date,consent_version,actor_id)
                 VALUES($1,$2,'{}'::jsonb,repeat('b',64),$3::jsonb,repeat('c',64),'synthetic',current_date,'synthetic','synthetic-actor')`,
                [id, workspaceId, JSON.stringify({ items: [{ ruleId, ruleVersion: version }] })],
              );
              return id;
            };
            const userResult = await saved(user, 1);
            await saved(other, 2);
            const task = (deleted) =>
              client.query(
                `INSERT INTO valo_tasks(id,workspace_id,title,notes,assessment_id,rule_id,rule_version,actor_id,deleted_at)
                 VALUES($1,$2,'Synthetic task','',$3,$4,1,'synthetic-actor',$5)`,
                [randomUUID(), user, userResult, ruleId, deleted ? new Date() : null],
              );
            await task(false);
            await task(true);
            await release(1);
            // A version leaves the check only with its record.
            const required = /only with the reason recorded for it in the same transaction/;
            await assert.rejects(setStatus(1, "withdrawn"), required);
            await assert.rejects(setStatus(1, "superseded"), required);
            // A record names a published version, and a reason of 20 to 1,000 characters.
            await assert.rejects(record(2, "withdrawn"), /Only a published rule version/);
            await assert.rejects(
              record(1, "withdrawn", null, { reason: "Too short" }),
              /valo_rule_change_shape/,
            );
            await assert.rejects(record(1, "replaced"), /valo_rule_change_shape/);
            await assert.rejects(record(1, "withdrawn", 2), /valo_rule_change_shape/);
            // A replacement names a version of the same rule that is published by then.
            await assert.rejects(
              inTransaction(async () => {
                await record(1, "replaced", 2);
                await setStatus(1, "superseded");
              }),
              required,
            );
            // Recorded in the same transaction, it lets the version go. The database sets its time and
            // its counts, whatever the insert named: one workspace, its saved result and its live task.
            await inTransaction(async () => {
              await release(2);
              await record(1, "replaced", 2);
              await setStatus(1, "superseded");
            });
            const changes = async () =>
              (
                await client.query(
                  `SELECT version, kind, replacement_version, reason, recorded_by, workspaces, results, tasks,
                          recorded_at > now() - interval '1 minute' AS recent
                     FROM valo_rule_changes WHERE rule_id=$1 ORDER BY version`,
                  [ruleId],
                )
              ).rows;
            const replaced = {
              version: 1,
              kind: "replaced",
              replacement_version: 2,
              reason,
              recorded_by: "synthetic-migration-owner",
              workspaces: 1,
              results: 1,
              tasks: 1,
              recent: true,
            };
            assert.deepEqual(await changes(), [replaced]);
            // A record written in an earlier transaction does not let a later one go.
            await record(2, "withdrawn");
            await assert.rejects(setStatus(2, "withdrawn"), required);
            await inTransaction(async () => {
              await record(2, "withdrawn");
              await setStatus(2, "withdrawn");
            });
            const counted = { workspaces: 1, results: 1, tasks: 0 };
            assert.deepEqual(
              (await changes())
                .slice(1)
                .map(({ workspaces, results, tasks }) => ({ workspaces, results, tasks })),
              [counted, counted],
            );
            // A record is never changed or removed.
            for (const statement of [
              "UPDATE valo_rule_changes SET reason='A changed synthetic reason for the record.'",
              "DELETE FROM valo_rule_changes",
              "TRUNCATE valo_rule_changes",
            ])
              await assert.rejects(client.query(statement), /never changed or removed/);
            assert.equal((await changes()).length, 3);
            // A version that did not leave the check, and a status that is not a change, need no record.
            await release(3);
            await setStatus(3, "published");
            // The customer's role can read no record.
            await client.query("BEGIN");
            try {
              await enterWorkspaceScope(client, user);
              await assert.rejects(
                client.query("SELECT count(*) FROM valo_rule_changes"),
                /permission denied for table valo_rule_changes/,
              );
            } finally {
              await client.query("ROLLBACK");
            }
            // The functions run with a fixed search path; those that read the workspaces' rows or the
            // releases run as their owner.
            const { rows: functions } = await client.query(
              `SELECT p.proname AS name, p.prosecdef AS definer, array_to_string(p.proconfig, ',') AS config
               FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
               WHERE n.nspname='public' AND p.proname LIKE 'valo_rule_change_%' ORDER BY p.proname`,
            );
            const fixed = "search_path=pg_catalog, pg_temp";
            assert.deepEqual(functions, [
              { name: "valo_rule_change_immutable", definer: false, config: fixed },
              { name: "valo_rule_change_record", definer: true, config: fixed },
              { name: "valo_rule_change_required", definer: true, config: fixed },
            ]);
          }),
      );
    for (const tracked of [true, false])
      await t.test(
        `rule change notices migration keeps every row, and in a released rule version's change marks its live tasks for review, calls off their reminders and tells each workspace that saved a result or made a task under it once, which only that workspace reads and marks read (tracked=${tracked})`,
        async () =>
          cluster(async (client, directory) => {
            await applyThrough(client, directory, ruleChangeNoticesMigration, tracked);
            await seed(client);
            const before = await assertRollsBack(client, ruleChangeNoticesMigration);
            await applyFor(client, ruleChangeNoticesMigration, tracked);
            if (!tracked) await raw(client, journalTagsFrom(ruleChangeNoticesMigration).slice(1));
            assert.deepEqual(await rows(client), before);
            assert.deepEqual(await schema(client), finalSchema);
            assert.deepEqual(await rowSecurityGaps(client), []);
            const ruleId = "synthetic-migration-notice-" + randomUUID();
            const release = (version) =>
              client.query(
                `INSERT INTO valo_rule_releases(id,rule_id,version,status,rule,publication_bundle,manifest_hash,published_at)
                 VALUES($1,$2,$3,'published',$4::jsonb,'{}'::jsonb,repeat('a',64),now())`,
                [
                  randomUUID(),
                  ruleId,
                  version,
                  JSON.stringify({ provenance: "editorial_release", title: "Synthetic rule title" }),
                ],
              );
            const reason = "A synthetic reason the businesses that used this version read.";
            const change = async (version, status, replacement = null) => {
              await client.query("BEGIN");
              try {
                await client.query(
                  `INSERT INTO valo_rule_changes(rule_id,version,kind,replacement_version,reason,recorded_by)
                   VALUES($1,$2,$3,$4,$5,'synthetic-migration-owner')`,
                  [ruleId, version, status === "superseded" ? "replaced" : "withdrawn", replacement, reason],
                );
                await client.query(
                  "UPDATE valo_rule_releases SET status=$3 WHERE rule_id=$1 AND version=$2",
                  [ruleId, version, status],
                );
                await client.query("COMMIT");
              } catch (error) {
                await client.query("ROLLBACK");
                throw error;
              }
            };
            const workspace = async () => {
              const id = randomUUID();
              await client.query("INSERT INTO valo_workspaces(id,owner_identity_id) VALUES($1,$2)", [
                id,
                "synthetic-phase1-" + id,
              ]);
              return id;
            };
            // One workspace saved two results listing version 1 and made a live task from it, with two
            // reminders to come and one sent, and deleted another task; one saved a result listing only
            // version 2; one whose data was erased saved one listing version 1; one did nothing.
            const user = await workspace(),
              later = await workspace(),
              erased = await workspace(),
              stranger = await workspace();
            const saved = async (workspaceId, version) => {
              const id = randomUUID();
              await client.query(
                `INSERT INTO valo_assessments(id,workspace_id,facts,facts_hash,result,result_hash,ruleset_version,as_of_date,consent_version,actor_id)
                 VALUES($1,$2,'{}'::jsonb,repeat('b',64),$3::jsonb,repeat('c',64),'synthetic',current_date,'synthetic','synthetic-actor')`,
                [id, workspaceId, JSON.stringify({ items: [{ ruleId, ruleVersion: version }] })],
              );
              return id;
            };
            const first = await saved(user, 1);
            await saved(user, 1);
            await saved(later, 2);
            await saved(erased, 1);
            await client.query(
              "INSERT INTO valo_privacy_tombstones(id,workspace_id,case_id,identity_hash,phase) VALUES($1,$2,$3,$4,'synthetic-quarantine-only')",
              [randomUUID(), erased, randomUUID(), "a".repeat(64)],
            );
            const task = async (deleted) => {
              const id = randomUUID();
              await client.query(
                `INSERT INTO valo_tasks(id,workspace_id,title,notes,assessment_id,rule_id,rule_version,due_date,date_confirmed,actor_id,deleted_at)
                 VALUES($1,$2,'Synthetic task','',$3,$4,1,'2027-01-31',true,'synthetic-actor',$5)`,
                [id, user, first, ruleId, deleted ? new Date() : null],
              );
              return id;
            };
            const live = await task(false);
            await task(true);
            const reminder = (status, offset) =>
              client.query(
                `INSERT INTO valo_reminder_outbox(id,workspace_id,task_id,idempotency_key,scheduled_at,status)
                 VALUES($1,$2,$3,$4,'2027-01-30T09:00:00Z',$5)`,
                [randomUUID(), user, live, `${live}/2027-01-31/${offset}`, status],
              );
            await reminder("held", 1);
            await reminder("pending", 7);
            await reminder("sent", 14);
            await release(1);
            const notices = async (version) =>
              (
                await client.query(
                  `SELECT workspace_id, kind, replacement_version, title, reason, results, tasks, read_at
                     FROM valo_rule_notices WHERE rule_id=$1 AND version=$2 ORDER BY workspace_id`,
                  [ruleId, version],
                )
              ).rows;
            // Refused without its record, a change marks and tells nothing.
            await assert.rejects(
              client.query(
                "UPDATE valo_rule_releases SET status='withdrawn' WHERE rule_id=$1 AND version=1",
                [ruleId],
              ),
              /only with the reason recorded for it/,
            );
            assert.deepEqual(await notices(1), []);
            // Replaced by version 2: the workspace that used version 1 is told once, with the counts; the
            // erased workspace and the others are not. Its live task is marked for review with its date
            // kept, its unsent reminders are called off, and the mark is an event in its log.
            await release(2);
            await change(1, "superseded", 2);
            assert.deepEqual(await notices(1), [
              {
                workspace_id: user,
                kind: "replaced",
                replacement_version: 2,
                title: "Synthetic rule title",
                reason,
                results: 2,
                tasks: 1,
                read_at: null,
              },
            ]);
            const tasks = (
              await client.query(
                "SELECT id, needs_review, due_date::text AS due, deleted_at IS NOT NULL AS deleted FROM valo_tasks WHERE workspace_id=$1 ORDER BY deleted_at NULLS FIRST",
                [user],
              )
            ).rows;
            assert.deepEqual(
              tasks.map(({ needs_review, due, deleted }) => ({ needs_review, due, deleted })),
              [
                { needs_review: true, due: "2027-01-31", deleted: false },
                { needs_review: false, due: "2027-01-31", deleted: true },
              ],
            );
            assert.deepEqual(
              (
                await client.query(
                  "SELECT status, reason FROM valo_reminder_outbox WHERE task_id=$1 ORDER BY idempotency_key",
                  [live],
                )
              ).rows,
              [
                { status: "cancelled", reason: "SOURCE_NO_LONGER_ELIGIBLE" },
                { status: "sent", reason: null },
                { status: "cancelled", reason: "SOURCE_NO_LONGER_ELIGIBLE" },
              ],
            );
            assert.deepEqual(
              (
                await client.query(
                  "SELECT actor_id, action FROM valo_events WHERE workspace_id=$1 AND entity_id=$2",
                  [user, live],
                )
              ).rows,
              [{ actor_id: "service:rule-change", action: "task.source_review_required" }],
            );
            // Withdrawn, version 2 tells only the workspace whose saved result lists it.
            await change(2, "withdrawn");
            assert.deepEqual(await notices(2), [
              {
                workspace_id: later,
                kind: "withdrawn",
                replacement_version: null,
                title: "Synthetic rule title",
                reason,
                results: 1,
                tasks: 0,
                read_at: null,
              },
            ]);
            // In its scope, a workspace reads only its own notices and may mark them read, and nothing else.
            await client.query("BEGIN");
            try {
              await enterWorkspaceScope(client, user);
              const seen = (await client.query("SELECT id, version FROM valo_rule_notices")).rows;
              assert.deepEqual(
                seen.map((row) => row.version),
                [1],
              );
              const marked = await client.query("UPDATE valo_rule_notices SET read_at=now() WHERE id=$1", [
                seen[0].id,
              ]);
              assert.equal(marked.rowCount, 1);
              await client.query("SAVEPOINT refused");
              for (const statement of [
                "UPDATE valo_rule_notices SET reason='A changed synthetic reason for this notice.'",
                "DELETE FROM valo_rule_notices",
                `INSERT INTO valo_rule_notices(workspace_id,rule_id,version,kind,title,reason,results,tasks)
                   VALUES('${user}','${ruleId}',9,'withdrawn','Forged','A forged synthetic reason for a notice.',1,0)`,
              ]) {
                await assert.rejects(
                  client.query(statement),
                  /permission denied for table valo_rule_notices/,
                );
                await client.query("ROLLBACK TO SAVEPOINT refused");
              }
            } finally {
              await client.query("ROLLBACK");
            }
            for (const outsider of [stranger, erased]) {
              await client.query("BEGIN");
              try {
                await enterWorkspaceScope(client, outsider);
                assert.equal(
                  (await client.query("SELECT count(*)::int AS n FROM valo_rule_notices")).rows[0].n,
                  0,
                );
              } finally {
                await client.query("ROLLBACK");
              }
            }
            // The function that writes them runs as its owner, with a fixed search path.
            const { rows: writers } = await client.query(
              `SELECT p.prosecdef AS definer, array_to_string(p.proconfig, ',') AS config
               FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
               WHERE n.nspname='public' AND p.proname='valo_note_rule_change'`,
            );
            assert.deepEqual(writers, [{ definer: true, config: "search_path=pg_catalog, pg_temp" }]);
          }),
      );
    for (const tracked of [true, false])
      await t.test(
        `manual regulatory words migration keeps every source check as it was, with no evidence in words, and takes a new check's evidence in words only as a checksum (tracked=${tracked})`,
        async () =>
          cluster(async (client, directory) => {
            await applyThrough(client, directory, manualRegulatoryWordsMigration, tracked);
            await seed(client);
            const check = (words) =>
              client.query(
                `INSERT INTO valo_manual_regulatory_checks(candidate_id,title,body_sha256,evidence_sha256,checked_at,sources,holds,words_sha256)
                 VALUES('GUD-08','Synthetic words check',repeat('b',64),repeat('c',64),now(),'[]'::jsonb,ARRAY['Synthetic hold'],$1) RETURNING id`,
                [words],
              );
            // A check recorded before the migration is the one a guide may have been signed on.
            const earlier = (
              await client.query(
                `INSERT INTO valo_manual_regulatory_checks(candidate_id,title,body_sha256,evidence_sha256,checked_at,sources,holds)
                 VALUES('GUD-08','Synthetic earlier check',repeat('b',64),repeat('d',64),now(),'[]'::jsonb,ARRAY['Synthetic hold']) RETURNING id`,
              )
            ).rows[0].id;
            const before = await assertRollsBack(client, manualRegulatoryWordsMigration);
            await applyFor(client, manualRegulatoryWordsMigration, tracked);
            if (!tracked) await raw(client, journalTagsFrom(manualRegulatoryWordsMigration).slice(1));
            assert.deepEqual(await rows(client), before);
            assert.deepEqual(await schema(client), finalSchema);
            assert.deepEqual(await rowSecurityGaps(client), []);
            const kept = (
              await client.query(
                "SELECT evidence_sha256, words_sha256 FROM valo_manual_regulatory_checks WHERE id=$1",
                [earlier],
              )
            ).rows[0];
            assert.deepEqual(kept, { evidence_sha256: "d".repeat(64), words_sha256: null });
            assert.equal((await check(null)).rows.length, 1);
            assert.equal((await check("e".repeat(64))).rows.length, 1);
            for (const words of ["E".repeat(64), "e".repeat(63), "synthetic words"])
              await assert.rejects(check(words), /valo_manual_regulatory_words/);
          }),
      );
    for (const tracked of [true, false])
      await t.test(
        `manual reviews migration keeps every entry, dates each published one's review 90 days after its release or last review, records a review only of the published version by an active Content editor, never changes one, and holds an overdue template from new use while its buyers keep it (tracked=${tracked})`,
        async () =>
          cluster(async (client, directory) => {
            await applyThrough(client, directory, manualReviewsMigration, tracked);
            await seed(client);
            const editor = "synthetic-migration-review-" + randomUUID();
            await client.query(
              "INSERT INTO valo_staff_assignments(id,identity_id,role,granted_by,reason) VALUES($1,$2,'content','synthetic migration','Synthetic review editor')",
              [randomUUID(), editor],
            );
            const draft = (id, kind, title = "Synthetic reviewed item", formText = null) => {
              const file = kind === "template" || kind === "premium_template";
              return client.query(
                `INSERT INTO valo_manual_library(id,item_id,version,slug,kind,title,body,digest,file_format,file_bytes,created_by,form_text${file ? releaseDetails.columns : ""})
                 VALUES($1::uuid,$1::uuid,1,'manual-'||($1::uuid)::text,$2,$4,'Synthetic text',repeat('a',64),
                   ${file ? "'docx','\\x01'::bytea" : "NULL,NULL"},$3,$5${file ? releaseDetails.values : ""})`,
                [id, kind, editor, title, formText],
              );
            };
            const publish = (id, daysAgo) =>
              client.query(
                "UPDATE valo_manual_library SET state='published',published_by=$2,published_at=now()-make_interval(days=>$3::int) WHERE id=$1",
                [id, editor, daysAgo],
              );
            // A guide published before the migration is dated from its release.
            const existing = randomUUID();
            await draft(existing, "practical_guide");
            await publish(existing, 10);
            const before = await assertRollsBack(client, manualReviewsMigration);
            await applyFor(client, manualReviewsMigration, tracked);
            if (!tracked) await raw(client, journalTagsFrom(manualReviewsMigration).slice(1));
            assert.deepEqual(await rows(client), before);
            assert.deepEqual(await schema(client), finalSchema);
            assert.deepEqual(await rowSecurityGaps(client), []);
            const due = async (id) =>
              (
                await client.query(
                  "SELECT round(extract(epoch FROM public.valo_manual_review_due($1) - (SELECT published_at FROM valo_manual_library WHERE id=$1)) / 86400)::int AS days",
                  [id],
                )
              ).rows[0].days;
            assert.equal(await due(existing), 90);
            // A Content editor's review of the published version is recorded at its own moment, and
            // the next review is due 90 days after it.
            const review = (
              id,
              by = editor,
              note = "Synthetic: re-read against what it relies on, no change needed.",
            ) =>
              client.query(
                "INSERT INTO valo_manual_reviews(edition,reviewed_by,reviewed_at,note) VALUES($1,$2,now()-interval '30 days',$3) RETURNING id,reviewed_at",
                [id, by, note],
              );
            const [recorded] = (await review(existing)).rows;
            assert.ok(Date.now() - +recorded.reviewed_at < 60_000, "a review is dated when it is recorded");
            const { rows: next } = await client.query(
              "SELECT round(extract(epoch FROM public.valo_manual_review_due($1) - $2::timestamptz) / 86400)::int AS days",
              [existing, recorded.reviewed_at],
            );
            assert.equal(next[0].days, 90);
            // Nobody else reviews, a review needs its note, and only the published version is reviewed.
            await assert.rejects(
              review(existing, "synthetic-not-an-editor"),
              /An active content editor is required/,
            );
            await assert.rejects(review(existing, editor, "Too short."), /valo_manual_review_note/);
            const unreleased = randomUUID();
            await draft(unreleased, "practical_guide");
            await assert.rejects(review(unreleased), /Only the published version/);
            // A review is never changed or removed.
            await assert.rejects(
              client.query("UPDATE valo_manual_reviews SET note=note||' changed' WHERE id=$1", [recorded.id]),
              /A review keeps what it recorded/,
            );
            await assert.rejects(
              client.query("DELETE FROM valo_manual_reviews WHERE id=$1", [recorded.id]),
              /A review keeps what it recorded/,
            );
            // A free template overdue for review is neither listed to save, copied into a new document nor
            // started as a form, and a premium one is listed for its buyers as held, until it is reviewed.
            const current = randomUUID(),
              overdue = randomUUID(),
              premium = randomUUID();
            const formTitle = (id) => "Synthetic form " + id;
            for (const [id, days] of [
              [current, 5],
              [overdue, 91],
            ]) {
              await draft(id, "template", formTitle(id), "Synthetic form text");
              await publish(id, days);
            }
            await draft(premium, "premium_template");
            await publish(premium, 91);
            const offered = async () => {
              await client.query("BEGIN");
              try {
                await enterWorkspaceScope(client, randomUUID());
                const listed = (
                  await client.query("SELECT id FROM public.valo_live_manual_templates()")
                ).rows.map((row) => row.id);
                const copied = [],
                  formed = [];
                for (const id of [current, overdue]) {
                  if (
                    (await client.query("SELECT edition FROM public.valo_free_library_edition($1)", [id]))
                      .rows.length
                  )
                    copied.push(id);
                  const { rows: form } = await client.query(
                    "SELECT edition FROM public.valo_free_form_edition($1)",
                    [formTitle(id)],
                  );
                  if (form[0]?.edition === id) formed.push(id);
                }
                const held = [
                  ...(
                    await client.query(
                      "SELECT held FROM public.valo_live_manual_premium_versions(NULL) WHERE edition = $1",
                      [premium],
                    )
                  ).rows,
                  ...(
                    await client.query(
                      "SELECT edition, held FROM public.valo_live_manual_premium_versions($1)",
                      [premium],
                    )
                  ).rows.filter((row) => row.edition === premium),
                ].map((row) => row.held);
                return {
                  listed: [current, overdue, premium].filter((id) => listed.includes(id)),
                  copied,
                  formed,
                  held,
                };
              } finally {
                await client.query("ROLLBACK");
              }
            };
            assert.deepEqual(await offered(), {
              listed: [current],
              copied: [current],
              formed: [current],
              held: [true, true],
            });
            await review(overdue);
            await review(premium);
            assert.deepEqual(await offered(), {
              listed: [current, overdue, premium],
              copied: [current, overdue],
              formed: [current, overdue],
              held: [false, false],
            });
          }),
      );
    for (const tracked of [true, false])
      await t.test(
        `manual changes migration keeps every entry, releases a version that follows an earlier release only with what changed, keeps the note as written, and gives it to the replaced edition's notice (tracked=${tracked})`,
        async () =>
          cluster(async (client, directory) => {
            await applyThrough(client, directory, manualChangesMigration, tracked);
            await seed(client);
            const editor = "synthetic-migration-changes-" + randomUUID();
            await client.query(
              "INSERT INTO valo_staff_assignments(id,identity_id,role,granted_by,reason) VALUES($1,$2,'content','synthetic migration','Synthetic change notes')",
              [randomUUID(), editor],
            );
            const edition = async (item, version) => {
              const id = version === 1 ? item : randomUUID();
              await client.query(
                `INSERT INTO valo_manual_library(id,item_id,version,slug,kind,title,body,digest,file_format,file_bytes,created_by${releaseDetails.columns})
                 VALUES($1::uuid,$2::uuid,$3,'manual-'||($2::uuid)::text,'template','Synthetic changed register','Synthetic text',repeat('a',64),'docx','\x01'::bytea,$4${releaseDetails.values})`,
                [id, item, version, editor],
              );
              return id;
            };
            const publish = (id) =>
              client.query(
                "UPDATE valo_manual_library SET state='published',published_by=$2,published_at=now() WHERE id=$1",
                [id, editor],
              );
            const replace = (id) =>
              client.query(
                "UPDATE valo_manual_library SET state='replaced',closed_by=$2,closed_at=now() WHERE id=$1",
                [id, editor],
              );
            // An entry replaced before the migration keeps its versions as they were, with no note.
            const earlier = randomUUID();
            const earlierFirst = await edition(earlier, 1);
            await publish(earlierFirst);
            const earlierSecond = await edition(earlier, 2);
            await replace(earlierFirst);
            await publish(earlierSecond);
            const before = await assertRollsBack(client, manualChangesMigration);
            await applyFor(client, manualChangesMigration, tracked);
            if (!tracked) await raw(client, journalTagsFrom(manualChangesMigration).slice(1));
            assert.deepEqual(await rows(client), before);
            assert.deepEqual(await schema(client), finalSchema);
            assert.deepEqual(await rowSecurityGaps(client), []);
            const said = "Synthetic: the second clause now names the payment date.";
            const note = (id, text = said) =>
              client.query("INSERT INTO valo_manual_changes(edition,note,recorded_by) VALUES($1,$2,$3)", [
                id,
                text,
                editor,
              ]);
            // A first release takes no note, and needs none. A workspace makes a document from it.
            const item = randomUUID();
            const first = await edition(item, 1);
            await assert.rejects(
              note(first),
              /A change note is written for a draft that follows an earlier release/,
            );
            await publish(first);
            const workspace = randomUUID();
            await client.query("INSERT INTO valo_workspaces(id,owner_identity_id) VALUES($1,$2)", [
              workspace,
              "synthetic-phase1-" + workspace,
            ]);
            await client.query(
              "INSERT INTO valo_documents(id,workspace_id,library_edition) VALUES($1,$2,$3)",
              [randomUUID(), workspace, first],
            );
            // A later version is released only with what changed, written in the same transaction.
            const second = await edition(item, 2);
            await client.query("BEGIN");
            try {
              await replace(first);
              await assert.rejects(publish(second), /Say what changed in this version/);
            } finally {
              await client.query("ROLLBACK");
            }
            await assert.rejects(note(second, "Too short."), /valo_manual_change_note/);
            await client.query("BEGIN");
            try {
              await note(second);
              await replace(first);
              await publish(second);
              await client.query("COMMIT");
            } catch (error) {
              await client.query("ROLLBACK");
              throw error;
            }
            // The note is kept as written, and the notice that the first edition was replaced carries it.
            await assert.rejects(
              client.query("UPDATE valo_manual_changes SET note=note||' changed' WHERE edition=$1", [second]),
              /A change note keeps what it said/,
            );
            await assert.rejects(
              client.query("DELETE FROM valo_manual_changes WHERE edition=$1", [second]),
              /A change note keeps what it said/,
            );
            assert.deepEqual(
              (
                await client.query(
                  "SELECT workspace_id, kind, version, replacement_version, reason FROM valo_edition_notices WHERE edition=$1",
                  [first],
                )
              ).rows,
              [
                {
                  workspace_id: workspace,
                  kind: "replaced",
                  version: 1,
                  replacement_version: 2,
                  reason: said,
                },
              ],
            );
          }),
      );
    for (const tracked of [true, false])
      await t.test(
        `manual reach migration keeps every entry and notice, gives each workspace a library edition reaches once, and writes a withdrawal's notices from those rows (tracked=${tracked})`,
        async () =>
          cluster(async (client, directory) => {
            await applyThrough(client, directory, manualReachMigration, tracked);
            await seed(client);
            const editor = "synthetic-migration-reach-" + randomUUID();
            await client.query(
              "INSERT INTO valo_staff_assignments(id,identity_id,role,granted_by,reason) VALUES($1,$2,'content','synthetic migration','Synthetic edition reach')",
              [randomUUID(), editor],
            );
            const workspace = async () => {
              const id = randomUUID();
              await client.query("INSERT INTO valo_workspaces(id,owner_identity_id) VALUES($1,$2)", [
                id,
                "synthetic-phase1-" + id,
              ]);
              return id;
            };
            const edition = async (item, version, kind) => {
              const id = randomUUID();
              const file = kind === "practical_guide" ? ["NULL", "NULL"] : ["'docx'", "'\\x01'::bytea"];
              await client.query(
                kind === "practical_guide"
                  ? `INSERT INTO valo_manual_library(id,item_id,version,slug,kind,title,body,digest,created_by)
                     VALUES($1::uuid,$2::uuid,$3,'manual-'||($2::uuid)::text,$4,'Synthetic reached guide','Synthetic text',repeat('a',64),$5)`
                  : `INSERT INTO valo_manual_library(id,item_id,version,slug,kind,title,body,digest,file_format,file_bytes,created_by${releaseDetails.columns})
                     VALUES($1::uuid,$2::uuid,$3,'manual-'||($2::uuid)::text,$4,'Synthetic reached register','Synthetic text',repeat('a',64),${file[0]},${file[1]},$5${releaseDetails.values})`,
                [id, item, version, kind, editor],
              );
              return id;
            };
            const publish = (id) =>
              client.query(
                "UPDATE valo_manual_library SET state='published',published_by=$2,published_at=now() WHERE id=$1",
                [id, editor],
              );
            const document = (workspaceId, editionId) =>
              client.query("INSERT INTO valo_documents(id,workspace_id,library_edition) VALUES($1,$2,$3)", [
                randomUUID(),
                workspaceId,
                editionId,
              ]);
            // A free template that two workspaces made documents from, and a premium one that a workspace
            // bought, while another only started an order of it.
            const copier = await workspace(),
              other = await workspace(),
              buyer = await workspace(),
              starter = await workspace();
            const freeItem = randomUUID(),
              premiumItem = randomUUID();
            const free = await edition(freeItem, 1, "template"),
              premium = await edition(premiumItem, 1, "premium_template");
            await publish(free);
            await publish(premium);
            await document(copier, free);
            await document(copier, free);
            await document(other, free);
            const price = randomUUID();
            await client.query(
              `INSERT INTO valo_prices(id,content_version_id,title,amount_kobo,licence_version,licence_text,tax_treatment,approval_reference,effective_from)
               VALUES($1,$2,'Synthetic reached premium',100,'synthetic-licence','Not a sales licence','No tax assertion','SYNTHETIC-NOT-APPROVED',now())`,
              [price, premium],
            );
            const buy = async (workspaceId, status) => {
              const id = randomUUID();
              await client.query(
                `INSERT INTO valo_orders(id,workspace_id,requested_by,reference,request_key,price_id,line,amount_kobo,status,provider_transaction_id)
                 VALUES($1,$2,'synthetic-phase1-owner',$3,$4,$5,$6,100,$7,$8)`,
                [
                  id,
                  workspaceId,
                  "synthetic-" + id,
                  randomUUID(),
                  price,
                  JSON.stringify({ contentVersionId: premium, licenceVersion: "synthetic-licence" }),
                  status,
                  status === "verified_success" ? "synthetic-" + id : null,
                ],
              );
              if (status === "verified_success")
                await client.query(
                  "INSERT INTO valo_entitlements(id,workspace_id,order_id,content_version_id) VALUES($1,$2,$3,$4)",
                  [randomUUID(), workspaceId, id, premium],
                );
            };
            await buy(buyer, "verified_success");
            await buy(starter, "pending");
            const before = await assertRollsBack(client, manualReachMigration);
            await applyFor(client, manualReachMigration, tracked);
            if (!tracked) await raw(client, journalTagsFrom(manualReachMigration).slice(1));
            assert.deepEqual(await rows(client), before);
            assert.deepEqual(await schema(client), finalSchema);
            assert.deepEqual(await rowSecurityGaps(client), []);
            const reach = async (editionId) =>
              (
                await client.query(
                  "SELECT workspace_id, held, documents FROM valo_manual_edition_reach($1) ORDER BY workspace_id",
                  [editionId],
                )
              ).rows;
            const byWorkspace = (list) => list.sort((a, b) => (a.workspace_id < b.workspace_id ? -1 : 1));
            // Each workspace once: the copier with its two documents, the other with one, and the buyer of
            // the premium template; the workspace whose order was only started is not reached.
            assert.deepEqual(
              await reach(free),
              byWorkspace([
                { workspace_id: copier, held: false, documents: 2 },
                { workspace_id: other, held: false, documents: 1 },
              ]),
            );
            assert.deepEqual(await reach(premium), [{ workspace_id: buyer, held: true, documents: 0 }]);
            // A guide has no buyers or documents.
            const guide = await edition(randomUUID(), 1, "practical_guide");
            await publish(guide);
            assert.deepEqual(await reach(guide), []);
            // A buyer of an earlier edition is reached by the next one too, as its notices count them.
            const premiumSecond = await edition(premiumItem, 2, "premium_template");
            await client.query("BEGIN");
            try {
              await noteChange(client, premiumSecond, editor);
              await client.query(
                "UPDATE valo_manual_library SET state='replaced',closed_by=$2,closed_at=now() WHERE id=$1",
                [premium, editor],
              );
              await publish(premiumSecond);
              await client.query("COMMIT");
            } catch (error) {
              await client.query("ROLLBACK");
              throw error;
            }
            assert.deepEqual(await reach(premiumSecond), [{ workspace_id: buyer, held: true, documents: 0 }]);
            // The notices of a withdrawal are the rows its reach gave just before it.
            const reached = await reach(free);
            await client.query(
              "INSERT INTO valo_manual_withdrawals(edition,reason,recorded_by) VALUES($1,$2,$3)",
              [free, "A synthetic reason the customers who used this version read.", editor],
            );
            await client.query(
              "UPDATE valo_manual_library SET state='withdrawn',closed_by=$2,closed_at=now() WHERE id=$1",
              [free, editor],
            );
            assert.deepEqual(
              (
                await client.query(
                  "SELECT workspace_id, held, documents FROM valo_edition_notices WHERE edition=$1 AND kind='withdrawn' ORDER BY workspace_id",
                  [free],
                )
              ).rows,
              reached,
            );
            assert.deepEqual(
              (
                await client.query(
                  "SELECT workspace_id, held, documents FROM valo_edition_notices WHERE edition=$1 AND kind='replaced' ORDER BY workspace_id",
                  [premium],
                )
              ).rows,
              [{ workspace_id: buyer, held: true, documents: 0 }],
            );
            // A customer request, in its workspace's scope, cannot count other workspaces.
            await client.query("BEGIN");
            try {
              await enterWorkspaceScope(client, copier);
              await assert.rejects(
                client.query("SELECT * FROM valo_manual_edition_reach($1)", [free]),
                /permission denied for function valo_manual_edition_reach/,
              );
            } finally {
              await client.query("ROLLBACK");
            }
          }),
      );
    for (const tracked of [true, false])
      await t.test(
        `manual holds migration keeps every entry, holds only a published version, from an active Content editor, keeps it from new use until a Content editor lifts it, and never changes a hold or its lifting (tracked=${tracked})`,
        async () =>
          cluster(async (client, directory) => {
            await applyThrough(client, directory, manualHoldsMigration, tracked);
            await seed(client);
            const editor = "synthetic-migration-holds-" + randomUUID();
            await client.query(
              "INSERT INTO valo_staff_assignments(id,identity_id,role,granted_by,reason) VALUES($1,$2,'content','synthetic migration','Synthetic hold editor')",
              [randomUUID(), editor],
            );
            const draft = (id, kind, title = "Synthetic held item", formText = null) => {
              const file = kind === "template" || kind === "premium_template";
              return client.query(
                `INSERT INTO valo_manual_library(id,item_id,version,slug,kind,title,body,digest,file_format,file_bytes,created_by,form_text${file ? releaseDetails.columns : ""})
                 VALUES($1::uuid,$1::uuid,1,'manual-'||($1::uuid)::text,$2,$4,'Synthetic text',repeat('a',64),
                   ${file ? "'docx','\\x01'::bytea" : "NULL,NULL"},$3,$5${file ? releaseDetails.values : ""})`,
                [id, kind, editor, title, formText],
              );
            };
            const publish = (id) =>
              client.query(
                "UPDATE valo_manual_library SET state='published',published_by=$2,published_at=now() WHERE id=$1",
                [id, editor],
              );
            // A free template with its form, a premium template and another free template, published before
            // the migration, and a guide that is only a draft.
            const free = randomUUID(),
              other = randomUUID(),
              premium = randomUUID(),
              unreleased = randomUUID();
            const formTitle = (id) => "Synthetic held form " + id;
            for (const id of [free, other]) {
              await draft(id, "template", formTitle(id), "Synthetic form text");
              await publish(id);
            }
            await draft(premium, "premium_template");
            await publish(premium);
            await draft(unreleased, "practical_guide");
            const before = await assertRollsBack(client, manualHoldsMigration);
            await applyFor(client, manualHoldsMigration, tracked);
            if (!tracked) await raw(client, journalTagsFrom(manualHoldsMigration).slice(1));
            assert.deepEqual(await rows(client), before);
            assert.deepEqual(await schema(client), finalSchema);
            assert.deepEqual(await rowSecurityGaps(client), []);
            // What a workspace is offered of the three published templates.
            const offered = async () => {
              await client.query("BEGIN");
              try {
                await enterWorkspaceScope(client, randomUUID());
                const listed = (
                  await client.query("SELECT id FROM public.valo_live_manual_templates()")
                ).rows.map((row) => row.id);
                const copied = [],
                  formed = [];
                for (const id of [free, other]) {
                  if (
                    (await client.query("SELECT edition FROM public.valo_free_library_edition($1)", [id]))
                      .rows.length
                  )
                    copied.push(id);
                  const { rows: form } = await client.query(
                    "SELECT edition FROM public.valo_free_form_edition($1)",
                    [formTitle(id)],
                  );
                  if (form[0]?.edition === id) formed.push(id);
                }
                const { rows: premiums } = await client.query(
                  "SELECT held FROM public.valo_live_manual_premium_versions($1)",
                  [premium],
                );
                return {
                  listed: [free, other, premium].filter((id) => listed.includes(id)),
                  copied,
                  formed,
                  premiumHeld: premiums.map((row) => row.held),
                };
              } finally {
                await client.query("ROLLBACK");
              }
            };
            const all = {
              listed: [free, other, premium],
              copied: [free, other],
              formed: [free, other],
              premiumHeld: [false],
            };
            assert.deepEqual(await offered(), all);
            const reason = "Synthetic: held while its payment clause is checked.";
            const hold = (edition, by = editor, why = reason) =>
              client.query(
                "INSERT INTO valo_manual_holds(edition,reason,placed_by,placed_at,workspaces) VALUES($1,$2,$3,now()-interval '30 days',99) RETURNING id,placed_at,workspaces",
                [edition, why, by],
              );
            // Only a published version is held, by an active Content editor, with its reason.
            await assert.rejects(hold(unreleased), /Only the published version of a library entry is held/);
            await assert.rejects(
              hold(free, "synthetic-not-an-editor"),
              /An active content editor is required/,
            );
            await assert.rejects(hold(free, editor, "Too short."), /valo_manual_hold_record/);
            // The database dates the hold and counts the workspaces it touched itself.
            const workspace = randomUUID();
            await client.query("INSERT INTO valo_workspaces(id,owner_identity_id) VALUES($1,$2)", [
              workspace,
              "synthetic-phase1-" + workspace,
            ]);
            await client.query(
              "INSERT INTO valo_documents(id,workspace_id,library_edition) VALUES($1,$2,$3)",
              [randomUUID(), workspace, free],
            );
            const [placed] = (await hold(free)).rows;
            assert.ok(Date.now() - +placed.placed_at < 60_000, "a hold is dated when it is placed");
            assert.equal(placed.workspaces, 1);
            await assert.rejects(hold(free), /This version is already held/);
            const [premiumHold] = (await hold(premium)).rows;
            // Held, the two leave new use; the other template stays available.
            assert.deepEqual(await offered(), {
              listed: [other],
              copied: [other],
              formed: [other],
              premiumHeld: [true],
            });
            // A hold is never changed or removed.
            await assert.rejects(
              client.query("UPDATE valo_manual_holds SET reason=reason||' changed' WHERE id=$1", [placed.id]),
              /A hold keeps what it recorded/,
            );
            await assert.rejects(
              client.query("DELETE FROM valo_manual_holds WHERE id=$1", [placed.id]),
              /A hold keeps what it recorded/,
            );
            // A Content editor lifts it once, with why; nobody else lifts it, and the lifting never changes.
            const lift = (id, by = editor, why = "Synthetic: the payment clause was checked and is right.") =>
              client.query(
                "INSERT INTO valo_manual_hold_lifts(hold,reason,lifted_by,lifted_at) VALUES($1,$2,$3,now()-interval '30 days') RETURNING lifted_at",
                [id, why, by],
              );
            await assert.rejects(
              lift(placed.id, "synthetic-not-an-editor"),
              /An active content editor is required/,
            );
            await assert.rejects(lift(placed.id, editor, "Too short."), /valo_manual_hold_lift_reason/);
            const [lifted] = (await lift(placed.id)).rows;
            assert.ok(Date.now() - +lifted.lifted_at < 60_000, "a lifting is dated when it is recorded");
            await assert.rejects(lift(placed.id), /valo_manual_hold_lifts_pkey/);
            await assert.rejects(
              client.query("UPDATE valo_manual_hold_lifts SET reason=reason||' changed' WHERE hold=$1", [
                placed.id,
              ]),
              /A lifted hold keeps what it recorded/,
            );
            await assert.rejects(
              client.query("DELETE FROM valo_manual_hold_lifts WHERE hold=$1", [placed.id]),
              /A lifted hold keeps what it recorded/,
            );
            await lift(premiumHold.id);
            assert.deepEqual(await offered(), all);
            // Once lifted, the version can be held again.
            await hold(free);
            assert.deepEqual((await offered()).copied, [other]);
          }),
      );
    for (const tracked of [true, false])
      await t.test(
        `library escalations migration keeps every referral, lets one point at a library edition, links only a hold on that edition, once, and never changes the version a referral points at (tracked=${tracked})`,
        async () =>
          cluster(async (client, directory) => {
            await applyThrough(client, directory, libraryEscalationsMigration, tracked);
            await seed(client);
            const editor = "synthetic-migration-referrals-" + randomUUID();
            await client.query(
              "INSERT INTO valo_staff_assignments(id,identity_id,role,granted_by,reason) VALUES($1,$2,'content','synthetic migration','Synthetic referral editor')",
              [randomUUID(), editor],
            );
            // Two published templates, and a workspace's support request with a referral of a reviewed
            // version made before the migration.
            const [referred, other] = [randomUUID(), randomUUID()];
            for (const id of [referred, other]) {
              await client.query(
                `INSERT INTO valo_manual_library(id,item_id,version,slug,kind,title,body,digest,file_format,file_bytes,created_by${releaseDetails.columns})
                 VALUES($1::uuid,$1::uuid,1,'manual-'||($1::uuid)::text,'template','Synthetic referred template','Synthetic text',repeat('b',64),'docx','\\x01'::bytea,$2${releaseDetails.values})`,
                [id, editor],
              );
              await client.query(
                "UPDATE valo_manual_library SET state='published',published_by=$2,published_at=now() WHERE id=$1",
                [id, editor],
              );
            }
            const [workspace, ticket] = [randomUUID(), randomUUID()];
            await client.query("INSERT INTO valo_workspaces(id,owner_identity_id) VALUES($1,$2)", [
              workspace,
              "synthetic-phase1-" + workspace,
            ]);
            await client.query(
              `INSERT INTO valo_support_tickets(id,workspace_id,category,scope,contact_email,sharing_consent,consent_version)
               VALUES($1,$2,'support','Synthetic reported problem','synthetic@example.invalid',false,'service-sharing-v1')`,
              [ticket, workspace],
            );
            await client.query(
              "INSERT INTO valo_support_cases(id,source_kind,ticket_id,workspace_id) VALUES($1,'workspace',$1,$2)",
              [ticket, workspace],
            );
            const refer = (kind, target, version = 1) =>
              client.query(
                "INSERT INTO valo_support_escalations(id,case_id,target_kind,target_id,target_hash,target_version,reason) VALUES($1,$2,$3,$4,repeat('b',64),$5,'Synthetic referral reason') RETURNING id",
                [randomUUID(), ticket, kind, target, version],
              );
            const [reviewed] = (await refer("content", randomUUID())).rows;
            const referrals = async (without = "") =>
              (
                await client.query(
                  `SELECT to_jsonb(e)${without} AS record FROM valo_support_escalations e ORDER BY id`,
                )
              ).rows;
            const referred0 = await referrals();
            const before = await assertRollsBack(client, libraryEscalationsMigration);
            await applyFor(client, libraryEscalationsMigration, tracked);
            if (!tracked) await raw(client, journalTagsFrom(libraryEscalationsMigration).slice(1));
            assert.deepEqual(await rows(client), before);
            // The referral made before is kept as it was, with no hold.
            assert.deepEqual(await referrals("-'library_hold_id'"), referred0);
            assert.deepEqual(await schema(client), finalSchema);
            assert.deepEqual(await rowSecurityGaps(client), []);
            // A referral may now point at a library edition.
            const [library] = (await refer("library", referred)).rows;
            await assert.rejects(refer("guide", referred), /valo_support_escalations_target_kind_check/);
            const hold = async (edition) =>
              (
                await client.query(
                  "INSERT INTO valo_manual_holds(edition,reason,placed_by) VALUES($1,'Synthetic: held after a reported problem.',$2) RETURNING id",
                  [edition, editor],
                )
              ).rows[0].id;
            const link = (id, holdId) =>
              client.query("UPDATE valo_support_escalations SET library_hold_id=$2 WHERE id=$1", [
                id,
                holdId,
              ]);
            // A library hold belongs to a library referral, and a source impact to the reviewed route's. The
            // trigger refuses a hold on another version first; the check refuses a library hold on a
            // referral of a reviewed version even where its identifier is the hold's edition.
            const [onReferred, onOther] = [await hold(referred), await hold(other)];
            await assert.rejects(
              link(reviewed.id, onReferred),
              /A referral is held only by a hold on the version it points at/,
            );
            const [lookalike] = (await refer("content", referred)).rows;
            await assert.rejects(link(lookalike.id, onReferred), /valo_support_escalation_hold_kind/);
            await assert.rejects(
              client.query("UPDATE valo_support_escalations SET source_impact_id=$2 WHERE id=$1", [
                library.id,
                randomUUID(),
              ]),
              /valo_support_escalation_hold_kind/,
            );
            // It links only a hold on the edition it points at, and keeps it.
            await assert.rejects(
              link(library.id, onOther),
              /A referral is held only by a hold on the version it points at/,
            );
            await assert.rejects(
              link(library.id, randomUUID()),
              /A referral is held only by a hold on the version it points at/,
            );
            await link(library.id, onReferred);
            await assert.rejects(link(library.id, null), /A referral keeps the hold it placed/);
            await assert.rejects(link(library.id, onOther), /A referral keeps the hold it placed/);
            // No referral changes the version it points at, while its reason can still be replaced by an
            // erasure.
            for (const [column, value] of [
              ["target_id", other],
              ["target_version", 2],
              ["target_hash", "c".repeat(64)],
            ])
              await assert.rejects(
                client.query(`UPDATE valo_support_escalations SET ${column}=$2 WHERE id=$1`, [
                  reviewed.id,
                  value,
                ]),
                /A referral keeps the version it points at/,
              );
            await client.query(
              "UPDATE valo_support_escalations SET reason='Synthetic removed reason',status='resolved' WHERE id=ANY($1)",
              [[reviewed.id, library.id]],
            );
            const { rows: kept } = await client.query(
              "SELECT target_kind,library_hold_id,reason,status FROM valo_support_escalations WHERE id=$1",
              [library.id],
            );
            assert.deepEqual(kept, [
              {
                target_kind: "library",
                library_hold_id: onReferred,
                reason: "Synthetic removed reason",
                status: "resolved",
              },
            ]);
          }),
      );
    for (const tracked of [true, false])
      await t.test(
        `guidance record migration keeps every revision and a guide released before it, refuses a regulatory guide's release without whom it applies to, and never changes a saved record (tracked=${tracked})`,
        async () =>
          cluster(async (client, directory) => {
            await applyThrough(client, directory, guidanceRecordMigration, tracked);
            await seed(client);
            const editor = "synthetic-migration-record-" + randomUUID();
            await client.query(
              "INSERT INTO valo_staff_assignments(id,identity_id,role,granted_by,reason) VALUES($1,$2,'content','synthetic migration','Synthetic record editor')",
              [randomUUID(), editor],
            );
            // The designated development owner, who alone releases a regulatory guide (decision 0018).
            const ownerAssignment = randomUUID(),
              owner = "synthetic-migration-record-owner";
            await client.query(
              "INSERT INTO valo_staff_assignments(id,identity_id,role,granted_by,reason) VALUES($1,$2,'system','synthetic migration','Synthetic guide owner fixture')",
              [ownerAssignment, owner],
            );
            await client.query(
              `INSERT INTO valo_staff_role_changes(id,request_key,input_hash,actor_id,actor_assignment_id,assignment_id,target_identity_id,action,role,reason,after_state)
               VALUES (gen_random_uuid(),gen_random_uuid(),repeat('b',64),'operator-bootstrap:synthetic',$1,$1,$2,'grant','system','Synthetic guide owner bootstrap','{"active":true}'::jsonb)`,
              [ownerAssignment, owner],
            );
            // A regulatory draft, with a record once the migration has added its columns.
            const article = async (title, body, record) =>
              (record === undefined
                ? await client.query(
                    `INSERT INTO valo_manual_library(id,item_id,version,slug,kind,title,body,digest,created_by)
                     VALUES($1::uuid,$1::uuid,1,'manual-'||($1::uuid)::text,'regulatory_article',$2,$3,repeat('a',64),$4) RETURNING id`,
                    [randomUUID(), title, body, editor],
                  )
                : await client.query(
                    `INSERT INTO valo_manual_library(id,item_id,version,slug,kind,title,body,digest,created_by,applies_to,action_evidence,related_templates)
                     VALUES($1::uuid,$1::uuid,1,'manual-'||($1::uuid)::text,'regulatory_article',$2,$3,repeat('a',64),$4,$5,$6,$7::text[]) RETURNING id`,
                    [
                      randomUUID(),
                      title,
                      body,
                      editor,
                      record.appliesTo ?? null,
                      record.actionEvidence ?? null,
                      record.relatedTemplates ?? null,
                    ],
                  )
              ).rows[0].id;
            // A current source check of a guide's exact title and text, with one source. Each guide is its
            // own registered candidate, since a candidate has one published article.
            const sourceCheck = async (candidate, title, body) =>
              (
                await client.query(
                  `INSERT INTO valo_manual_regulatory_checks(candidate_id,title,body_sha256,evidence_sha256,checked_at,sources,holds)
                   VALUES($3,$1,encode(sha256(convert_to($2,'UTF8')),'hex'),repeat('c',64),now(),
                     jsonb_build_array(jsonb_build_object('url','https://example.invalid/act','title','Synthetic Act','locator','s. 1',
                       'rawSha256',repeat('d',64),'validThrough',(now()+interval '30 days')::text,'retrievedAt',now()::text,'retrieval','official_url')),
                     '{}') RETURNING id`,
                  [title, body, candidate],
                )
              ).rows[0].id;
            const release = (row, check) =>
              client.query(
                "UPDATE valo_manual_library SET state='published',published_by=$2,published_at=now(),regulatory_check_id=$3 WHERE id=$1",
                [row, owner, check],
              );
            // A guide released before the migration, and a draft saved before it.
            const released = await article("Synthetic released guide", "Synthetic released text");
            await release(
              released,
              await sourceCheck("GUD-01", "Synthetic released guide", "Synthetic released text"),
            );
            const draft = await article("Synthetic later guide", "Synthetic later text");
            const library = async () =>
              (
                await client.query(
                  "SELECT to_jsonb(l)-'applies_to'-'action_evidence'-'related_templates' AS record FROM valo_manual_library l ORDER BY id",
                )
              ).rows;
            const kept = await library();
            const before = await assertRollsBack(client, guidanceRecordMigration);
            await applyFor(client, guidanceRecordMigration, tracked);
            if (!tracked) await raw(client, journalTagsFrom(guidanceRecordMigration).slice(1));
            assert.deepEqual(await rows(client), before);
            // Every revision is kept as it was, with no record.
            assert.deepEqual(await library(), kept);
            assert.equal(
              (
                await client.query(
                  "SELECT count(*)::int AS n FROM valo_manual_library WHERE applies_to IS NOT NULL OR action_evidence IS NOT NULL OR related_templates IS NOT NULL",
                )
              ).rows[0].n,
              0,
            );
            assert.deepEqual(await schema(client), finalSchema);
            assert.deepEqual(await rowSecurityGaps(client), []);
            // The draft saved before is released only with whom it applies to, on its own source check.
            const draftCheck = await sourceCheck("GUD-02", "Synthetic later guide", "Synthetic later text");
            await assert.rejects(
              release(draft, draftCheck),
              /A regulatory guide is released with whom it applies to/,
            );
            // Only a regulatory article has a record, within its limits, naming registered template numbers.
            await assert.rejects(
              client.query(
                `INSERT INTO valo_manual_library(id,item_id,version,slug,kind,title,body,digest,created_by,applies_to)
                 VALUES($1::uuid,$1::uuid,1,'manual-'||($1::uuid)::text,'practical_guide','Synthetic guide','Synthetic text',repeat('a',64),$2,'Anyone')`,
                [randomUUID(), editor],
              ),
              /valo_manual_guidance_record/,
            );
            for (const bad of [
              { appliesTo: "" },
              { appliesTo: "x".repeat(801) },
              { appliesTo: "Employers", actionEvidence: "" },
              { appliesTo: "Employers", relatedTemplates: [] },
              { appliesTo: "Employers", relatedTemplates: ["TPL-1"] },
              { appliesTo: "Employers", relatedTemplates: ["tpl-16"] },
              {
                appliesTo: "Employers",
                relatedTemplates: ["TPL-01", "TPL-02", "TPL-03", "TPL-04", "TPL-05", "TPL-06", "TPL-07"],
              },
            ])
              await assert.rejects(
                article("Synthetic refused record", "Synthetic text", bad),
                /valo_manual_guidance_record/,
              );
            // A guide saved with whom it applies to passes that check, and the next one holds: the owner's
            // sign-off of a current source check of its exact text.
            const scoped = await article("Synthetic scoped guide", "Synthetic scoped text", {
              appliesTo: "Synthetic employers with staff.",
              actionEvidence: "Keep the synthetic register.",
              relatedTemplates: ["TPL-16", "TPL-10"],
            });
            await assert.rejects(
              client.query(
                "UPDATE valo_manual_library SET state='published',published_by=$2,published_at=now() WHERE id=$1",
                [scoped, owner],
              ),
              /A current source check of this exact draft and a separate owner are required/,
            );
            await release(
              scoped,
              await sourceCheck("GUD-03", "Synthetic scoped guide", "Synthetic scoped text"),
            );
            // A saved record never changes: a correction is a new version.
            for (const change of [
              "applies_to='Synthetic others'",
              "action_evidence=null",
              "related_templates=ARRAY['TPL-01']",
            ])
              await assert.rejects(
                client.query(`UPDATE valo_manual_library SET ${change} WHERE id=$1`, [scoped]),
                /Save corrections as a new revision/,
              );
            // The guide released before the migration stays released, and its owner can still withdraw it.
            const state = async (id) =>
              (await client.query("SELECT state FROM valo_manual_library WHERE id=$1", [id])).rows[0].state;
            assert.equal(await state(released), "published");
            await client.query(
              "UPDATE valo_manual_library SET state='withdrawn',closed_by=$2,closed_at=now() WHERE id=$1",
              [released, owner],
            );
            assert.equal(await state(released), "withdrawn");
            assert.equal(await state(scoped), "published");
          }),
      );
    for (const tracked of [true, false])
      await t.test(
        `source register migration starts an empty register whose versions only an active Content editor records, each the next of its entry at the entry's address, dated by the database and never changed or removed (tracked=${tracked})`,
        async () =>
          cluster(async (client, directory) => {
            await applyThrough(client, directory, sourceRegisterMigration, tracked);
            await seed(client);
            const before = await assertRollsBack(client, sourceRegisterMigration);
            await applyFor(client, sourceRegisterMigration, tracked);
            if (!tracked) await raw(client, journalTagsFrom(sourceRegisterMigration).slice(1));
            assert.deepEqual(await rows(client), before);
            assert.deepEqual(await schema(client), finalSchema);
            assert.deepEqual(await rowSecurityGaps(client), []);
            const count = async () =>
              (await client.query("SELECT count(*)::int AS n FROM valo_source_register")).rows[0].n;
            assert.equal(await count(), 0);
            const editor = "synthetic-migration-register-" + randomUUID(),
              system = "synthetic-migration-register-system-" + randomUUID(),
              lapsed = "synthetic-migration-register-lapsed-" + randomUUID();
            await client.query(
              `INSERT INTO valo_staff_assignments(id,identity_id,role,active,granted_by,reason) VALUES
                 ($1,$2,'content',true,'synthetic migration','Synthetic register editor'),
                 ($3,$4,'system',true,'synthetic migration','Synthetic system staff'),
                 ($5,$6,'content',false,'synthetic migration','Synthetic lapsed editor')`,
              [randomUUID(), editor, randomUUID(), system, randomUUID(), lapsed],
            );
            const record = (version, fields = {}) =>
              client.query(
                `INSERT INTO valo_source_register(source_id,version,title,url,jurisdiction,instrument,effective_from,status,reason,created_by,created_at)
                 VALUES($8,$1,'Synthetic Act',$2,'Nigeria',$3,$4,$5,$6,$7,'2001-01-01T00:00:00Z') RETURNING created_at`,
                [
                  version,
                  fields.url ?? "https://example.invalid/act",
                  fields.instrument === undefined ? "act" : fields.instrument,
                  fields.effectiveFrom === undefined ? "2023-06-12" : fields.effectiveFrom,
                  fields.status ?? "active",
                  fields.reason ?? "Synthetic: recorded for the migration check.",
                  fields.by ?? editor,
                  fields.source ?? "SYNTHETIC-S1",
                ],
              );
            // Only an active Content editor records a version, and the first is version 1.
            await assert.rejects(record(1, { by: system }), /An active content editor is required/);
            await assert.rejects(record(1, { by: lapsed }), /An active content editor is required/);
            await assert.rejects(record(2), /Record the next version of the latest source register entry/);
            // The database dates each version itself, whatever the insert says.
            const [first] = (await record(1)).rows;
            assert.ok(Math.abs(first.created_at.getTime() - Date.now()) < 60_000);
            // The next version keeps the entry's address; a version is never skipped or recorded twice.
            await assert.rejects(
              record(2, { url: "https://example.invalid/other" }),
              /A source register entry keeps its address/,
            );
            await assert.rejects(record(1), /Record the next version of the latest source register entry/);
            await assert.rejects(record(3), /Record the next version of the latest source register entry/);
            await record(2, { status: "retired", reason: "Synthetic: retired for the migration check." });
            // Each field stays within its limits: an https address, a page without a day, a known kind and
            // status, and why in 20 to 1,000 characters.
            await assert.rejects(
              record(1, { source: "SYNTHETIC-S2", url: "http://example.invalid/act" }),
              /valo_source_register_fields/,
            );
            for (const bad of [
              { instrument: "official_page" },
              { instrument: "synthetic_kind" },
              { status: "synthetic_status" },
              { reason: "Too short." },
              { reason: "x".repeat(1001) },
            ])
              await assert.rejects(record(3, bad), /valo_source_register_fields/, JSON.stringify(bad));
            await record(3, { instrument: "official_page", effectiveFrom: null });
            // No version is changed or removed.
            for (const change of [
              "UPDATE valo_source_register SET reason='Synthetic: a changed reason for the check.'",
              "UPDATE valo_source_register SET status='active' WHERE version=2",
              "DELETE FROM valo_source_register",
            ])
              await assert.rejects(
                client.query(change),
                /A source register version is never changed or removed/,
              );
            assert.deepEqual(
              (
                await client.query(
                  "SELECT version,status,instrument FROM valo_source_register ORDER BY version",
                )
              ).rows,
              [
                { version: 1, status: "active", instrument: "act" },
                { version: 2, status: "retired", instrument: "act" },
                { version: 3, status: "active", instrument: "official_page" },
              ],
            );
          }),
      );
    for (const tracked of [true, false])
      await t.test(
        `source watch stops migration stops the check of a source the register retired before it, then stops a watch when its source is retired and restarts it when the source comes back (tracked=${tracked})`,
        async () =>
          cluster(async (client, directory) => {
            await applyThrough(client, directory, sourceWatchStopsMigration, tracked);
            await seed(client);
            const editor = "synthetic-migration-stops-" + randomUUID();
            await client.query(
              "INSERT INTO valo_staff_assignments(id,identity_id,role,granted_by,reason) VALUES($1,$2,'content','synthetic migration','Synthetic register editor')",
              [randomUUID(), editor],
            );
            const record = (source, version, status, reason = "Synthetic: recorded for the stops check.") =>
              client.query(
                `INSERT INTO valo_source_register(source_id,version,title,url,jurisdiction,status,reason,created_by)
                 VALUES($1,$2,'Synthetic source','https://example.invalid/'||lower($1),'Nigeria',$3,$4,$5)`,
                [source, version, status, reason, editor],
              );
            const watch = (source) =>
              client.query(
                "INSERT INTO valo_source_watches(source_id,url,risk,next_check_at) VALUES($1,'https://example.invalid/'||lower($1),'high',now()+interval '1 day')",
                [source],
              );
            // A source retired before the migration, one still active, and a watch the register does not
            // hold.
            for (const source of ["SYNTHETIC-A", "SYNTHETIC-B", "SYNTHETIC-C"]) await watch(source);
            await record("SYNTHETIC-A", 1, "active");
            await record("SYNTHETIC-B", 1, "active");
            await record("SYNTHETIC-B", 2, "retired");
            const before = await assertRollsBack(client, sourceWatchStopsMigration);
            await applyFor(client, sourceWatchStopsMigration, tracked);
            if (!tracked) await raw(client, journalTagsFrom(sourceWatchStopsMigration).slice(1));
            assert.deepEqual(await rows(client), before);
            assert.deepEqual(await schema(client), finalSchema);
            assert.deepEqual(await rowSecurityGaps(client), []);
            const watches = async () =>
              Object.fromEntries(
                (
                  await client.query(
                    "SELECT source_id, stopped_at IS NOT NULL AS stopped, next_check_at<=now() AS due FROM valo_source_watches WHERE source_id LIKE 'SYNTHETIC-%' ORDER BY source_id",
                  )
                ).rows.map((row) => [row.source_id, { stopped: row.stopped, due: row.due }]),
              );
            assert.deepEqual(await watches(), {
              "SYNTHETIC-A": { stopped: false, due: false },
              "SYNTHETIC-B": { stopped: true, due: false },
              "SYNTHETIC-C": { stopped: false, due: false },
            });
            // Retiring a source stops its watch; a correction that keeps it active changes nothing.
            await record("SYNTHETIC-A", 2, "active", "Synthetic: a correction that keeps it active.");
            await record("SYNTHETIC-A", 3, "retired");
            // Bringing a source back restarts its check at once.
            await record("SYNTHETIC-B", 3, "active");
            // A source nobody watched is retired without a watch.
            await record("SYNTHETIC-D", 1, "active");
            await record("SYNTHETIC-D", 2, "retired");
            assert.deepEqual(await watches(), {
              "SYNTHETIC-A": { stopped: true, due: false },
              "SYNTHETIC-B": { stopped: false, due: true },
              "SYNTHETIC-C": { stopped: false, due: false },
            });
            // Retiring an already retired source again keeps the time its check stopped.
            const stoppedAt = async () =>
              (await client.query("SELECT stopped_at FROM valo_source_watches WHERE source_id='SYNTHETIC-A'"))
                .rows[0].stopped_at;
            const first = await stoppedAt();
            await record("SYNTHETIC-A", 4, "retired", "Synthetic: a correction of a retired source.");
            assert.deepEqual(await stoppedAt(), first);
          }),
      );
    for (const tracked of [true, false])
      await t.test(
        `source review owners migration closes review work a release or a withdrawal already settled, keeps the rest open, and keeps each note of what was checked (tracked=${tracked})`,
        async () =>
          cluster(async (client, directory) => {
            await applyThrough(client, directory, sourceReviewOwnersMigration, tracked);
            await seed(client);
            const editor = "synthetic-migration-review-" + randomUUID();
            await client.query(
              "INSERT INTO valo_staff_assignments(id,identity_id,role,granted_by,reason) VALUES($1,$2,'content','synthetic migration','Synthetic review editor')",
              [randomUUID(), editor],
            );
            const release = async (rule, version, status) => {
              const id = randomUUID();
              await client.query(
                `INSERT INTO valo_rule_releases(id,rule_id,version,status,rule,publication_bundle,manifest_hash,published_at)
                 VALUES($1,$2,$3,$4,$5::jsonb,'{}'::jsonb,repeat('e',64),now())`,
                [id, rule, version, status, JSON.stringify({ provenance: "synthetic_fixture" })],
              );
              return id;
            };
            const hold = async (id, rule, version, action = "hold") => {
              const impact = randomUUID(),
                work = randomUUID();
              await client.query(
                `INSERT INTO valo_source_impacts(id,dedupe_key,target_kind,target_id,target_key,target_version,reason,actor_id,action,phase)
                 VALUES($1,$2,'rule',$3,$4,$5,'Synthetic hold for the migration check.','synthetic migration',$6,'complete')`,
                [impact, "synthetic:" + impact, id, rule, version, action],
              );
              await client.query("INSERT INTO valo_source_review_work(id,impact_id) VALUES($1,$2)", [
                work,
                impact,
              ]);
              return work;
            };
            // Open work on a version a later release replaced, on a version withdrawn by a hold, and on a
            // version still held.
            const replaced = await release("SYNTHETIC-RULE-A", 1, "superseded"),
              current = await release("SYNTHETIC-RULE-A", 2, "published"),
              withdrawn = await release("SYNTHETIC-RULE-B", 1, "published"),
              held = await release("SYNTHETIC-RULE-C", 1, "held");
            const onReplaced = await hold(replaced, "SYNTHETIC-RULE-A", 1),
              onWithdrawn = await hold(withdrawn, "SYNTHETIC-RULE-B", 1),
              withdrawal = await hold(withdrawn, "SYNTHETIC-RULE-B", 1, "withdraw"),
              onHeld = await hold(held, "SYNTHETIC-RULE-C", 1);
            const before = await assertRollsBack(client, sourceReviewOwnersMigration);
            await applyFor(client, sourceReviewOwnersMigration, tracked);
            if (!tracked) await raw(client, journalTagsFrom(sourceReviewOwnersMigration).slice(1));
            assert.deepEqual(await rows(client), before);
            assert.deepEqual(await schema(client), finalSchema);
            assert.deepEqual(await rowSecurityGaps(client), []);
            const work = async (id) =>
              (
                await client.query(
                  "SELECT status,replacement_kind,replacement_id,completed_at IS NOT NULL AS closed FROM valo_source_review_work WHERE id=$1",
                  [id],
                )
              ).rows[0];
            assert.deepEqual(await work(onReplaced), {
              status: "superseded_by_eligible_version",
              replacement_kind: "rule",
              replacement_id: current,
              closed: true,
            });
            for (const id of [onWithdrawn, withdrawal])
              assert.deepEqual(await work(id), {
                status: "withdrawn",
                replacement_kind: null,
                replacement_id: null,
                closed: true,
              });
            assert.deepEqual(await work(onHeld), {
              status: "awaiting_authorized_review",
              replacement_kind: null,
              replacement_id: null,
              closed: false,
            });
            // A note of what was checked goes on open work only, from an active Content editor or the
            // development owner, within its limits, and is never changed or removed.
            const note = (workId, text, by = editor) =>
              client.query(
                "INSERT INTO valo_source_review_notes(work_id,note,recorded_by) VALUES($1,$2,$3)",
                [workId, text, by],
              );
            await note(onHeld, "Synthetic: read the held version against its source.");
            await assert.rejects(
              note(onReplaced, "Synthetic: a note on work already closed."),
              /only on open review work/,
            );
            await assert.rejects(
              note(onHeld, "Synthetic: a note from no one accountable.", "synthetic-migration-nobody"),
              /An active content editor or the development owner is required/,
            );
            await assert.rejects(note(onHeld, "Too short."), /valo_source_review_notes_note/);
            for (const change of [
              "UPDATE valo_source_review_notes SET note='Synthetic: a changed note for the check.'",
              "DELETE FROM valo_source_review_notes",
            ])
              await assert.rejects(client.query(change), /A review note is never changed or removed/);
            // Work closes as withdrawn now, which the status check allows.
            await client.query(
              "UPDATE valo_source_review_work SET status='withdrawn',completed_at=now() WHERE id=$1",
              [onHeld],
            );
            await assert.rejects(
              client.query("UPDATE valo_source_review_work SET status='synthetic_status' WHERE id=$1", [
                onHeld,
              ]),
              /valo_source_review_work_status_check/,
            );
          }),
      );
    for (const tracked of [true, false])
      await t.test(
        `source review preparations migration keeps each request to prepare a candidate from open review work on a template or guide, asked by an active Content editor, and never changes a finished one (tracked=${tracked})`,
        async () =>
          cluster(async (client, directory) => {
            await applyThrough(client, directory, sourceReviewPreparationsMigration, tracked);
            await seed(client);
            const editor = "synthetic-migration-prepare-" + randomUUID();
            await client.query(
              "INSERT INTO valo_staff_assignments(id,identity_id,role,granted_by,reason) VALUES($1,$2,'content','synthetic migration','Synthetic preparing editor')",
              [randomUUID(), editor],
            );
            const hold = async (kind, key, status = "awaiting_authorized_review") => {
              const impact = randomUUID(),
                work = randomUUID();
              await client.query(
                `INSERT INTO valo_source_impacts(id,dedupe_key,target_kind,target_id,target_key,target_version,reason,actor_id,action,phase)
                 VALUES($1,$2,$3,$4,$5,1,'Synthetic hold for the migration check.','synthetic migration','hold','complete')`,
                [impact, "synthetic:" + impact, kind, randomUUID(), key],
              );
              await client.query(
                "INSERT INTO valo_source_review_work(id,impact_id,status,completed_at) VALUES($1,$2,$3,CASE WHEN $3='awaiting_authorized_review' THEN NULL ELSE now() END)",
                [work, impact, status],
              );
              return work;
            };
            // Open work on a template, work on a template that closed, and open work on a rule.
            const onTemplate = await hold("content", "SYNTHETIC-TPL-A"),
              onClosed = await hold("content", "SYNTHETIC-TPL-B", "withdrawn"),
              onRule = await hold("rule", "SYNTHETIC-RULE-A");
            const before = await assertRollsBack(client, sourceReviewPreparationsMigration);
            await applyFor(client, sourceReviewPreparationsMigration, tracked);
            if (!tracked) await raw(client, journalTagsFrom(sourceReviewPreparationsMigration).slice(1));
            assert.deepEqual(await rows(client), before);
            assert.deepEqual(await schema(client), finalSchema);
            assert.deepEqual(await rowSecurityGaps(client), []);
            const ask = (workId, by = editor) =>
              client.query(
                "INSERT INTO valo_source_review_preparations(work_id,requested_by) VALUES($1,$2) RETURNING id,status,requested_at",
                [workId, by],
              );
            // A request starts waiting, untried, dated by the database.
            const [request] = (await ask(onTemplate)).rows;
            assert.equal(request.status, "pending");
            assert.ok(request.requested_at instanceof Date);
            // One request at a time waits or runs for a row.
            await assert.rejects(ask(onTemplate), /valo_source_review_preparations_open/);
            // Only on open work on a template or guide, and only from an active Content editor.
            for (const workId of [onClosed, onRule])
              await assert.rejects(ask(workId), /only from open review work on a template or guide/);
            await assert.rejects(
              ask(onTemplate, "synthetic-migration-nobody"),
              /An active content editor is required/,
            );
            await assert.rejects(
              client.query(
                "INSERT INTO valo_source_review_preparations(work_id,requested_by,status) VALUES($1,$2,'running')",
                [onTemplate, editor],
              ),
              /starts waiting, untried/,
            );
            // The worker claims it; who asked, for which row and when never change.
            await client.query(
              "UPDATE valo_source_review_preparations SET status='running',attempts=1,lease_until=now()+interval '15 minutes' WHERE id=$1",
              [request.id],
            );
            for (const change of [
              "UPDATE valo_source_review_preparations SET requested_by='synthetic-someone-else' WHERE id=$1",
              "UPDATE valo_source_review_preparations SET requested_at=now()-interval '1 day' WHERE id=$1",
            ])
              await assert.rejects(
                client.query(change, [request.id]),
                /keeps who asked, for which row and when/,
              );
            await assert.rejects(
              client.query("UPDATE valo_source_review_preparations SET attempts=0 WHERE id=$1", [request.id]),
              /keeps every attempt/,
            );
            await assert.rejects(
              client.query("UPDATE valo_source_review_preparations SET attempts=4 WHERE id=$1", [request.id]),
              /valo_source_review_preparations_attempts/,
            );
            // What came of it must hang together: a prepared candidate names its candidate, and a stop
            // says why.
            for (const outcome of [
              "status='prepared',completed_at=now(),candidate_version=2",
              "status='failed',completed_at=now()",
              "status='running',reasons='[\"SYNTHETIC_CODE\"]'::jsonb",
            ])
              await assert.rejects(
                client.query(`UPDATE valo_source_review_preparations SET ${outcome} WHERE id=$1`, [
                  request.id,
                ]),
                /valo_source_review_preparations_outcome/,
              );
            await client.query(
              `UPDATE valo_source_review_preparations SET status='failed',completed_at=now(),lease_until=NULL,
               reasons='["PROVIDER_TERMS_SENTENCE_MISSING"]'::jsonb WHERE id=$1`,
              [request.id],
            );
            // A finished request never changes and is never removed; the row takes a new request.
            await assert.rejects(
              client.query("UPDATE valo_source_review_preparations SET status='pending' WHERE id=$1", [
                request.id,
              ]),
              /A finished preparation request never changes/,
            );
            await assert.rejects(
              client.query("DELETE FROM valo_source_review_preparations"),
              /A preparation request is never removed/,
            );
            assert.equal((await ask(onTemplate)).rows[0].status, "pending");
          }),
      );
    for (const tracked of [true, false])
      await t.test(
        `acceptance reviews migration adds the reviewer role, keeps each decision as an active reviewer wrote it, and refuses the reviewer and content roles together (tracked=${tracked})`,
        async () =>
          cluster(async (client, directory) => {
            await applyThrough(client, directory, acceptanceReviewsMigration, tracked);
            await seed(client);
            const editor = "synthetic-migration-review-editor-" + randomUUID(),
              reviewer = "synthetic-migration-reviewer-" + randomUUID();
            const assign = (identity, role) =>
              client.query(
                "INSERT INTO valo_staff_assignments(id,identity_id,role,granted_by,reason) VALUES($1,$2,$3,'synthetic migration','Synthetic staff role for the migration check')",
                [randomUUID(), identity, role],
              );
            await assign(editor, "content");
            // Before the migration there is no reviewer role.
            await assert.rejects(assign(reviewer, "reviewer"), /valo_staff_assignments_role_check/);
            const before = await assertRollsBack(client, acceptanceReviewsMigration);
            await applyFor(client, acceptanceReviewsMigration, tracked);
            if (!tracked) await raw(client, journalTagsFrom(acceptanceReviewsMigration).slice(1));
            assert.deepEqual(await rows(client), before);
            assert.deepEqual(await schema(client), finalSchema);
            assert.deepEqual(await rowSecurityGaps(client), []);
            await assign(reviewer, "reviewer");
            // No one holds the reviewer and content roles at once, whichever comes first.
            await assert.rejects(assign(editor, "reviewer"), /A reviewer cannot also hold the content role/);
            await assert.rejects(assign(reviewer, "content"), /A reviewer cannot also hold the content role/);
            const hash = "c".repeat(64),
              results = "d".repeat(64);
            const decide = (who, shape = "'expected_outcome','confirmed',NULL,NULL") =>
              client.query(
                `INSERT INTO valo_acceptance_reviews(corpus,case_id,case_hash,judgment,answer,run_id,results_hash,reason,reviewer,created_at)
                 VALUES('checker','CHK-CAND-SYNTH-001',$1,${shape},'A synthetic decision for the migration check.',$2,'2020-01-01')
                 RETURNING id,created_at`,
                [hash, who],
              );
            await assert.rejects(decide(editor), /An active reviewer is required/);
            const decided = (await decide(reviewer)).rows[0];
            assert.ok(
              Math.abs(Date.now() - new Date(decided.created_at).getTime()) < 600_000,
              "the database dates a decision itself",
            );
            // A later migration (acceptance runs) takes a run decision only on a case a kept run left for
            // a reviewer, so a run that was never kept is refused.
            await assert.rejects(
              decide(reviewer, `'run_outcome','met','synthetic-run-1','${results}'`),
              /A run decision is taken only on a case a kept run left for a reviewer/,
            );
            // A null passes a check, so each kind of judgment must carry exactly its own fields.
            for (const shape of [
              "'run_outcome','met',NULL,NULL",
              `'run_outcome','met',NULL,'${results}'`,
              "'run_outcome','met','synthetic-run-1',NULL",
              `'run_outcome','confirmed','synthetic-run-1','${results}'`,
              "'expected_outcome','confirmed','synthetic-run-1',NULL",
              "'expected_outcome','met',NULL,NULL",
            ])
              await assert.rejects(decide(reviewer, shape), /valo_acceptance_reviews_judgment/, shape);
            await assert.rejects(
              client.query("UPDATE valo_acceptance_reviews SET answer='rejected' WHERE id=$1", [decided.id]),
              /A review decision is never changed or removed/,
            );
            await assert.rejects(
              client.query("DELETE FROM valo_acceptance_reviews"),
              /A review decision is never changed or removed/,
            );
            await assert.rejects(
              client.query("TRUNCATE valo_acceptance_reviews"),
              /Audit history cannot be truncated/,
            );
            // A reviewer whose role ends records nothing more, and may then hold the content role.
            await client.query(
              "UPDATE valo_staff_assignments SET active=false,version=version+1 WHERE identity_id=$1 AND role='reviewer'",
              [reviewer],
            );
            await assert.rejects(decide(reviewer), /An active reviewer is required/);
            await assign(reviewer, "content");
            assert.equal(
              Number((await client.query("SELECT count(*) AS n FROM valo_acceptance_reviews")).rows[0].n),
              1,
              "every decision stays",
            );
          }),
      );
    for (const tracked of [true, false])
      await t.test(
        `acceptance runs migration keeps each kept run as written and takes a run decision only on a case a kept run left for a reviewer (tracked=${tracked})`,
        async () =>
          cluster(async (client, directory) => {
            await applyThrough(client, directory, acceptanceRunsMigration, tracked);
            await seed(client);
            const reviewer = "synthetic-migration-run-reviewer-" + randomUUID();
            await client.query(
              "INSERT INTO valo_staff_assignments(id,identity_id,role,granted_by,reason) VALUES($1,$2,'reviewer','synthetic migration','Synthetic reviewer for the migration check')",
              [randomUUID(), reviewer],
            );
            const hash = "c".repeat(64);
            // A decision on an expected outcome made before the migration stays as it was.
            await client.query(
              `INSERT INTO valo_acceptance_reviews(corpus,case_id,case_hash,judgment,answer,reason,reviewer)
               VALUES('checker','CHK-CAND-SYNTH-001',$1,'expected_outcome','confirmed','A synthetic decision before the migration.',$2)`,
              [hash, reviewer],
            );
            const before = await assertRollsBack(client, acceptanceRunsMigration);
            await applyFor(client, acceptanceRunsMigration, tracked);
            if (!tracked) await raw(client, journalTagsFrom(acceptanceRunsMigration).slice(1));
            assert.deepEqual(await rows(client), before);
            assert.deepEqual(await schema(client), finalSchema);
            assert.deepEqual(await rowSecurityGaps(client), []);
            const kept = (caseId, review) => ({
              caseId,
              caseHash: hash,
              status: review ? "differs" : "matches_expected",
              reason: null,
              review,
              resultHash: (review ? "e" : "f").repeat(64),
            });
            const keep = (cases, keptBy = "operator:synthetic-operator") =>
              client.query(
                `INSERT INTO valo_acceptance_runs(corpus,corpus_hash,summary,cases,results_hash,kept_by,created_at)
                 VALUES('checker',$1,'["A synthetic run."]'::jsonb,$2::jsonb,$1,$3,'2020-01-01') RETURNING id,created_at`,
                ["a".repeat(64), JSON.stringify(cases), keptBy],
              );
            const left = kept("CHK-CAND-SYNTH-001", {
                sections: [{ heading: "The live check", lines: ["result"] }],
              }),
              matched = kept("CHK-CAND-SYNTH-002", null);
            const run = (await keep([left, matched])).rows[0];
            assert.ok(
              Math.abs(Date.now() - new Date(run.created_at).getTime()) < 600_000,
              "the database dates a kept run itself",
            );
            const { resultHash: _dropped, ...unhashed } = left;
            await assert.rejects(keep([unhashed]), /Each kept case names the case/);
            await assert.rejects(keep([{ ...left, review: "text" }]), /Each kept case names the case/);
            await assert.rejects(keep([left, left]), /A kept run lists each case once/);
            await assert.rejects(keep([left], "someone"), /valo_acceptance_runs_kept_by/);
            await assert.rejects(keep([]), /valo_acceptance_runs_cases/);
            await assert.rejects(
              client.query("UPDATE valo_acceptance_runs SET summary='[]'::jsonb WHERE id=$1", [run.id]),
              /A kept run is never changed or removed/,
            );
            await assert.rejects(
              client.query("DELETE FROM valo_acceptance_runs"),
              /A kept run is never changed or removed/,
            );
            await assert.rejects(
              client.query("TRUNCATE valo_acceptance_runs"),
              /Audit history cannot be truncated/,
            );
            const decide = (caseId, runId, resultsHash) =>
              client.query(
                `INSERT INTO valo_acceptance_reviews(corpus,case_id,case_hash,judgment,run_id,results_hash,answer,reason,reviewer)
                 VALUES('checker',$1,$2,'run_outcome',$3,$4,'met','A synthetic run decision for the migration check.',$5)`,
                [caseId, hash, runId, resultsHash, reviewer],
              );
            const refused = /A run decision is taken only on a case a kept run left for a reviewer/;
            await assert.rejects(decide(left.caseId, run.id, "0".repeat(64)), refused);
            await assert.rejects(decide(left.caseId, randomUUID(), left.resultHash), refused);
            await assert.rejects(decide(matched.caseId, run.id, matched.resultHash), refused);
            assert.equal((await decide(left.caseId, run.id, left.resultHash)).rowCount, 1);
            // A row without the fields its kind needs is refused by the check, by name.
            await assert.rejects(
              decide(left.caseId, null, left.resultHash),
              /valo_acceptance_reviews_judgment/,
            );
            assert.equal(
              Number((await client.query("SELECT count(*) AS n FROM valo_acceptance_reviews")).rows[0].n),
              2,
              "the earlier decision and the run decision stay",
            );
          }),
      );
    for (const tracked of [true, false])
      await t.test(
        `staff access object migration keeps earlier access rows, marked unrecorded, and makes each new row name what it read (tracked=${tracked})`,
        async () =>
          cluster(async (client, directory) => {
            await applyThrough(client, directory, staffAccessObjectMigration, tracked);
            await seed(client);
            const assignment = randomUUID(),
              earlier = randomUUID();
            await client.query(
              "INSERT INTO valo_staff_assignments(id,identity_id,role,granted_by,reason) VALUES($1,'synthetic-access-operator','privacy','synthetic-migration','Migration fixture assignment')",
              [assignment],
            );
            await client.query(
              "INSERT INTO valo_staff_access_audit(id,assignment_id,actor_id,area,reason) VALUES($1,$2,'synthetic-access-operator','privacy','Read a privacy case before objects were recorded')",
              [earlier, assignment],
            );
            const before = await assertRollsBack(client, staffAccessObjectMigration);
            await applyFor(client, staffAccessObjectMigration, tracked);
            if (!tracked) await raw(client, journalTagsFrom(staffAccessObjectMigration).slice(1));
            assert.deepEqual(await rows(client), before);
            assert.deepEqual(await schema(client), finalSchema);
            assert.deepEqual(await rowSecurityGaps(client), []);
            // The earlier row is kept as it was, and says that what it read was not recorded.
            assert.deepEqual(
              (await client.query("SELECT object,reason FROM valo_staff_access_audit WHERE id=$1", [earlier]))
                .rows,
              [{ object: "unrecorded", reason: "Read a privacy case before objects were recorded" }],
            );
            const access = (object) =>
              client.query(
                "INSERT INTO valo_staff_access_audit(id,assignment_id,actor_id,area,object,reason) VALUES($1,$2,'synthetic-access-operator','privacy',$3,'Synthetic read')",
                [randomUUID(), assignment, object],
              );
            // A new row names a list by its kind, or one record by its kind and ID, and must name one.
            assert.equal((await access("privacy_cases")).rowCount, 1);
            assert.equal((await access("privacy_case:" + randomUUID())).rowCount, 1);
            await assert.rejects(
              client.query(
                "INSERT INTO valo_staff_access_audit(id,assignment_id,actor_id,area,reason) VALUES($1,$2,'synthetic-access-operator','privacy','Synthetic read')",
                [randomUUID(), assignment],
              ),
              /null value in column "object"/,
            );
            for (const object of ["", "Privacy cases", "privacy_case:", "privacy_case:two words", "1_case:x"])
              await assert.rejects(access(object), /valo_staff_access_audit_object_check/, object);
          }),
      );
    for (const tracked of [true, false])
      await t.test(
        `audit history guards migration keeps each history as it was, refuses changing or removing it outside an erasure or a synthetic workspace, and refuses truncating any history (tracked=${tracked})`,
        async () =>
          cluster(async (client, directory) => {
            await applyThrough(client, directory, auditHistoryGuardsMigration, tracked);
            const synthetic = (await seed(client)).workspace;
            // Two workspaces whose owners are not synthetic test identities, as a real customer's are not.
            const [kept, erasing] = [randomUUID(), randomUUID()];
            await client.query(
              "INSERT INTO valo_workspaces(id,owner_identity_id) VALUES($1,'operator-fixture-kept'),($2,'operator-fixture-erasing')",
              [kept, erasing],
            );
            const event = async (workspace) =>
              (
                await client.query(
                  "INSERT INTO valo_events(id,workspace_id,actor_id,action,entity_id) VALUES($1,$2,'operator-fixture','document.created',$3) RETURNING id",
                  [randomUUID(), workspace, randomUUID()],
                )
              ).rows[0].id;
            // A privacy case, in the given state, with one event in its history.
            const privacyCase = async (workspace, kind, status, phase) => {
              const id = randomUUID();
              await client.query(
                `INSERT INTO valo_support_tickets(id,workspace_id,category,scope,contact_email,sharing_consent,consent_version)
                 VALUES($1,$2,'support','Synthetic privacy request','synthetic@example.invalid',false,'service-sharing-v1')`,
                [id, workspace],
              );
              await client.query(
                `INSERT INTO valo_privacy_cases(id,workspace_id,requester_identity_id,kind,idempotency_key,payload_hash,message,status,verified_at,last_event_hash,erasure_phase)
                 VALUES($1,$2,'operator-fixture',$3,$4,$5,'A synthetic privacy request.',$6,now(),$5,$7)`,
                [id, workspace, kind, randomUUID(), "d".repeat(64), status, phase],
              );
              const eventId = randomUUID();
              await client.query(
                `INSERT INTO valo_privacy_events(id,workspace_id,case_id,sequence,actor_type,actor_hash,action,reason,previous_hash,state_hash,event_hash,key_version,created_at)
                 VALUES($1,$2,$3,1,'staff',$4,'case_created','A synthetic reason with private words.',$4,$4,$4,'synthetic',now())`,
                [eventId, workspace, id, "e".repeat(64)],
              );
              return { id, eventId };
            };
            const keptEvent = await event(kept),
              erasingEvent = await event(erasing),
              syntheticEvent = await event(synthetic),
              keptCase = await privacyCase(kept, "correction", "in_progress", "not_started"),
              erasingCase = await privacyCase(erasing, "deletion", "in_progress", "refund_history"),
              syntheticCase = await privacyCase(synthetic, "correction", "in_progress", "not_started");
            const before = await assertRollsBack(client, auditHistoryGuardsMigration);
            const history = async () => ({
              events: (await client.query("SELECT * FROM valo_events ORDER BY id")).rows,
              privacy: (await client.query("SELECT * FROM valo_privacy_events ORDER BY id")).rows,
            });
            const histories = await history();
            await applyFor(client, auditHistoryGuardsMigration, tracked);
            if (!tracked) await raw(client, journalTagsFrom(auditHistoryGuardsMigration).slice(1));
            assert.deepEqual(await rows(client), before);
            assert.deepEqual(await history(), histories);
            assert.deepEqual(await schema(client), finalSchema);
            assert.deepEqual(await rowSecurityGaps(client), []);
            const activity = /Workspace activity history is append-only/,
              privacy = /Privacy case history is append-only/;
            // A workspace's activity is never changed, a synthetic workspace's included.
            for (const id of [keptEvent, syntheticEvent])
              await assert.rejects(
                client.query("UPDATE valo_events SET action='document.deleted' WHERE id=$1", [id]),
                activity,
              );
            // It is not removed from a real workspace, nor by a deletion request before its activity step.
            await assert.rejects(client.query("DELETE FROM valo_events WHERE id=$1", [keptEvent]), activity);
            await assert.rejects(
              client.query("DELETE FROM valo_events WHERE id=$1", [erasingEvent]),
              activity,
            );
            // A verified deletion request at its activity step removes it, as do a synthetic workspace's cleanups.
            await client.query("UPDATE valo_privacy_cases SET erasure_phase='activity_text' WHERE id=$1", [
              erasingCase.id,
            ]);
            assert.equal(
              (await client.query("DELETE FROM valo_events WHERE id=$1", [erasingEvent])).rowCount,
              1,
            );
            assert.equal(
              (await client.query("DELETE FROM valo_events WHERE id=$1", [syntheticEvent])).rowCount,
              1,
            );
            // A held deletion request is not processing, and removes nothing.
            const heldEvent = await event(erasing);
            await client.query("UPDATE valo_privacy_cases SET status='held' WHERE id=$1", [erasingCase.id]);
            await assert.rejects(client.query("DELETE FROM valo_events WHERE id=$1", [heldEvent]), activity);
            // A privacy case's history is not removed from a real workspace, even by its deletion request.
            for (const { eventId } of [keptCase, erasingCase])
              await assert.rejects(
                client.query("DELETE FROM valo_privacy_events WHERE id=$1", [eventId]),
                privacy,
              );
            // Its rows change only as an erasure replaces a reason with the projection it recorded first.
            const removed = "[Private content removed by verified workspace erasure]";
            await assert.rejects(
              client.query("UPDATE valo_privacy_events SET reason='Changed' WHERE id=$1", [keptCase.eventId]),
              privacy,
            );
            await assert.rejects(
              client.query("UPDATE valo_privacy_events SET reason=$2 WHERE id=$1", [
                keptCase.eventId,
                removed,
              ]),
              privacy,
            );
            await client.query(
              `INSERT INTO valo_privacy_redactions(table_name,row_id,workspace_id,projection,proof,key_version,mac)
               SELECT 'valo_privacy_events',id,workspace_id,to_jsonb(e)||jsonb_build_object('reason',$2::text),'{}'::jsonb,'synthetic','synthetic'
               FROM valo_privacy_events e WHERE id=$1`,
              [keptCase.eventId, removed],
            );
            await assert.rejects(
              client.query("UPDATE valo_privacy_events SET reason=$2,action='case_changed' WHERE id=$1", [
                keptCase.eventId,
                removed,
              ]),
              privacy,
            );
            assert.equal(
              (
                await client.query("UPDATE valo_privacy_events SET reason=$2 WHERE id=$1", [
                  keptCase.eventId,
                  removed,
                ])
              ).rowCount,
              1,
            );
            // A synthetic workspace's cleanup removes its privacy history.
            assert.equal(
              (await client.query("DELETE FROM valo_privacy_events WHERE id=$1", [syntheticCase.eventId]))
                .rowCount,
              1,
            );
            // TRUNCATE skips row triggers. Every table whose rows a trigger guards against deletion has a
            // trigger that fires before TRUNCATE, and cannot be emptied: alone, it is refused by that trigger
            // or, when other tables refer to it, by their keys; with what refers to it, by a guard.
            const guarded = (
              await client.query(`
                SELECT c.relname, bool_or((t.tgtype & 34) = 34) AS before_truncate
                FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
                WHERE NOT t.tgisinternal AND c.relnamespace='public'::regnamespace
                GROUP BY c.relname HAVING bool_or((t.tgtype & 1) = 1 AND (t.tgtype & 8) <> 0)
                ORDER BY 1`)
            ).rows;
            assert.deepEqual(
              guarded.filter((table) => !table.before_truncate),
              [],
            );
            for (const name of ["valo_events", "valo_privacy_events", "valo_staff_access_audit"])
              assert.ok(
                guarded.some((table) => table.relname === name),
                name,
              );
            const guard = /Audit history cannot be truncated|is never changed or removed/;
            for (const { relname } of guarded) {
              await assert.rejects(
                client.query(`TRUNCATE ${relname}`),
                new RegExp(guard.source + "|cannot truncate a table referenced in a foreign key constraint"),
                relname,
              );
              await assert.rejects(client.query(`TRUNCATE ${relname} CASCADE`), guard, relname);
            }
            await assert.rejects(client.query("TRUNCATE valo_workspaces CASCADE"), guard);
          }),
      );
    for (const tracked of [true, false])
      await t.test(
        `staff access reading index migration keeps every access row and indexes the access history by time (tracked=${tracked})`,
        async () =>
          cluster(async (client, directory) => {
            await applyThrough(client, directory, staffAccessReadingIndexMigration, tracked);
            await seed(client);
            const assignment = randomUUID(),
              access = randomUUID();
            await client.query(
              "INSERT INTO valo_staff_assignments(id,identity_id,role,granted_by,reason) VALUES($1,'synthetic-reading-operator','privacy','synthetic-migration','Migration fixture assignment')",
              [assignment],
            );
            await client.query(
              "INSERT INTO valo_staff_access_audit(id,assignment_id,actor_id,area,object,reason) VALUES($1,$2,'synthetic-reading-operator','privacy','privacy_cases','Synthetic read before the index')",
              [access, assignment],
            );
            const kept = async () =>
              (await client.query("SELECT * FROM valo_staff_access_audit WHERE id=$1", [access])).rows;
            const before = await assertRollsBack(client, staffAccessReadingIndexMigration),
              row = await kept();
            await applyFor(client, staffAccessReadingIndexMigration, tracked);
            if (!tracked) await raw(client, journalTagsFrom(staffAccessReadingIndexMigration).slice(1));
            assert.deepEqual(await rows(client), before);
            assert.deepEqual(await kept(), row);
            assert.deepEqual(await schema(client), finalSchema);
            assert.deepEqual(await rowSecurityGaps(client), []);
            assert.deepEqual(
              (
                await client.query(
                  "SELECT indexdef FROM pg_indexes WHERE indexname='valo_staff_access_audit_created_idx'",
                )
              ).rows.map((r) => r.indexdef),
              [
                "CREATE INDEX valo_staff_access_audit_created_idx ON public.valo_staff_access_audit USING btree (created_at)",
              ],
            );
          }),
      );
    for (const tracked of [true, false])
      await t.test(
        `history digests migration keeps every row and adds the digest and count tables, empty (tracked=${tracked})`,
        async () =>
          cluster(async (client, directory) => {
            await applyThrough(client, directory, historyDigestsMigration, tracked);
            await seed(client);
            const before = await assertRollsBack(client, historyDigestsMigration);
            await applyFor(client, historyDigestsMigration, tracked);
            if (!tracked) await raw(client, journalTagsFrom(historyDigestsMigration).slice(1));
            assert.deepEqual(await rows(client), before);
            assert.deepEqual(await schema(client), finalSchema);
            assert.deepEqual(await rowSecurityGaps(client), []);
            assert.equal(
              Number((await client.query("SELECT count(*) AS n FROM valo_history_checks")).rows[0].n),
              0,
            );
          }),
      );
    for (const tracked of [true, false])
      await t.test(
        `history digest triggers migration starts each digest from the rows held, keeps it through every allowed write, and finds a change made with the triggers off (tracked=${tracked})`,
        async () =>
          cluster(async (client, directory) => {
            await applyThrough(client, directory, historyDigestTriggersMigration, tracked);
            const workspace = (await seed(client)).workspace;
            const event = async (id = randomUUID()) => {
              await client.query(
                "INSERT INTO valo_events(id,workspace_id,actor_id,action,entity_id) VALUES($1,$2,'synthetic-digest-owner','document.created',$3)",
                [id, workspace, randomUUID()],
              );
              return id;
            };
            // History written before the migration: its digest starts from these rows.
            const kept = await event();
            await event();
            const before = await assertRollsBack(client, historyDigestTriggersMigration);
            await applyFor(client, historyDigestTriggersMigration, tracked);
            if (!tracked) await raw(client, journalTagsFrom(historyDigestTriggersMigration).slice(1));
            assert.deepEqual(await rows(client), before);
            assert.deepEqual(await schema(client), finalSchema);
            assert.deepEqual(await rowSecurityGaps(client), []);
            const mismatched = async () =>
              (
                await client.query(
                  "SELECT array_agg(name ORDER BY name) AS names FROM valo_history_digest_mismatches() AS name",
                )
              ).rows[0].names ?? [];
            assert.deepEqual(await mismatched(), []);
            assert.equal(
              Number(
                (
                  await client.query(
                    "SELECT sum(row_count) AS n FROM valo_history_digests WHERE table_name='valo_events'",
                  )
                ).rows[0].n,
              ),
              2,
            );
            // Every history keeps a digest, by the same rule as TRUNCATE: each table whose rows a trigger
            // guards against deletion, but the digests and the counts themselves.
            const undigested = await client.query(`
              SELECT c.relname FROM pg_class c WHERE c.relnamespace='public'::regnamespace
                AND c.relname NOT IN ('valo_history_digests','valo_history_checks')
                AND EXISTS (SELECT FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal AND (t.tgtype & 1)=1 AND (t.tgtype & 8)<>0)
                AND NOT EXISTS (SELECT FROM pg_trigger t WHERE t.tgrelid=c.oid AND t.tgfoid='public.valo_history_digest_maintain'::regproc)
              ORDER BY 1`);
            assert.deepEqual(undigested.rows, []);
            // A customer's write, in another time zone, and a removal a guard allows keep the digest true.
            await client.query("BEGIN");
            await enterWorkspaceScope(client, workspace);
            await client.query("SET LOCAL timezone = 'Africa/Lagos'");
            await event();
            await client.query("COMMIT");
            await client.query("DELETE FROM valo_events WHERE id=$1", [kept]);
            assert.deepEqual(await mismatched(), []);
            // A change made with the triggers off, here in replica mode, leaves the digest behind.
            const tampered = await event();
            const replica = async (statement, values) => {
              await client.query("BEGIN");
              await client.query("SET LOCAL session_replication_role = replica");
              await client.query(statement, values);
              await client.query("COMMIT");
            };
            await replica("UPDATE valo_events SET action='document.deleted' WHERE id=$1", [tampered]);
            assert.deepEqual(await mismatched(), ["valo_events"]);
            // Put back as it was, the history matches its digest again.
            await replica("UPDATE valo_events SET action='document.created' WHERE id=$1", [tampered]);
            assert.deepEqual(await mismatched(), []);
            // A digest trigger switched off is found, before any row changes.
            await client.query("ALTER TABLE valo_events DISABLE TRIGGER valo_events_digest");
            assert.deepEqual(await mismatched(), ["valo_events"]);
            await client.query("ALTER TABLE valo_events ENABLE TRIGGER valo_events_digest");
            assert.deepEqual(await mismatched(), []);
            // Only a history's own trigger changes its digest, and a kept count never changes.
            const digestGuard = /A history digest changes only as its history does/;
            await assert.rejects(
              client.query("UPDATE valo_history_digests SET row_count=row_count+1"),
              digestGuard,
            );
            await assert.rejects(client.query("DELETE FROM valo_history_digests"), digestGuard);
            await assert.rejects(
              client.query("INSERT INTO valo_history_digests VALUES ('valo_events', 0, 1, 1)"),
              digestGuard,
            );
            await client.query("INSERT INTO valo_history_checks(mismatched) VALUES ('{}')");
            await assert.rejects(
              client.query("UPDATE valo_history_checks SET mismatched='{valo_events}'"),
              /A history count is never changed or removed/,
            );
          }),
      );
    for (const tracked of [true, false])
      await t.test(
        `history digest reseed migration lets a migration that changes a history's columns start its digest again from its rows, and only for a history (tracked=${tracked})`,
        async () =>
          cluster(async (client, directory) => {
            await applyThrough(client, directory, historyDigestReseedMigration, tracked);
            const workspace = (await seed(client)).workspace;
            await client.query(
              "INSERT INTO valo_events(id,workspace_id,actor_id,action,entity_id) VALUES($1,$2,'synthetic-reseed-owner','document.created',$3)",
              [randomUUID(), workspace, randomUUID()],
            );
            const before = await assertRollsBack(client, historyDigestReseedMigration);
            await applyFor(client, historyDigestReseedMigration, tracked);
            if (!tracked) await raw(client, journalTagsFrom(historyDigestReseedMigration).slice(1));
            assert.deepEqual(await rows(client), before);
            assert.deepEqual(await schema(client), finalSchema);
            assert.deepEqual(await rowSecurityGaps(client), []);
            const mismatched = async () =>
              (
                await client.query(
                  "SELECT array_agg(name ORDER BY name) AS names FROM valo_history_digest_mismatches() AS name",
                )
              ).rows[0].names ?? [];
            assert.deepEqual(await mismatched(), []);
            // A migration adds a column to a history: every row's hash changes, and the count finds it.
            await client.query("BEGIN");
            await client.query("ALTER TABLE valo_events ADD COLUMN synthetic_note text");
            assert.deepEqual(await mismatched(), ["valo_events"]);
            // Reseeded in the same transaction, the history matches its digest again.
            await client.query("SELECT valo_history_digest_reseed('valo_events')");
            assert.deepEqual(await mismatched(), []);
            // The digest's guard is on again: only the history's trigger changes it.
            await assert.rejects(
              client.query("UPDATE valo_history_digests SET row_count=row_count+1"),
              /A history digest changes only as its history does/,
            );
            await client.query("ROLLBACK");
            assert.deepEqual(await mismatched(), []);
            // Only a history that keeps a digest is reseeded, and a table that is not one stays as it was.
            await assert.rejects(
              client.query("SELECT valo_history_digest_reseed('valo_history_checks')"),
              /Only a history that keeps a digest is reseeded/,
            );
            assert.deepEqual(
              (
                await client.query(
                  "SELECT has_function_privilege('valo_workspace_scope', 'valo_history_digest_reseed(regclass)', 'EXECUTE') AS can",
                )
              ).rows[0].can,
              false,
            );
          }),
      );
    for (const tracked of [true, false])
      await t.test(
        `price carries migration keeps every price as one that does not carry, and the prices' digest matching its rows (tracked=${tracked})`,
        async () =>
          cluster(async (client, directory) => {
            await applyThrough(client, directory, priceCarriesMigration, tracked);
            await seed(client);
            const prices = async () =>
              (await client.query("SELECT id, amount_kobo, approval_reference FROM valo_prices ORDER BY id"))
                .rows;
            const held = await prices();
            assert.ok(held.length > 0, "the seed holds a price");
            const before = await assertRollsBack(client, priceCarriesMigration);
            await applyFor(client, priceCarriesMigration, tracked);
            if (!tracked) await raw(client, journalTagsFrom(priceCarriesMigration).slice(1));
            assert.deepEqual(await rows(client), before);
            assert.deepEqual(await prices(), held);
            assert.deepEqual(await schema(client), finalSchema);
            assert.deepEqual(await rowSecurityGaps(client), []);
            // Every price held before records that it does not carry and was carried from none.
            assert.deepEqual(
              (
                await client.query(
                  "SELECT DISTINCT carries_to_later_editions AS carries, carried_from FROM valo_prices",
                )
              ).rows,
              [{ carries: false, carried_from: null }],
            );
            // The new columns changed every price's hash; the migration reseeded the prices' digest.
            assert.deepEqual(
              (
                await client.query(
                  "SELECT array_agg(name ORDER BY name) AS names FROM valo_history_digest_mismatches() AS name",
                )
              ).rows[0].names ?? [],
              [],
            );
            // A price carried from another carries on to the next edition.
            await assert.rejects(
              client.query(
                `INSERT INTO valo_prices(id,content_version_id,title,amount_kobo,licence_version,licence_text,tax_treatment,approval_reference,effective_from,carried_from)
                 SELECT gen_random_uuid(),content_version_id,title,amount_kobo,licence_version,licence_text,tax_treatment,approval_reference,now(),id FROM valo_prices LIMIT 1`,
              ),
              /valo_prices_carried_check/,
            );
          }),
      );
    for (const tracked of [true, false])
      await t.test(
        `price carry on release migration keeps every row and carries prices only at the release of a premium template's edition (tracked=${tracked})`,
        async () =>
          cluster(async (client, directory) => {
            await applyThrough(client, directory, priceCarryOnReleaseMigration, tracked);
            await seed(client);
            const before = await assertRollsBack(client, priceCarryOnReleaseMigration);
            await applyFor(client, priceCarryOnReleaseMigration, tracked);
            if (!tracked) await raw(client, journalTagsFrom(priceCarryOnReleaseMigration).slice(1));
            assert.deepEqual(await rows(client), before);
            assert.deepEqual(await schema(client), finalSchema);
            assert.deepEqual(await rowSecurityGaps(client), []);
            assert.deepEqual(
              (
                await client.query(
                  "SELECT pg_get_triggerdef(oid) AS definition FROM pg_trigger WHERE tgname='valo_manual_premium_release_carries_prices'",
                )
              ).rows.map((row) => row.definition),
              [
                "CREATE TRIGGER valo_manual_premium_release_carries_prices AFTER UPDATE OF state ON public.valo_manual_library FOR EACH ROW WHEN (((new.state = 'published'::text) AND (old.state IS DISTINCT FROM 'published'::text) AND (new.kind = 'premium_template'::text))) EXECUTE FUNCTION valo_carry_premium_prices()",
              ],
            );
            assert.equal(
              (
                await client.query(
                  "SELECT has_function_privilege('valo_workspace_scope', 'valo_carry_premium_prices()', 'EXECUTE') AS can",
                )
              ).rows[0].can,
              false,
            );
          }),
      );
    for (const tracked of [true, false])
      await t.test(
        `commercial settings migration keeps every row and adds the settings and their change log empty (tracked=${tracked})`,
        async () =>
          cluster(async (client, directory) => {
            await applyThrough(client, directory, commercialSettingsMigration, tracked);
            await seed(client);
            const before = await assertRollsBack(client, commercialSettingsMigration);
            await applyFor(client, commercialSettingsMigration, tracked);
            if (!tracked) await raw(client, journalTagsFrom(commercialSettingsMigration).slice(1));
            assert.deepEqual(await rows(client), before);
            assert.deepEqual(await schema(client), finalSchema);
            assert.deepEqual(await rowSecurityGaps(client), []);
            assert.deepEqual(
              (
                await client.query(
                  "SELECT (SELECT count(*) FROM valo_commercial_settings)::int AS settings, (SELECT count(*) FROM valo_commercial_setting_changes)::int AS changes",
                )
              ).rows,
              [{ settings: 0, changes: 0 }],
            );
          }),
      );
    for (const tracked of [true, false])
      await t.test(
        `commercial setting guards migration keeps every row; a value never changes in place or goes, closes once, is logged, and reaches a customer request only as a value (tracked=${tracked})`,
        async () =>
          cluster(async (client, directory) => {
            await applyThrough(client, directory, commercialSettingGuardsMigration, tracked);
            await seed(client);
            const before = await assertRollsBack(client, commercialSettingGuardsMigration);
            await applyFor(client, commercialSettingGuardsMigration, tracked);
            if (!tracked) await raw(client, journalTagsFrom(commercialSettingGuardsMigration).slice(1));
            assert.deepEqual(await rows(client), before);
            assert.deepEqual(await schema(client), finalSchema);
            assert.deepEqual(await rowSecurityGaps(client), []);
            const insert = (key, value, from = "now()") =>
              client.query(
                `INSERT INTO valo_commercial_settings(key, value, approval_reference, effective_from)
                 VALUES ($1, $2::jsonb, 'synthetic-owner-approval', ${from}) RETURNING id`,
                [key, JSON.stringify(value)],
              );
            const read = async (key) =>
              (await client.query("SELECT valo_commercial_setting($1) AS value", [key])).rows[0].value;
            // With no value recorded the function returns none, and the code reads the setting's default.
            assert.equal(await read("drafting_workspace_daily"), null);
            // A value is a whole number, none below nought, of a setting the code lists.
            for (const [key, value] of [
              ["synthetic_unknown_setting", 1],
              ["drafting_workspace_daily", "30"],
              ["drafting_workspace_daily", 2.5],
              ["drafting_daily_in_all", -1],
            ])
              await assert.rejects(insert(key, value), /valo_commercial_settings_value_check/);
            const {
              rows: [current],
            } = await insert("drafting_workspace_daily", 12, "now() - interval '1 minute'");
            assert.equal(await read("drafting_workspace_daily"), 12);
            // One value at most has no end.
            await assert.rejects(
              insert("drafting_workspace_daily", 14, "now() + interval '1 day'"),
              /valo_commercial_settings_open_unique/,
            );
            // A value never changes in place and is never removed; it closes once, from now or later.
            await assert.rejects(
              client.query("UPDATE valo_commercial_settings SET value = '13' WHERE id = $1", [current.id]),
              /never changes in place/,
            );
            await assert.rejects(
              client.query("DELETE FROM valo_commercial_settings WHERE id = $1", [current.id]),
              /never removed/,
            );
            await assert.rejects(
              client.query(
                "UPDATE valo_commercial_settings SET effective_to = now() - interval '1 second' WHERE id = $1",
                [current.id],
              ),
              /closed once, from now or later/,
            );
            await client.query(
              "UPDATE valo_commercial_settings SET effective_to = now() + interval '1 day' WHERE id = $1",
              [current.id],
            );
            await assert.rejects(
              client.query(
                "UPDATE valo_commercial_settings SET effective_to = now() + interval '2 days' WHERE id = $1",
                [current.id],
              ),
              /closed once, from now or later/,
            );
            // A value scheduled to start later is not in effect yet.
            await insert("drafting_workspace_daily", 14, "now() + interval '1 day'");
            assert.equal(await read("drafting_workspace_daily"), 12);
            // The change log holds each insert and close, and is append-only.
            assert.deepEqual(
              (
                await client.query(
                  "SELECT action FROM valo_commercial_setting_changes WHERE setting_id = $1 ORDER BY changed_at, id",
                  [current.id],
                )
              ).rows.map((row) => row.action),
              ["created", "closed"],
            );
            await assert.rejects(
              client.query("UPDATE valo_commercial_setting_changes SET action = 'created'"),
              /append-only/,
            );
            await assert.rejects(client.query("DELETE FROM valo_commercial_setting_changes"), /append-only/);
            for (const table of ["valo_commercial_settings", "valo_commercial_setting_changes"])
              await assert.rejects(client.query(`TRUNCATE ${table}`), /cannot be truncated/, table);
            // A customer request reads a value through the function, and neither table.
            assert.deepEqual(
              (
                await client.query(
                  `SELECT has_table_privilege('valo_workspace_scope', 'valo_commercial_settings', 'SELECT') AS settings,
                     has_table_privilege('valo_workspace_scope', 'valo_commercial_setting_changes', 'SELECT') AS changes,
                     has_function_privilege('valo_workspace_scope', 'valo_commercial_setting(text)', 'EXECUTE') AS reads`,
                )
              ).rows,
              [{ settings: false, changes: false, reads: true }],
            );
            // Both tables keep their digests as they are written.
            assert.deepEqual(
              (
                await client.query(
                  "SELECT array_agg(name ORDER BY name) AS names FROM valo_history_digest_mismatches() AS name",
                )
              ).rows[0].names ?? [],
              [],
            );
          }),
      );
    for (const tracked of [true, false])
      await t.test(
        `order access rule migration keeps every order with no rule recorded, which carries, lets the rule be yes or no, and lets only a replacement's notice say whether a purchase carries (tracked=${tracked})`,
        async () =>
          cluster(async (client, directory) => {
            await applyThrough(client, directory, orderAccessRuleMigration, tracked);
            await seed(client);
            const before = await assertRollsBack(client, orderAccessRuleMigration);
            await applyFor(client, orderAccessRuleMigration, tracked);
            if (!tracked) await raw(client, journalTagsFrom(orderAccessRuleMigration).slice(1));
            assert.deepEqual(await rows(client), before);
            assert.deepEqual(await schema(client), finalSchema);
            assert.deepEqual(await rowSecurityGaps(client), []);
            // Every order made before records no rule: it carries, as every purchase did when it was made.
            const held = (
              await client.query("SELECT DISTINCT carries_to_later_editions AS rule FROM valo_orders")
            ).rows;
            assert.ok(held.length > 0, "the seed holds an order");
            assert.deepEqual(held, [{ rule: null }]);
            const insert = (key, value) =>
              client.query(
                `INSERT INTO valo_commercial_settings(key, value, approval_reference, effective_from)
                 VALUES ($1, $2::jsonb, 'synthetic-owner-approval', now() + interval '1 day')`,
                [key, JSON.stringify(value)],
              );
            // The access rule is yes or no, and the allowances stay whole numbers.
            await assert.rejects(
              insert("purchase_carries_to_later_editions", 1),
              /valo_commercial_settings_value_check/,
            );
            await assert.rejects(
              insert("drafting_workspace_daily", true),
              /valo_commercial_settings_value_check/,
            );
            await insert("purchase_carries_to_later_editions", false);
            // Only a replacement's notice to a workspace that holds the edition says whether its purchase carries.
            const notice = (kind, replacement, held, carries) =>
              client.query(
                `INSERT INTO valo_edition_notices(workspace_id, route, edition, kind, title, version,
                   replacement_version, held, carries, documents)
                 SELECT id, 'library', gen_random_uuid(), $1, 'Synthetic notice', 1, $2, $3, $4, 1
                 FROM valo_workspaces ORDER BY id LIMIT 1`,
                [kind, replacement, held, carries],
              );
            await assert.rejects(notice("withdrawn", null, true, true), /valo_edition_notice_carries/);
            await assert.rejects(notice("replaced", 2, false, false), /valo_edition_notice_carries/);
            await notice("replaced", 2, true, false);
            await notice("withdrawn", null, true, null);
          }),
      );
    for (const tracked of [true, false])
      await t.test(
        `order access rule guards migration keeps every row; a new order records the rule in effect and keeps it, and each reader of a carried purchase and each edition notice reads it (tracked=${tracked})`,
        async () =>
          cluster(async (client, directory) => {
            await applyThrough(client, directory, orderAccessRuleGuardsMigration, tracked);
            await seed(client);
            const before = await assertRollsBack(client, orderAccessRuleGuardsMigration);
            await applyFor(client, orderAccessRuleGuardsMigration, tracked);
            if (!tracked) await raw(client, journalTagsFrom(orderAccessRuleGuardsMigration).slice(1));
            assert.deepEqual(await rows(client), before);
            assert.deepEqual(await schema(client), finalSchema);
            assert.deepEqual(await rowSecurityGaps(client), []);
            // A new order records the rule in effect when it is made: the inserter gives the rule its buyer
            // accepted, which must be that rule, or none.
            const order = async (given) =>
              (
                await client.query(
                  `INSERT INTO valo_orders(id, workspace_id, requested_by, reference, request_key, price_id, line,
                     amount_kobo, currency, status, carries_to_later_editions)
                   SELECT gen_random_uuid(), workspace_id, requested_by, 'synthetic-rule-' || gen_random_uuid(),
                     gen_random_uuid(), price_id, line, amount_kobo, currency, 'created', $1
                   FROM valo_orders ORDER BY id LIMIT 1
                   RETURNING id, carries_to_later_editions AS rule`,
                  [given],
                )
              ).rows[0];
            const refused = /records the access rule in effect when it is made/;
            assert.equal((await order(null)).rule, true);
            assert.equal((await order(true)).rule, true);
            await assert.rejects(order(false), refused);
            await client.query(
              `INSERT INTO valo_commercial_settings(key, value, approval_reference, effective_from)
               VALUES ('purchase_carries_to_later_editions', 'false', 'synthetic-owner-approval', now() - interval '1 minute')`,
            );
            await assert.rejects(order(true), refused);
            assert.equal((await order(null)).rule, false);
            const no = await order(false);
            assert.equal(no.rule, false);
            // Nothing changes the rule an order recorded; the order's other changes still go through.
            await assert.rejects(
              client.query("UPDATE valo_orders SET carries_to_later_editions = true WHERE id = $1", [no.id]),
              /keeps the access rule it was bought under/,
            );
            await client.query("UPDATE valo_orders SET status = 'pending' WHERE id = $1", [no.id]);
            const readers = [
              "valo_guard_document_form",
              "valo_manual_edition_reach",
              "valo_manual_purchased_file",
              "valo_note_library_edition",
              "valo_note_reviewed_edition",
              "valo_premium_form_edition",
              "valo_workspace_carried_editions",
              "valo_workspace_holds_template",
            ];
            // Each reader that carries a purchase to a later edition, and each writer of an edition's notices,
            // reads the order's own rule.
            assert.deepEqual(
              (
                await client.query(
                  `SELECT p.proname FROM pg_proc p
                   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY($1)
                     AND pg_get_functiondef(p.oid) LIKE '%o.carries_to_later_editions IS NOT FALSE%'
                   ORDER BY 1`,
                  [readers],
                )
              ).rows.map((row) => row.proname),
              readers,
            );
            // The customer role still calls each reader, and records an order's rule through the setting.
            assert.deepEqual(
              (
                await client.query(
                  `SELECT has_function_privilege('valo_workspace_scope', 'valo_manual_purchased_file(uuid)', 'EXECUTE') AS file,
                     has_function_privilege('valo_workspace_scope', 'valo_workspace_carried_editions()', 'EXECUTE') AS carried,
                     has_function_privilege('valo_workspace_scope', 'valo_commercial_setting(text)', 'EXECUTE') AS rule`,
                )
              ).rows,
              [{ file: true, carried: true, rule: true }],
            );
          }),
      );
    for (const tracked of [true, false])
      await t.test(
        `order terms migration keeps every row, and each reader of a purchase checks its terms through one function, which holds only for the edition and licence its order names (tracked=${tracked})`,
        async () =>
          cluster(async (client, directory) => {
            await applyThrough(client, directory, orderTermsMigration, tracked);
            const ids = await seed(client);
            const before = await assertRollsBack(client, orderTermsMigration);
            await applyFor(client, orderTermsMigration, tracked);
            if (!tracked) await raw(client, journalTagsFrom(orderTermsMigration).slice(1));
            assert.deepEqual(await rows(client), before);
            assert.deepEqual(await schema(client), finalSchema);
            assert.deepEqual(await rowSecurityGaps(client), []);
            // Each reader that checked a purchase's price terms itself now calls the one function, and
            // reads no price of its own.
            const readers = [
              "valo_guard_document_form",
              "valo_manual_purchased_file",
              "valo_premium_form_edition",
              "valo_workspace_carried_editions",
              "valo_workspace_holds_template",
            ];
            assert.deepEqual(
              (
                await client.query(
                  `SELECT p.proname, pg_get_functiondef(p.oid) LIKE '%public.valo_order_terms_hold(o.id, %' AS calls,
                     pg_get_functiondef(p.oid) LIKE '%valo_prices%' AS prices
                   FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY($1)
                   ORDER BY 1`,
                  [readers],
                )
              ).rows,
              readers.map((proname) => ({ proname, calls: true, prices: false })),
            );
            // The terms hold for the edition and the licence the order's line copies from its price, and
            // for nothing else.
            const order = async (line) =>
              (
                await client.query(
                  `INSERT INTO valo_orders(id, workspace_id, requested_by, reference, request_key, price_id, line,
                     amount_kobo)
                   VALUES (gen_random_uuid(), $1, 'synthetic-phase1-owner', 'synthetic-terms-' || gen_random_uuid(),
                     gen_random_uuid(), $2, $3::jsonb, 100)
                   RETURNING id`,
                  [ids.workspace, ids.price, JSON.stringify(line)],
                )
              ).rows[0].id;
            const holds = async (id, edition) =>
              (await client.query("SELECT valo_order_terms_hold($1, $2) AS holds", [id, edition])).rows[0]
                .holds;
            const exact = await order({ contentVersionId: ids.content, licenceVersion: "synthetic" });
            assert.equal(await holds(exact, ids.content), true);
            assert.equal(await holds(exact, randomUUID()), false);
            assert.equal(
              await holds(
                await order({ contentVersionId: ids.content, licenceVersion: "other" }),
                ids.content,
              ),
              false,
            );
            assert.equal(
              await holds(
                await order({ contentVersionId: randomUUID(), licenceVersion: "synthetic" }),
                ids.content,
              ),
              false,
            );
            assert.equal(await holds(ids.order, ids.content), false, "the seeded order's line names nothing");
            // In a customer request's scope it reads only that workspace's orders.
            const scoped = async (workspace) => {
              await client.query("BEGIN");
              try {
                await enterWorkspaceScope(client, workspace);
                return await holds(exact, ids.content);
              } finally {
                await client.query("ROLLBACK");
              }
            };
            assert.equal(await scoped(ids.workspace), true);
            const other = randomUUID();
            await client.query("INSERT INTO valo_workspaces(id, owner_identity_id) VALUES ($1, $2)", [
              other,
              "synthetic-phase1-other-" + other,
            ]);
            assert.equal(await scoped(other), false);
            // The customer role may call it, as its owner, and no one else.
            assert.deepEqual(
              (
                await client.query(
                  `SELECT has_function_privilege('valo_workspace_scope', 'valo_order_terms_hold(uuid, uuid)', 'EXECUTE') AS scope,
                     has_function_privilege('public', 'valo_order_terms_hold(uuid, uuid)', 'EXECUTE') AS anyone,
                     (SELECT prosecdef FROM pg_proc WHERE proname = 'valo_order_terms_hold') AS definer`,
                )
              ).rows,
              [{ scope: true, anyone: false, definer: true }],
            );
          }),
      );
    for (const tracked of [true, false])
      await t.test(
        `bundles migration keeps every row and adds the bundles and their change log empty (tracked=${tracked})`,
        async () =>
          cluster(async (client, directory) => {
            await applyThrough(client, directory, bundlesMigration, tracked);
            await seed(client);
            const before = await assertRollsBack(client, bundlesMigration);
            await applyFor(client, bundlesMigration, tracked);
            if (!tracked) await raw(client, journalTagsFrom(bundlesMigration).slice(1));
            assert.deepEqual(await rows(client), before);
            assert.deepEqual(await schema(client), finalSchema);
            assert.deepEqual(await rowSecurityGaps(client), []);
            assert.deepEqual(
              (
                await client.query(
                  "SELECT (SELECT count(*) FROM valo_bundles)::int AS bundles, (SELECT count(*) FROM valo_bundle_changes)::int AS changes",
                )
              ).rows,
              [{ bundles: 0, changes: 0 }],
            );
          }),
      );
    for (const tracked of [true, false])
      await t.test(
        `bundle guards migration keeps every row; a bundle holds two to ten released premium templates once each, and its version never changes in place or goes, closes once, and is logged in a change log no customer request reads (tracked=${tracked})`,
        async () =>
          cluster(async (client, directory) => {
            await applyThrough(client, directory, bundleGuardsMigration, tracked);
            await seed(client);
            const before = await assertRollsBack(client, bundleGuardsMigration);
            await applyFor(client, bundleGuardsMigration, tracked);
            if (!tracked) await raw(client, journalTagsFrom(bundleGuardsMigration).slice(1));
            assert.deepEqual(await rows(client), before);
            assert.deepEqual(await schema(client), finalSchema);
            assert.deepEqual(await rowSecurityGaps(client), []);
            const editor = "synthetic-migration-bundles-" + randomUUID();
            await client.query(
              "INSERT INTO valo_staff_assignments(id,identity_id,role,granted_by,reason) VALUES($1,$2,'content','synthetic migration','Synthetic bundled templates')",
              [randomUUID(), editor],
            );
            // The staff library's items: premium templates, released and not, a free template and a guide.
            const item = async (kind, released = true) => {
              const id = randomUUID();
              const file = kind !== "practical_guide";
              await client.query(
                `INSERT INTO valo_manual_library(id,item_id,version,slug,kind,title,body,digest,file_format,file_bytes,created_by${file ? releaseDetails.columns : ""})
                 VALUES($1::uuid,$1::uuid,1,'manual-'||($1::uuid)::text,$2,'Synthetic bundled item','Synthetic text',repeat('a',64),
                   ${file ? "'docx','\\x01'::bytea" : "NULL,NULL"},$3${file ? releaseDetails.values : ""})`,
                [id, kind, editor],
              );
              if (released)
                await client.query(
                  "UPDATE valo_manual_library SET state='published',published_by=$2,published_at=now() WHERE id=$1",
                  [id, editor],
                );
              return id;
            };
            const premium = [];
            for (let count = 0; count < 11; count++) premium.push(await item("premium_template"));
            const [first, second, third] = premium;
            const insert = ({
              key = "synthetic-bundle",
              items = [first, second],
              amount = 500000,
              reference = "synthetic-owner-approval",
              from = "now()",
            }) =>
              client.query(
                `INSERT INTO valo_bundles(bundle_key, title, items, amount_kobo, licence_version, licence_text,
                   tax_treatment, approval_reference, effective_from)
                 VALUES ($1, 'Synthetic bundle', $2::uuid[], $3, 'synthetic-bundle-1',
                   'Synthetic licence for one business''s own use only.', 'Synthetic tax treatment', $4, ${from})
                 RETURNING id`,
                [key, items, amount, reference],
              );
            // A version holds two to ten templates, each once, and each a premium template of the staff
            // library that has been released.
            await assert.rejects(insert({ items: [first] }), /valo_bundles_items_check/);
            await assert.rejects(insert({ items: premium }), /valo_bundles_items_check/);
            const once = /A bundle lists each of its templates once/;
            await assert.rejects(insert({ items: [first, first] }), once);
            await assert.rejects(insert({ items: [first, null] }), once);
            await assert.rejects(
              insert({
                items: [
                  [first, second],
                  [third, premium[3]],
                ],
              }),
              once,
            );
            const released = /holds only premium templates of the staff library that have been released/;
            for (const other of [
              await item("premium_template", false),
              await item("template"),
              await item("practical_guide"),
              randomUUID(),
            ])
              await assert.rejects(insert({ items: [first, other] }), released);
            // The bundle's name, its amount and the owner's approval.
            await assert.rejects(insert({ key: "Synthetic Bundle" }), /valo_bundles_key_check/);
            await assert.rejects(insert({ amount: 0 }), /valo_bundles_amount_kobo_check/);
            await assert.rejects(insert({ reference: "" }), /valo_bundles_approval_reference_check/);
            const {
              rows: [current],
            } = await insert({ items: premium.slice(0, 10), from: "now() - interval '1 minute'" });
            // One version of a bundle at most has no end.
            await assert.rejects(
              insert({ items: [second, third], from: "now() + interval '1 day'" }),
              /valo_bundles_open_unique/,
            );
            // A version never changes in place and is never removed; it closes once, from now or later.
            await assert.rejects(
              client.query("UPDATE valo_bundles SET amount_kobo = 1 WHERE id = $1", [current.id]),
              /never changes in place/,
            );
            await assert.rejects(
              client.query("UPDATE valo_bundles SET items = $2::uuid[] WHERE id = $1", [
                current.id,
                [first, third],
              ]),
              /never changes in place/,
            );
            await assert.rejects(
              client.query("DELETE FROM valo_bundles WHERE id = $1", [current.id]),
              /never removed/,
            );
            await assert.rejects(
              client.query(
                "UPDATE valo_bundles SET effective_to = now() - interval '1 second' WHERE id = $1",
                [current.id],
              ),
              /closed once, from now or later/,
            );
            await client.query(
              "UPDATE valo_bundles SET effective_to = now() + interval '1 day' WHERE id = $1",
              [current.id],
            );
            await assert.rejects(
              client.query("UPDATE valo_bundles SET effective_to = now() + interval '2 days' WHERE id = $1", [
                current.id,
              ]),
              /closed once, from now or later/,
            );
            // The next version starts then, with other templates.
            const {
              rows: [next],
            } = await insert({ items: [second, third], from: "now() + interval '1 day'" });
            // The change log holds each insert and close, and is append-only.
            const logged = async (id) =>
              (
                await client.query(
                  "SELECT action, bundle->'items' AS items FROM valo_bundle_changes WHERE bundle_id = $1 ORDER BY changed_at, id",
                  [id],
                )
              ).rows;
            assert.deepEqual(await logged(current.id), [
              { action: "created", items: premium.slice(0, 10) },
              { action: "closed", items: premium.slice(0, 10) },
            ]);
            assert.deepEqual(await logged(next.id), [{ action: "created", items: [second, third] }]);
            await assert.rejects(
              client.query("UPDATE valo_bundle_changes SET action = 'created'"),
              /append-only/,
            );
            await assert.rejects(client.query("DELETE FROM valo_bundle_changes"), /append-only/);
            // Neither table can be emptied: alone, it is refused by its guard or, once orders refer to the
            // bundles (migration bundle_orders), by their keys; with what refers to it, by a guard.
            for (const table of ["valo_bundles", "valo_bundle_changes"]) {
              await assert.rejects(
                client.query(`TRUNCATE ${table}`),
                /cannot be truncated|cannot truncate a table referenced in a foreign key constraint/,
                table,
              );
              await assert.rejects(client.query(`TRUNCATE ${table} CASCADE`), /cannot be truncated/, table);
            }
            // A customer request never reads the change log. Checkout reads and locks a bundle's version from
            // the bundle order guards migration on (slice 4c), which has its own check.
            assert.deepEqual(
              (
                await client.query(
                  `SELECT has_table_privilege('valo_workspace_scope', 'valo_bundles', 'SELECT') AS bundles,
                     has_table_privilege('valo_workspace_scope', 'valo_bundle_changes', 'SELECT') AS changes`,
                )
              ).rows,
              [{ bundles: true, changes: false }],
            );
            // Both tables keep their digests as they are written.
            assert.deepEqual(
              (
                await client.query(
                  "SELECT array_agg(name ORDER BY name) AS names FROM valo_history_digest_mismatches() AS name",
                )
              ).rows[0].names ?? [],
              [],
            );
          }),
      );
    for (const tracked of [true, false])
      await t.test(
        `bundle orders migration keeps every order as one that names its price, and lets an order name a price or a bundle and hold a grant for each edition (tracked=${tracked})`,
        async () =>
          cluster(async (client, directory) => {
            await applyThrough(client, directory, bundleOrdersMigration, tracked);
            const ids = await seed(client);
            const before = await assertRollsBack(client, bundleOrdersMigration);
            await applyFor(client, bundleOrdersMigration, tracked);
            if (!tracked) await raw(client, journalTagsFrom(bundleOrdersMigration).slice(1));
            assert.deepEqual(await rows(client), before);
            assert.deepEqual(await schema(client), finalSchema);
            assert.deepEqual(await rowSecurityGaps(client), []);
            // Every order held before names its price and no bundle.
            assert.deepEqual(
              (
                await client.query(
                  "SELECT DISTINCT price_id IS NOT NULL AS priced, bundle_id FROM valo_orders",
                )
              ).rows,
              [{ priced: true, bundle_id: null }],
            );
            // An order names exactly one of a price and a bundle.
            const order = (price) =>
              client.query(
                `INSERT INTO valo_orders(id, workspace_id, requested_by, reference, request_key, price_id, line, amount_kobo)
                 VALUES (gen_random_uuid(), $1, 'synthetic-phase1-owner', 'synthetic-offer-' || gen_random_uuid(),
                   gen_random_uuid(), $2, '{}', 100)`,
                [ids.workspace, price],
              );
            await assert.rejects(order(null), /valo_orders_offer_check/);
            await order(ids.price);
            // An order holds one grant for each edition it grants, and no edition twice.
            const grant = (edition) =>
              client.query(
                "INSERT INTO valo_entitlements(id, workspace_id, order_id, content_version_id) VALUES (gen_random_uuid(), $1, $2, $3)",
                [ids.workspace, ids.order, edition],
              );
            await grant(ids.content);
            await assert.rejects(grant(ids.content), /valo_entitlement_order_edition_unique/);
            const other = randomUUID();
            await drafting(
              client,
              `INSERT INTO valo_content_versions(id,template_id,version,slug,policy_id,candidate_hash,bundle,attestations,review_by)
               VALUES($1,'SYNTHETIC-OTHER',1,'phase1-synthetic-other','phase1-synthetic','not-approved','{}','{}',now())`,
              [other],
            );
            await grant(other);
          }),
      );
    for (const tracked of [true, false])
      await t.test(
        `bundle order guards migration keeps every row; a bundle's order holds for the editions its line names of the bundle's templates, under its licence, and a customer request reads a bundle's templates and locks its version (tracked=${tracked})`,
        async () =>
          cluster(async (client, directory) => {
            await applyThrough(client, directory, bundleOrderGuardsMigration, tracked);
            const ids = await seed(client);
            const before = await assertRollsBack(client, bundleOrderGuardsMigration);
            await applyFor(client, bundleOrderGuardsMigration, tracked);
            if (!tracked) await raw(client, journalTagsFrom(bundleOrderGuardsMigration).slice(1));
            assert.deepEqual(await rows(client), before);
            assert.deepEqual(await schema(client), finalSchema);
            assert.deepEqual(await rowSecurityGaps(client), []);
            const editor = "synthetic-migration-bundle-orders-" + randomUUID();
            await client.query(
              "INSERT INTO valo_staff_assignments(id,identity_id,role,granted_by,reason) VALUES($1,$2,'content','synthetic migration','Synthetic bundle orders')",
              [randomUUID(), editor],
            );
            const template = async (released = true) => {
              const id = randomUUID();
              await client.query(
                `INSERT INTO valo_manual_library(id,item_id,version,slug,kind,title,body,digest,file_format,file_bytes,created_by${releaseDetails.columns})
                 VALUES($1::uuid,$1::uuid,1,'manual-'||($1::uuid)::text,'premium_template','Synthetic bundled ' || $1,'Synthetic text',repeat('a',64),
                   'docx','\\x01'::bytea,$2${releaseDetails.values})`,
                [id, editor],
              );
              if (released)
                await client.query(
                  "UPDATE valo_manual_library SET state='published',published_by=$2,published_at=now() WHERE id=$1",
                  [id, editor],
                );
              return id;
            };
            const [first, second, outside] = [await template(), await template(), await template()];
            const {
              rows: [bundle],
            } = await client.query(
              `INSERT INTO valo_bundles(bundle_key, title, items, amount_kobo, licence_version, licence_text,
                 tax_treatment, approval_reference, effective_from)
               VALUES ('synthetic-bundle', 'Synthetic bundle', $1::uuid[], 500000, 'synthetic-bundle-1',
                 'Synthetic licence for one business''s own use only.', 'Synthetic tax treatment',
                 'synthetic-owner-approval', now())
               RETURNING id`,
              [[first, second].sort()],
            );
            // Each of the bundle's templates, with its released edition and whether it is held.
            const editions = async () =>
              (
                await client.query("SELECT item, edition, held FROM valo_bundle_editions($1) ORDER BY item", [
                  bundle.id,
                ])
              ).rows;
            assert.deepEqual(
              await editions(),
              [first, second].sort().map((item) => ({ item, edition: item, held: false })),
            );
            const order = async (line) =>
              (
                await client.query(
                  `INSERT INTO valo_orders(id, workspace_id, requested_by, reference, request_key, bundle_id, line, amount_kobo)
                   VALUES (gen_random_uuid(), $1, 'synthetic-phase1-owner', 'synthetic-bundle-' || gen_random_uuid(),
                     gen_random_uuid(), $2, $3::jsonb, 500000)
                   RETURNING id`,
                  [ids.workspace, bundle.id, JSON.stringify(line)],
                )
              ).rows[0].id;
            const holds = async (id, edition) =>
              (await client.query("SELECT valo_order_terms_hold($1, $2) AS holds", [id, edition])).rows[0]
                .holds;
            const named = (...editions) => ({
              title: "Synthetic bundle",
              bundle: "synthetic-bundle",
              licenceVersion: "synthetic-bundle-1",
              editions: editions.map((contentVersionId) => ({ contentVersionId, title: "Synthetic" })),
            });
            // A bundle's order holds for each edition its line names of the bundle's templates, under its licence.
            const bought = await order(named(first, second));
            assert.equal(await holds(bought, first), true);
            assert.equal(await holds(bought, second), true);
            // Not for an edition its line does not name, nor one of another template, nor under another licence.
            const partial = await order(named(first));
            assert.equal(await holds(partial, second), false);
            assert.equal(await holds(await order(named(first, outside)), outside), false);
            assert.equal(
              await holds(await order({ ...named(first), licenceVersion: "synthetic-bundle-0" }), first),
              false,
            );
            // A template's order is checked as before.
            assert.equal(await holds(ids.order, ids.content), false, "the seeded order's line names nothing");
            // A customer request reads a bundle's templates and locks its version, and changes nothing.
            await client.query("BEGIN");
            try {
              await enterWorkspaceScope(client, ids.workspace);
              assert.equal(
                (await client.query("SELECT count(*)::int AS n FROM valo_bundle_editions($1)", [bundle.id]))
                  .rows[0].n,
                2,
              );
              await client.query("SELECT id FROM valo_bundles WHERE id = $1 FOR SHARE", [bundle.id]);
              assert.equal(await holds(bought, first), true);
              await assert.rejects(
                client.query(
                  "UPDATE valo_bundles SET effective_to = now() + interval '1 day' WHERE id = $1",
                  [bundle.id],
                ),
                /may lock rows of valo_bundles but not change them/,
              );
            } finally {
              await client.query("ROLLBACK");
            }
            assert.deepEqual(
              (
                await client.query(
                  `SELECT has_function_privilege('valo_workspace_scope', 'valo_bundle_editions(uuid)', 'EXECUTE') AS scope,
                     has_function_privilege('public', 'valo_bundle_editions(uuid)', 'EXECUTE') AS anyone,
                     (SELECT prosecdef FROM pg_proc WHERE proname = 'valo_bundle_editions') AS definer`,
                )
              ).rows,
              [{ scope: true, anyone: false, definer: true }],
            );
          }),
      );
    for (const tracked of [true, false])
      await t.test(
        `replaced reviewed versions migration keeps every row, and on the reviewed route a workspace holds a premium form's template only through a version not replaced (tracked=${tracked})`,
        async () =>
          cluster(async (client, directory) => {
            await applyThrough(client, directory, replacedReviewedVersionsMigration, tracked);
            await seed(client);
            const before = await assertRollsBack(client, replacedReviewedVersionsMigration);
            await applyFor(client, replacedReviewedVersionsMigration, tracked);
            if (!tracked) await raw(client, journalTagsFrom(replacedReviewedVersionsMigration).slice(1));
            assert.deepEqual(await rows(client), before);
            assert.deepEqual(await schema(client), finalSchema);
            assert.deepEqual(await rowSecurityGaps(client), []);
            // Two versions of a reviewed template. Only the publisher's login publishes; in this throwaway
            // cluster the synthetic versions stay published.
            const policy = "synthetic-replaced-" + randomUUID();
            await client.query(
              "INSERT INTO valo_publication_policies(id,hash,policy,authority) VALUES($1,'synthetic','{}','{}')",
              [policy],
            );
            const template = "SYNTHETIC-REPLACED-" + randomUUID();
            const reviewed = async (version) => {
              const id = randomUUID();
              await drafting(
                client,
                `INSERT INTO valo_content_versions(id,template_id,version,slug,policy_id,candidate_hash,bundle,attestations,review_by)
                 VALUES($1,$2,$3,$4,$5,'synthetic','{}','{}',now()+interval '30 days')`,
                [id, template, version, template.toLowerCase(), policy],
              );
              return id;
            };
            await client.query("ALTER ROLE valo_publisher_login LOGIN");
            const publisher = new pg.Client({
              host: "127.0.0.1",
              port: client.port,
              user: "valo_publisher_login",
              database: "postgres",
              connectionTimeoutMillis: 5000,
            });
            await publisher.connect();
            const release = async (id) => {
              await publisher.query("BEGIN");
              await publisher.query("SET LOCAL ROLE valo_content_publisher_dev");
              await publisher.query(
                "UPDATE valo_content_versions SET status='published',published_at=now() WHERE id=$1",
                [id],
              );
              await publisher.query("COMMIT");
            };
            try {
              const first = await reviewed(1);
              await release(first);
              // Version 1 is bought twice: once while the owner's rule carries a purchase to later
              // versions, and once while it says the order covers only the version bought.
              const price = randomUUID();
              await client.query(
                `INSERT INTO valo_prices(id,content_version_id,title,amount_kobo,licence_version,licence_text,tax_treatment,approval_reference,effective_from)
                 VALUES($1,$2,'Synthetic replaced template',100,'synthetic-licence','Not a sales licence','No tax assertion','SYNTHETIC-NOT-APPROVED',now())`,
                [price, first],
              );
              const buy = async () => {
                const workspace = randomUUID(),
                  order = randomUUID();
                await client.query("INSERT INTO valo_workspaces(id,owner_identity_id) VALUES($1,$2)", [
                  workspace,
                  "synthetic-phase1-" + workspace,
                ]);
                await client.query(
                  `INSERT INTO valo_orders(id,workspace_id,requested_by,reference,request_key,price_id,line,amount_kobo,status,provider_transaction_id)
                   VALUES($1,$2,'synthetic-phase1-owner',$3,$4,$5,$6,100,'verified_success',$7)`,
                  [
                    order,
                    workspace,
                    "synthetic-" + order,
                    randomUUID(),
                    price,
                    JSON.stringify({ contentVersionId: first, licenceVersion: "synthetic-licence" }),
                    "synthetic-" + order,
                  ],
                );
                await client.query(
                  "INSERT INTO valo_entitlements(id,workspace_id,order_id,content_version_id) VALUES($1,$2,$3,$4)",
                  [randomUUID(), workspace, order, first],
                );
                return workspace;
              };
              const carrying = await buy();
              await client.query(
                `INSERT INTO valo_commercial_settings(key, value, approval_reference, effective_from)
                 VALUES ('purchase_carries_to_later_editions', 'false', 'synthetic-owner-approval', now() - interval '1 minute')`,
              );
              const onlyBought = await buy();
              const stranger = randomUUID();
              await client.query("INSERT INTO valo_workspaces(id,owner_identity_id) VALUES($1,$2)", [
                stranger,
                "synthetic-phase1-" + stranger,
              ]);
              const holds = async (workspaceId) => {
                await client.query("BEGIN");
                try {
                  await enterWorkspaceScope(client, workspaceId);
                  return (
                    await client.query(
                      "SELECT valo_workspace_holds_template($1, 'Synthetic replaced') AS holds",
                      [template],
                    )
                  ).rows[0].holds;
                } finally {
                  await client.query("ROLLBACK");
                }
              };
              const all = async () => [await holds(carrying), await holds(onlyBought), await holds(stranger)];
              // While version 1 is the latest release, both buyers hold the template, and nobody else.
              assert.deepEqual(await all(), [true, true, false]);
              // Version 2 replaces it: the purchase that carries holds the template through version 2, and the
              // one that covers only version 1 holds nothing.
              const second = await reviewed(2);
              await release(second);
              assert.deepEqual(await all(), [true, false, false]);
              // A version that was never released replaces nothing.
              await client.query("UPDATE valo_content_versions SET status='held' WHERE id=$1", [
                await reviewed(3),
              ]);
              assert.deepEqual(await all(), [true, false, false]);
              // Version 2 withdrawn: version 1 stays replaced, so neither buyer holds the template.
              await client.query(
                "UPDATE valo_content_versions SET status='withdrawn',withdrawn_reason='Synthetic withdrawal of the replacing version.' WHERE id=$1",
                [second],
              );
              assert.deepEqual(await all(), [false, false, false]);
            } finally {
              await publisher.end();
            }
            // The customer role still calls it, and it still runs as its owner.
            assert.deepEqual(
              (
                await client.query(
                  `SELECT has_function_privilege('valo_workspace_scope', 'valo_workspace_holds_template(text,text)', 'EXECUTE') AS scope,
                     has_function_privilege('public', 'valo_workspace_holds_template(text,text)', 'EXECUTE') AS anyone,
                     (SELECT prosecdef FROM pg_proc WHERE proname = 'valo_workspace_holds_template') AS definer`,
                )
              ).rows,
              [{ scope: true, anyone: false, definer: true }],
            );
          }),
      );
    // The designated development owner of decision 0018: a permanent system role the operator's bootstrap
    // granted.
    const developmentOwner = async (client, owner) => {
      const assignment = randomUUID();
      await client.query(
        "INSERT INTO valo_staff_assignments(id,identity_id,role,granted_by,reason) VALUES($1,$2,'system','synthetic migration','Synthetic guide check owner fixture')",
        [assignment, owner],
      );
      await client.query(
        `INSERT INTO valo_staff_role_changes(id,request_key,input_hash,actor_id,actor_assignment_id,assignment_id,target_identity_id,action,role,reason,after_state)
         VALUES (gen_random_uuid(),gen_random_uuid(),repeat('b',64),'operator-bootstrap:synthetic',$1,$1,$2,'grant','system','Synthetic guide check owner bootstrap','{"active":true}'::jsonb)`,
        [assignment, owner],
      );
      return assignment;
    };
    // A prepared guide on the reviewed route, as the preparer records it, and a check of its sources.
    const preparedGuide = async (client, guideId = "GUD-02") => {
      const guide = {
        artifactId: randomUUID(),
        artifactHash: "a".repeat(64),
        versionId: randomUUID(),
        guideId,
        version: 1,
        candidateHash: "c".repeat(64),
        captures: { "CAC-CAMA-2020:s.119": randomUUID(), "CAC-CAMA-2020:s.123": randomUUID() },
      };
      await drafting(
        client,
        `INSERT INTO valo_prepared_candidates(artifact_id,artifact_hash,version_id,template_id,version,candidate_hash,prepared_at,review_by)
         VALUES($1,$2,$3,$4,$5,$6,now(),now()+interval '30 days')`,
        [
          guide.artifactId,
          guide.artifactHash,
          guide.versionId,
          guide.guideId,
          guide.version,
          guide.candidateHash,
        ],
      );
      return guide;
    };
    const recordGuideCheck = (client, guide, checkedBy, change = {}) => {
      const values = { ...guide, ...change };
      return client.query(
        `INSERT INTO valo_reviewed_guide_checks(artifact_id,artifact_hash,version_id,guide_id,version,candidate_hash,captures,checked_by${values.checkedAt ? ",checked_at" : ""})
         VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8${values.checkedAt ? ",$9" : ""}) RETURNING id, checked_at`,
        [
          values.artifactId,
          values.artifactHash,
          values.versionId,
          values.guideId,
          values.version,
          values.candidateHash,
          JSON.stringify(values.captures),
          checkedBy,
          ...(values.checkedAt ? [values.checkedAt] : []),
        ],
      );
    };
    for (const tracked of [true, false])
      await t.test(
        `reviewed guide checks migration keeps every row and adds an empty table of the owner's checks, each naming a prepared guide's candidate and its captures, that customer requests and the publisher cannot read (tracked=${tracked})`,
        async () =>
          cluster(async (client, directory) => {
            await applyThrough(client, directory, reviewedGuideChecksMigration, tracked);
            await seed(client);
            const before = await assertRollsBack(client, reviewedGuideChecksMigration);
            await applyFor(client, reviewedGuideChecksMigration, tracked);
            if (!tracked) await raw(client, journalTagsFrom(reviewedGuideChecksMigration).slice(1));
            assert.deepEqual(await rows(client), before);
            assert.deepEqual(await schema(client), finalSchema);
            assert.deepEqual(await rowSecurityGaps(client), []);
            assert.equal(
              (await client.query("SELECT count(*)::int AS n FROM valo_reviewed_guide_checks")).rows[0].n,
              0,
            );
            // Made by the development owner, so that only the table's own constraints refuse below.
            const owner = "synthetic-migration-guide-check-owner";
            await developmentOwner(client, owner);
            const guide = await preparedGuide(client);
            // A check names a prepared candidate, a guide and its version, the candidate's checksums, and
            // the capture checked of each of its sources.
            await assert.rejects(
              recordGuideCheck(client, guide, owner, { artifactId: randomUUID() }),
              /valo_reviewed_guide_checks_artifact_fk/,
            );
            await assert.rejects(
              recordGuideCheck(client, guide, owner, { guideId: "TPL-01" }),
              /valo_reviewed_guide_checks_guide_check/,
            );
            await assert.rejects(
              recordGuideCheck(client, guide, owner, { version: 0 }),
              /valo_reviewed_guide_checks_guide_check/,
            );
            await assert.rejects(
              recordGuideCheck(client, guide, owner, { candidateHash: "synthetic" }),
              /valo_reviewed_guide_checks_hash_check/,
            );
            await assert.rejects(
              recordGuideCheck(client, guide, owner, { artifactHash: "A".repeat(64) }),
              /valo_reviewed_guide_checks_hash_check/,
            );
            for (const captures of [{}, ["synthetic"]])
              await assert.rejects(
                recordGuideCheck(client, guide, owner, { captures }),
                /valo_reviewed_guide_checks_captures_check/,
              );
            await recordGuideCheck(client, guide, owner);
            assert.deepEqual(
              (
                await client.query(
                  "SELECT version_id, guide_id, version, candidate_hash, captures, checked_by FROM valo_reviewed_guide_checks",
                )
              ).rows,
              [
                {
                  version_id: guide.versionId,
                  guide_id: guide.guideId,
                  version: guide.version,
                  candidate_hash: guide.candidateHash,
                  captures: guide.captures,
                  checked_by: owner,
                },
              ],
            );
            // Customer requests, the drafter and the publisher hold no privilege on the table.
            for (const role of [
              "valo_workspace_scope",
              "valo_content_drafter_dev",
              "valo_content_publisher_dev",
            ])
              assert.deepEqual(
                (
                  await client.query(
                    `SELECT ${["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"]
                      .map((p) => `has_table_privilege($1, 'valo_reviewed_guide_checks', '${p}') AS "${p}"`)
                      .join(",")}`,
                    [role],
                  )
                ).rows,
                [{ SELECT: false, INSERT: false, UPDATE: false, DELETE: false, TRUNCATE: false }],
                role,
              );
          }),
      );
    for (const tracked of [true, false])
      await t.test(
        `reviewed guide check guards migration records only the development owner's check, at the database's time, never changes or removes one, and the publisher releases a guide only on such a check of its exact candidate and captures from within the last day (tracked=${tracked})`,
        async () =>
          cluster(async (client, directory) => {
            await applyThrough(client, directory, reviewedGuideCheckGuardsMigration, tracked);
            await seed(client);
            const before = await assertRollsBack(client, reviewedGuideCheckGuardsMigration);
            await applyFor(client, reviewedGuideCheckGuardsMigration, tracked);
            if (!tracked) await raw(client, journalTagsFrom(reviewedGuideCheckGuardsMigration).slice(1));
            assert.deepEqual(await rows(client), before);
            assert.deepEqual(await schema(client), finalSchema);
            assert.deepEqual(await rowSecurityGaps(client), []);
            const owner = "synthetic-migration-guide-check-owner";
            const ownerAssignment = await developmentOwner(client, owner);
            const guide = await preparedGuide(client);
            const checked = async (change = {}) => {
              const wanted = { ...guide, ...change };
              return (
                await client.query("SELECT valo_reviewed_guide_checked($1, $2, $3::jsonb) AS checked", [
                  wanted.versionId,
                  wanted.candidateHash,
                  JSON.stringify(wanted.captures),
                ])
              ).rows[0].checked;
            };
            assert.equal(await checked(), false, "no check is recorded yet");
            // Nobody but the development owner checks a guide's sources: not staff of another role, not a
            // system role the bootstrap did not grant, and not an identity with no role.
            const content = "synthetic-migration-guide-check-editor",
              system = "synthetic-migration-guide-check-system";
            await client.query(
              "INSERT INTO valo_staff_assignments(id,identity_id,role,granted_by,reason) VALUES($1,$2,'content','synthetic migration','Synthetic content editor'),($3,$4,'system','synthetic migration','Synthetic system role without the bootstrap grant')",
              [randomUUID(), content, randomUUID(), system],
            );
            for (const who of [content, system, "synthetic-migration-not-staff"])
              await assert.rejects(
                recordGuideCheck(client, guide, who),
                /Only the development owner checks a guide's sources for its release/,
                who,
              );
            assert.equal(
              (await client.query("SELECT count(*)::int AS n FROM valo_reviewed_guide_checks")).rows[0].n,
              0,
            );
            // The owner's check is recorded at the time the database gives it, whatever time it names.
            const [recorded] = (
              await recordGuideCheck(client, guide, owner, {
                checkedAt: new Date(Date.now() - 3 * 86_400_000),
              })
            ).rows;
            assert.equal(
              (
                await client.query(
                  "SELECT checked_at > now() - interval '1 minute' AND checked_at <= clock_timestamp() AS current FROM valo_reviewed_guide_checks WHERE id=$1",
                  [recorded.id],
                )
              ).rows[0].current,
              true,
            );
            // It counts for that version, that candidate and exactly those captures.
            assert.equal(await checked(), true);
            assert.equal(await checked({ versionId: randomUUID() }), false, "another version");
            assert.equal(await checked({ candidateHash: "d".repeat(64) }), false, "another candidate");
            const [firstSource, secondSource] = Object.keys(guide.captures);
            assert.equal(
              await checked({ captures: { ...guide.captures, [firstSource]: randomUUID() } }),
              false,
              "another capture of one source",
            );
            assert.equal(
              await checked({ captures: { [secondSource]: guide.captures[secondSource] } }),
              false,
              "one source fewer",
            );
            assert.equal(
              await checked({ captures: { ...guide.captures, "CAC-CAMA-2020:s.124": randomUUID() } }),
              false,
              "one source more",
            );
            // A check is never changed or removed, and the table is never emptied.
            await assert.rejects(
              client.query("UPDATE valo_reviewed_guide_checks SET checked_at = now() WHERE id=$1", [
                recorded.id,
              ]),
              /never changed or removed/,
            );
            await assert.rejects(
              client.query(
                'UPDATE valo_reviewed_guide_checks SET captures = \'{"synthetic":"x"}\' WHERE id=$1',
                [recorded.id],
              ),
              /never changed or removed/,
            );
            await assert.rejects(
              client.query("DELETE FROM valo_reviewed_guide_checks WHERE id=$1", [recorded.id]),
              /never changed or removed/,
            );
            await assert.rejects(client.query("TRUNCATE valo_reviewed_guide_checks"), /cannot be truncated/);
            // A check counts only once it was made and for a day after. In this throwaway cluster the guard
            // alone is set aside to move the recorded time.
            const retime = async (time) => {
              await client.query(
                "ALTER TABLE valo_reviewed_guide_checks DISABLE TRIGGER valo_reviewed_guide_checks_guard",
              );
              try {
                await client.query(`UPDATE valo_reviewed_guide_checks SET checked_at = ${time} WHERE id=$1`, [
                  recorded.id,
                ]);
              } finally {
                await client.query(
                  "ALTER TABLE valo_reviewed_guide_checks ENABLE TRIGGER valo_reviewed_guide_checks_guard",
                );
              }
            };
            await retime("now() + interval '1 hour'");
            assert.equal(await checked(), false, "a check recorded later than now");
            await retime("now() - interval '23 hours 59 minutes'");
            assert.equal(await checked(), true, "a check made just under a day ago");
            await retime("now() - interval '1 day 1 minute'");
            assert.equal(await checked(), false, "a check made over a day ago");

            // The publisher releases a guide only on the owner's check, from within the last day, of the
            // exact candidate and captures the version names; a template needs none.
            const policy = "synthetic-guide-check-" + randomUUID();
            await client.query(
              "INSERT INTO valo_publication_policies(id,hash,policy,authority) VALUES($1,'synthetic','{}','{}')",
              [policy],
            );
            const version = async (id, templateId, candidateHash, bundle, attestations) =>
              drafting(
                client,
                `INSERT INTO valo_content_versions(id,template_id,version,slug,policy_id,candidate_hash,bundle,attestations,review_by)
                 VALUES($1,$2,1,$3,$4,$5,$6,$7,now()+interval '30 days')`,
                [
                  id,
                  templateId,
                  "synthetic-" + id,
                  policy,
                  candidateHash,
                  JSON.stringify(bundle),
                  JSON.stringify(attestations),
                ],
              );
            const sourced = { candidate: { contentClass: "sourced_guidance" } };
            await version(guide.versionId, guide.guideId, guide.candidateHash, sourced, {
              sourceSnapshots: guide.captures,
            });
            // Another prepared guide, saved with attestations that bind one of its sources to another
            // capture than the owner checked.
            const drifted = await preparedGuide(client, "GUD-03");
            await version(drifted.versionId, drifted.guideId, drifted.candidateHash, sourced, {
              sourceSnapshots: { ...drifted.captures, [firstSource]: randomUUID() },
            });
            const template = randomUUID();
            await version(template, "SYNTHETIC-GUIDE-CHECK-" + template, "synthetic", {}, {});
            await client.query("ALTER ROLE valo_publisher_login LOGIN");
            const publisher = new pg.Client({
              host: "127.0.0.1",
              port: client.port,
              user: "valo_publisher_login",
              database: "postgres",
              connectionTimeoutMillis: 5000,
            });
            await publisher.connect();
            const release = async (id) => {
              await publisher.query("BEGIN");
              try {
                await publisher.query("SET LOCAL ROLE valo_content_publisher_dev");
                await publisher.query(
                  "UPDATE valo_content_versions SET status='published',published_at=now() WHERE id=$1",
                  [id],
                );
                await publisher.query("COMMIT");
              } catch (error) {
                await publisher.query("ROLLBACK");
                throw error;
              }
            };
            const status = async (id) =>
              (await client.query("SELECT status FROM valo_content_versions WHERE id=$1", [id])).rows[0]
                .status;
            const required =
              /Owner source check required: the development owner's check of this exact guide's sources/;
            try {
              // The owner's only check is over a day old.
              await assert.rejects(release(guide.versionId), required);
              assert.equal(await status(guide.versionId), "candidate");
              // A current check of a guide's candidate does not release its version once that version binds
              // another capture than the owner checked.
              await recordGuideCheck(client, guide, owner);
              await recordGuideCheck(client, drifted, owner);
              await assert.rejects(release(drifted.versionId), required);
              assert.equal(await status(drifted.versionId), "candidate");
              // It releases the version it was made for, and a template needs no check.
              await release(guide.versionId);
              assert.equal(await status(guide.versionId), "published");
              await release(template);
              assert.equal(await status(template), "published");
              // Once the owner's grant has ended, their checks no longer count: a guide they checked is not
              // released, and they record no more.
              const lapsed = await preparedGuide(client, "GUD-04");
              await version(lapsed.versionId, lapsed.guideId, lapsed.candidateHash, sourced, {
                sourceSnapshots: lapsed.captures,
              });
              await recordGuideCheck(client, lapsed, owner);
              await client.query("UPDATE valo_staff_assignments SET active=false WHERE id=$1", [
                ownerAssignment,
              ]);
              assert.equal(await checked(), false, "the person who checked is no longer the owner");
              await assert.rejects(release(lapsed.versionId), required);
              assert.equal(await status(lapsed.versionId), "candidate");
              await assert.rejects(
                recordGuideCheck(client, guide, owner),
                /Only the development owner checks a guide's sources for its release/,
              );
            } finally {
              await publisher.end();
            }
            // The publisher may ask whether a guide was checked, and reads nothing else of the checks or
            // the staff records; customer requests may not ask. The function runs as its owner with a
            // fixed search path, and the guard is no function anyone calls.
            assert.deepEqual(
              (
                await client.query(
                  `SELECT has_function_privilege('valo_content_publisher_dev', 'valo_reviewed_guide_checked(uuid,text,jsonb)', 'EXECUTE') AS publisher,
                     has_function_privilege('valo_workspace_scope', 'valo_reviewed_guide_checked(uuid,text,jsonb)', 'EXECUTE') AS scope,
                     has_function_privilege('public', 'valo_reviewed_guide_checked(uuid,text,jsonb)', 'EXECUTE') AS anyone,
                     has_function_privilege('public', 'valo_reviewed_guide_check_guard()', 'EXECUTE') AS guard,
                     has_table_privilege('valo_content_publisher_dev', 'valo_reviewed_guide_checks', 'SELECT') AS "publisherReadsChecks",
                     has_table_privilege('valo_content_publisher_dev', 'valo_staff_assignments', 'SELECT') AS "publisherReadsStaff",
                     p.prosecdef AS definer, p.proconfig AS config
                   FROM pg_proc p WHERE p.proname = 'valo_reviewed_guide_checked'`,
                )
              ).rows,
              [
                {
                  publisher: true,
                  scope: false,
                  anyone: false,
                  guard: false,
                  publisherReadsChecks: false,
                  publisherReadsStaff: false,
                  definer: true,
                  config: ["search_path=pg_catalog, pg_temp"],
                },
              ],
            );
            // The table keeps its digest as it is written.
            assert.deepEqual(
              (
                await client.query(
                  "SELECT array_agg(name ORDER BY name) AS names FROM valo_history_digest_mismatches() AS name",
                )
              ).rows[0].names ?? [],
              [],
            );
          }),
      );
    // PRO-002 (docs/architecture/processing-inventory.md, slice 4): each change to a workspace's optional
    // choices, with the version of the privacy notice in force.
    const consentChange = (client, workspaceId, change = {}) =>
      client.query(
        "INSERT INTO valo_consent_changes(workspace_id, consent, choice, notice_version, actor_id) VALUES($1,$2,$3,$4,$5)",
        [
          change.workspaceId ?? workspaceId,
          change.consent ?? "marketing",
          change.choice ?? true,
          change.noticeVersion ?? "a".repeat(64),
          "synthetic-migration-consent",
        ],
      );
    for (const tracked of [true, false])
      await t.test(
        `consent changes migration keeps every row and adds an empty table of each change to a workspace's marketing or reminder choice, with the notice version in force, limited to that workspace (tracked=${tracked})`,
        async () =>
          cluster(async (client, directory) => {
            await applyThrough(client, directory, consentChangesMigration, tracked);
            await seed(client);
            const before = await assertRollsBack(client, consentChangesMigration);
            await applyFor(client, consentChangesMigration, tracked);
            if (!tracked) await raw(client, journalTagsFrom(consentChangesMigration).slice(1));
            assert.deepEqual(await rows(client), before);
            assert.deepEqual(await schema(client), finalSchema);
            assert.deepEqual(await rowSecurityGaps(client), []);
            assert.equal(
              (await client.query("SELECT count(*)::int AS n FROM valo_consent_changes")).rows[0].n,
              0,
            );
            const workspaceId = randomUUID();
            await client.query("INSERT INTO valo_workspaces(id,owner_identity_id) VALUES($1,$2)", [
              workspaceId,
              "synthetic-migration-consent",
            ]);
            await consentChange(client, workspaceId);
            await consentChange(client, workspaceId, { consent: "reminders", choice: false });
            // Only the two choices, a whole notice version, and a workspace that exists.
            await assert.rejects(
              consentChange(client, workspaceId, { consent: "newsletter" }),
              /valo_consent_change_shape/,
            );
            await assert.rejects(
              consentChange(client, workspaceId, { noticeVersion: "development-processing-v1" }),
              /valo_consent_change_shape/,
            );
            await assert.rejects(
              consentChange(client, workspaceId, { workspaceId: randomUUID() }),
              /valo_consent_changes_workspace_id_valo_workspaces_id_fk/,
            );
            assert.deepEqual(
              (
                await client.query(
                  "SELECT relrowsecurity AS limited FROM pg_class WHERE oid = 'public.valo_consent_changes'::regclass",
                )
              ).rows,
              [{ limited: true }],
            );
          }),
      );
    for (const tracked of [true, false])
      await t.test(
        `consent change grants migration lets customer requests add a change and read their own, and never change or remove one (tracked=${tracked})`,
        async () =>
          cluster(async (client, directory) => {
            await applyThrough(client, directory, consentChangeGrantsMigration, tracked);
            await seed(client);
            const before = await assertRollsBack(client, consentChangeGrantsMigration);
            await applyFor(client, consentChangeGrantsMigration, tracked);
            if (!tracked) await raw(client, journalTagsFrom(consentChangeGrantsMigration).slice(1));
            assert.deepEqual(await rows(client), before);
            assert.deepEqual(await schema(client), finalSchema);
            assert.deepEqual(await rowSecurityGaps(client), []);
            assert.deepEqual(
              (
                await client.query(
                  `SELECT has_table_privilege('valo_workspace_scope', 'valo_consent_changes', 'SELECT') AS reads,
                     has_table_privilege('valo_workspace_scope', 'valo_consent_changes', 'INSERT') AS adds,
                     has_table_privilege('valo_workspace_scope', 'valo_consent_changes', 'UPDATE') AS changes,
                     has_table_privilege('valo_workspace_scope', 'valo_consent_changes', 'DELETE') AS removes`,
                )
              ).rows,
              [{ reads: true, adds: true, changes: false, removes: false }],
            );
          }),
      );
    /** A workspace for the hold checks, a synthetic test identity's unless it says otherwise. */
    const holdWorkspace = async (client, owner = `synthetic-migration-hold-${randomUUID()}`) => {
      const id = randomUUID();
      await client.query("INSERT INTO valo_workspaces(id,owner_identity_id) VALUES($1,$2)", [id, owner]);
      return id;
    };
    const placeHold = (client, workspaceId, reason = "Synthetic hold placed for the migration check.") =>
      client
        .query(
          "INSERT INTO valo_privacy_holds(workspace_id, reason, placed_by) VALUES($1,$2,$3) RETURNING id",
          [workspaceId, reason, "synthetic-migration-staff"],
        )
        .then((result) => result.rows[0].id);
    for (const tracked of [true, false])
      await t.test(
        `privacy holds migration keeps every row and adds an empty table of holds on workspaces, limited by row security and giving customer requests nothing (tracked=${tracked})`,
        async () =>
          cluster(async (client, directory) => {
            await applyThrough(client, directory, privacyHoldsMigration, tracked);
            await seed(client);
            const before = await assertRollsBack(client, privacyHoldsMigration);
            await applyFor(client, privacyHoldsMigration, tracked);
            if (!tracked) await raw(client, journalTagsFrom(privacyHoldsMigration).slice(1));
            assert.deepEqual(await rows(client), before);
            assert.deepEqual(await schema(client), finalSchema);
            assert.deepEqual(await rowSecurityGaps(client), []);
            assert.equal(
              (await client.query("SELECT count(*)::int AS n FROM valo_privacy_holds")).rows[0].n,
              0,
            );
            const workspaceId = await holdWorkspace(client);
            const id = await placeHold(client, workspaceId);
            // A reason of ten to a thousand characters, a release recorded whole or not at all, and a
            // workspace that exists.
            await assert.rejects(placeHold(client, workspaceId, "Too short"), /valo_privacy_hold_shape/);
            // At most one hold stands on a workspace at a time.
            await assert.rejects(placeHold(client, workspaceId), /valo_privacy_hold_standing/);
            await assert.rejects(
              client.query("UPDATE valo_privacy_holds SET released_at = now() WHERE id = $1", [id]),
              /valo_privacy_hold_shape/,
            );
            await assert.rejects(
              placeHold(client, randomUUID()),
              /valo_privacy_holds_workspace_id_valo_workspaces_id_fk/,
            );
            assert.deepEqual(
              (
                await client.query(
                  `SELECT relrowsecurity AS limited,
                     has_table_privilege('valo_workspace_scope', 'valo_privacy_holds', 'SELECT') AS reads,
                     has_table_privilege('valo_workspace_scope', 'valo_privacy_holds', 'INSERT') AS adds
                   FROM pg_class WHERE oid = 'public.valo_privacy_holds'::regclass`,
                )
              ).rows,
              [{ limited: true, reads: false, adds: false }],
            );
          }),
      );
    for (const tracked of [true, false])
      await t.test(
        `privacy hold guards migration keeps a hold for good, released once and never changed or removed, and tells a customer request only whether its own workspace is held (tracked=${tracked})`,
        async () =>
          cluster(async (client, directory) => {
            await applyThrough(client, directory, privacyHoldGuardsMigration, tracked);
            await seed(client);
            const before = await assertRollsBack(client, privacyHoldGuardsMigration);
            await applyFor(client, privacyHoldGuardsMigration, tracked);
            if (!tracked) await raw(client, journalTagsFrom(privacyHoldGuardsMigration).slice(1));
            assert.deepEqual(await rows(client), before);
            assert.deepEqual(await schema(client), finalSchema);
            assert.deepEqual(await rowSecurityGaps(client), []);
            // The held workspace's owner is not a synthetic test identity, as a real customer's is not.
            const held = await holdWorkspace(client, "operator-fixture-held"),
              open = await holdWorkspace(client);
            const id = await placeHold(client, held);
            const underHold = async (workspaceId) =>
              (await client.query("SELECT valo_workspace_under_hold($1) AS held", [workspaceId])).rows[0]
                .held;
            assert.equal(await underHold(held), true);
            assert.equal(await underHold(open), false);
            // Its reason, workspace and who placed it never change, and it is never removed or emptied.
            await assert.rejects(
              client.query(
                "UPDATE valo_privacy_holds SET reason = 'Synthetic reason changed afterwards.' WHERE id = $1",
                [id],
              ),
              /released once and never removed/,
            );
            await assert.rejects(
              client.query("DELETE FROM valo_privacy_holds WHERE id = $1", [id]),
              /released once and never removed/,
            );
            await assert.rejects(client.query("TRUNCATE valo_privacy_holds"));
            // A customer request learns only whether its own workspace is held, and never reads a hold.
            for (const [scope, asked, expected] of [
              [open, held, false],
              [held, held, true],
            ]) {
              await client.query("BEGIN");
              try {
                await enterWorkspaceScope(client, scope);
                assert.equal(await underHold(asked), expected);
                await assert.rejects(
                  client.query("SELECT reason FROM valo_privacy_holds"),
                  /permission denied/,
                );
              } finally {
                await client.query("ROLLBACK");
              }
            }
            // Released once, with who, when and why; then it changes no more.
            await client.query(
              "UPDATE valo_privacy_holds SET released_by = 'synthetic-migration-staff', released_at = now(), release_reason = 'Synthetic release for the migration check.' WHERE id = $1",
              [id],
            );
            assert.equal(await underHold(held), false);
            await assert.rejects(
              client.query(
                "UPDATE valo_privacy_holds SET release_reason = 'Synthetic release changed later.' WHERE id = $1",
                [id],
              ),
              /released once and never removed/,
            );
            // A synthetic test identity's workspace may be cleaned up with its holds.
            const synthetic = await placeHold(client, open);
            await client.query("DELETE FROM valo_privacy_holds WHERE id = $1", [synthetic]);
            // The holds keep their history digest through each write (ADM-009).
            assert.deepEqual(
              (
                await client.query(
                  "SELECT array_agg(name ORDER BY name) AS names FROM valo_history_digest_mismatches() AS name",
                )
              ).rows[0].names ?? [],
              [],
            );
            assert.deepEqual(
              (
                await client.query(
                  `SELECT has_function_privilege('valo_workspace_scope', 'valo_workspace_under_hold(uuid)', 'EXECUTE') AS scoped,
                     has_function_privilege('public', 'valo_workspace_under_hold(uuid)', 'EXECUTE') AS everyone`,
                )
              ).rows,
              [{ scoped: true, everyone: false }],
            );
          }),
      );
    /** One change in the alert journal, as the worker copies it (docs/architecture/alerts.md, part 1). */
    const recordAlert = (client, change = {}) => {
      const row = {
        id: randomUUID(),
        code: "EXPORTS_BACKLOG",
        state: "active",
        raised_at: new Date().toISOString(),
        reading: 101,
        threshold: 100,
        runbook: "Broken export / AI outage",
        accountable: "Engineering",
        ...change,
      };
      return client
        .query(
          `INSERT INTO valo_operational_alerts(id, code, state, raised_at, reading, threshold, runbook, accountable)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING RETURNING id`,
          [
            row.id,
            row.code,
            row.state,
            row.raised_at,
            row.reading,
            row.threshold,
            row.runbook,
            row.accountable,
          ],
        )
        .then((result) => ({ id: row.id, inserted: result.rowCount === 1 }));
    };
    for (const tracked of [true, false])
      await t.test(
        `operational alerts migration keeps every row and adds an empty journal of alerts, which customer requests cannot reach (tracked=${tracked})`,
        async () =>
          cluster(async (client, directory) => {
            await applyThrough(client, directory, operationalAlertsMigration, tracked);
            await seed(client);
            const before = await assertRollsBack(client, operationalAlertsMigration);
            await applyFor(client, operationalAlertsMigration, tracked);
            if (!tracked) await raw(client, journalTagsFrom(operationalAlertsMigration).slice(1));
            assert.deepEqual(await rows(client), before);
            assert.deepEqual(await schema(client), finalSchema);
            assert.deepEqual(await rowSecurityGaps(client), []);
            assert.equal(
              (await client.query("SELECT count(*)::int AS n FROM valo_operational_alerts")).rows[0].n,
              0,
            );
            assert.equal((await recordAlert(client)).inserted, true);
            // A code in the worker's own form, raised or cleared, and no reading or limit below nothing.
            await assert.rejects(
              recordAlert(client, { code: "exports backlog" }),
              /valo_operational_alerts_code_check/,
            );
            await assert.rejects(
              recordAlert(client, { state: "silenced" }),
              /valo_operational_alerts_state_check/,
            );
            await assert.rejects(
              recordAlert(client, { reading: -1 }),
              /valo_operational_alerts_reading_check/,
            );
            await assert.rejects(
              recordAlert(client, { threshold: -1 }),
              /valo_operational_alerts_reading_check/,
            );
            // A reading that could not be taken, and an alert with no runbook, are kept as they are.
            assert.equal(
              (await recordAlert(client, { reading: null, runbook: null, accountable: null })).inserted,
              true,
            );
            assert.deepEqual(
              (
                await client.query(
                  `SELECT has_table_privilege('valo_workspace_scope', 'valo_operational_alerts', 'SELECT') AS reads,
                     has_table_privilege('valo_workspace_scope', 'valo_operational_alerts', 'INSERT') AS adds`,
                )
              ).rows,
              [{ reads: false, adds: false }],
            );
          }),
      );
    for (const tracked of [true, false])
      await t.test(
        `operational alert guards migration keeps every alert as the worker wrote it, never changed, removed or emptied, with its history digest (tracked=${tracked})`,
        async () =>
          cluster(async (client, directory) => {
            await applyThrough(client, directory, operationalAlertGuardsMigration, tracked);
            await seed(client);
            const before = await assertRollsBack(client, operationalAlertGuardsMigration);
            await applyFor(client, operationalAlertGuardsMigration, tracked);
            if (!tracked) await raw(client, journalTagsFrom(operationalAlertGuardsMigration).slice(1));
            assert.deepEqual(await rows(client), before);
            assert.deepEqual(await schema(client), finalSchema);
            assert.deepEqual(await rowSecurityGaps(client), []);
            const raised = await recordAlert(client);
            await recordAlert(client, { state: "resolved", reading: 0 });
            // Copying a change again leaves the change the journal holds as it was.
            const again = await recordAlert(client, { id: raised.id, state: "resolved", reading: 0 });
            assert.equal(again.inserted, false);
            assert.deepEqual(
              (
                await client.query("SELECT state, reading FROM valo_operational_alerts WHERE id = $1", [
                  raised.id,
                ])
              ).rows,
              [{ state: "active", reading: 101 }],
            );
            await assert.rejects(
              client.query("UPDATE valo_operational_alerts SET state = 'resolved' WHERE id = $1", [
                raised.id,
              ]),
              /never changed or removed/,
            );
            await assert.rejects(
              client.query("DELETE FROM valo_operational_alerts WHERE id = $1", [raised.id]),
              /never changed or removed/,
            );
            await assert.rejects(client.query("TRUNCATE valo_operational_alerts"));
            assert.equal(
              (await client.query("SELECT count(*)::int AS n FROM valo_operational_alerts")).rows[0].n,
              2,
            );
            // The journal keeps its history digest through each write (ADM-009).
            assert.deepEqual(
              (
                await client.query(
                  "SELECT array_agg(name ORDER BY name) AS names FROM valo_history_digest_mismatches() AS name",
                )
              ).rows[0].names ?? [],
              [],
            );
            assert.deepEqual(
              (
                await client.query(
                  `SELECT has_function_privilege('public', 'valo_operational_alert_guard()', 'EXECUTE') AS everyone`,
                )
              ).rows,
              [{ everyone: false }],
            );
          }),
      );
    for (const tracked of [true, false])
      await t.test(
        `request minutes migration keeps every row and adds an empty table of the API's request counts, which refuses counts that do not hold together and customer requests cannot reach (tracked=${tracked})`,
        async () =>
          cluster(async (client, directory) => {
            await applyThrough(client, directory, requestMinutesMigration, tracked);
            await seed(client);
            const before = await assertRollsBack(client, requestMinutesMigration);
            await applyFor(client, requestMinutesMigration, tracked);
            if (!tracked) await raw(client, journalTagsFrom(requestMinutesMigration).slice(1));
            assert.deepEqual(await rows(client), before);
            assert.deepEqual(await schema(client), finalSchema);
            assert.deepEqual(await rowSecurityGaps(client), []);
            assert.equal(
              (await client.query("SELECT count(*)::int AS n FROM valo_request_minutes")).rows[0].n,
              0,
            );
            const minute = (at, requests, failures, within) =>
              client.query(
                `INSERT INTO valo_request_minutes (minute, requests, failures, within_100ms, within_250ms, within_500ms,
                   within_1s, within_2500ms, within_5s, within_10s) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
                [at, requests, failures, ...within],
              );
            await minute("2026-11-26T09:00:00Z", 10, 1, [2, 4, 6, 8, 9, 10, 10]);
            // A minute that adds a second process's counts to the first's.
            await client.query(
              `INSERT INTO valo_request_minutes (minute, requests, failures, within_100ms, within_250ms, within_500ms,
                 within_1s, within_2500ms, within_5s, within_10s) VALUES ('2026-11-26T09:00:00Z', 5, 0, 5, 5, 5, 5, 5, 5, 5)
               ON CONFLICT (minute) DO UPDATE SET requests = valo_request_minutes.requests + excluded.requests,
                 failures = valo_request_minutes.failures + excluded.failures,
                 within_100ms = valo_request_minutes.within_100ms + excluded.within_100ms,
                 within_250ms = valo_request_minutes.within_250ms + excluded.within_250ms,
                 within_500ms = valo_request_minutes.within_500ms + excluded.within_500ms,
                 within_1s = valo_request_minutes.within_1s + excluded.within_1s,
                 within_2500ms = valo_request_minutes.within_2500ms + excluded.within_2500ms,
                 within_5s = valo_request_minutes.within_5s + excluded.within_5s,
                 within_10s = valo_request_minutes.within_10s + excluded.within_10s`,
            );
            assert.deepEqual(
              (
                await client.query(
                  "SELECT requests, failures, within_100ms, within_10s FROM valo_request_minutes",
                )
              ).rows,
              [{ requests: 15, failures: 1, within_100ms: 7, within_10s: 15 }],
            );
            // Only whole minutes, no more failures than requests, and each count holding every shorter one.
            await assert.rejects(
              minute("2026-11-26T09:01:30Z", 1, 0, [1, 1, 1, 1, 1, 1, 1]),
              /valo_request_minutes_minute_check/,
            );
            await assert.rejects(
              minute("2026-11-26T09:02:00Z", 1, 2, [1, 1, 1, 1, 1, 1, 1]),
              /valo_request_minutes_counts_check/,
            );
            await assert.rejects(
              minute("2026-11-26T09:02:00Z", 3, 0, [3, 2, 3, 3, 3, 3, 3]),
              /valo_request_minutes_counts_check/,
            );
            await assert.rejects(
              minute("2026-11-26T09:02:00Z", 3, 0, [1, 1, 1, 1, 1, 1, 4]),
              /valo_request_minutes_counts_check/,
            );
            assert.deepEqual(
              (
                await client.query(
                  `SELECT has_table_privilege('valo_workspace_scope', 'valo_request_minutes', 'SELECT') AS reads,
                     has_table_privilege('valo_workspace_scope', 'valo_request_minutes', 'INSERT') AS adds`,
                )
              ).rows,
              [{ reads: false, adds: false }],
            );
          }),
      );
    for (const tracked of [true, false])
      await t.test(
        `security signal kinds migration keeps every signal and lets the table take a database guard's refusal, and no kind the API does not count (tracked=${tracked})`,
        async () =>
          cluster(async (client, directory) => {
            await applyThrough(client, directory, securitySignalKindsMigration, tracked);
            await seed(client);
            const signal = (kind, subject) =>
              client.query(
                `INSERT INTO valo_security_signals (kind, subject_hash, window_started_at, count, expires_at)
                 VALUES ($1, $2, date_trunc('minute', now()), 1, date_trunc('minute', now()) + interval '1 day')`,
                [kind, subject],
              );
            const signals = async () =>
              (
                await client.query(
                  "SELECT kind, subject_hash, window_started_at, count, expires_at FROM valo_security_signals ORDER BY kind, subject_hash",
                )
              ).rows;
            await signal("denied_access", "a".repeat(64));
            await signal("signature_failure", "b".repeat(64));
            // Before it, the table refused the kind the error handler counts a guard's refusal as.
            await assert.rejects(signal("guard_refusal", "c".repeat(64)), /valo_security_signals_kind_check/);
            const kept = await signals();
            const before = await assertRollsBack(client, securitySignalKindsMigration);
            await applyFor(client, securitySignalKindsMigration, tracked);
            if (!tracked) await raw(client, journalTagsFrom(securitySignalKindsMigration).slice(1));
            assert.deepEqual(await rows(client), before);
            assert.deepEqual(await signals(), kept);
            assert.deepEqual(await schema(client), finalSchema);
            assert.deepEqual(await rowSecurityGaps(client), []);
            await signal("guard_refusal", "c".repeat(64));
            assert.deepEqual(
              (await signals()).map((row) => row.kind),
              ["denied_access", "guard_refusal", "signature_failure"],
            );
            await assert.rejects(
              signal("synthetic_unknown", "d".repeat(64)),
              /valo_security_signals_kind_check/,
            );
            assert.deepEqual(
              (
                await client.query(
                  `SELECT has_table_privilege('valo_workspace_scope', 'valo_security_signals', 'SELECT') AS reads,
                     has_table_privilege('valo_workspace_scope', 'valo_security_signals', 'INSERT') AS adds`,
                )
              ).rows,
              [{ reads: false, adds: false }],
            );
          }),
      );
    for (const tracked of [true, false])
      await t.test(
        `security signal limits and input migration keeps every signal and lets the table take refusals by a limit and refused input (tracked=${tracked})`,
        async () =>
          cluster(async (client, directory) => {
            await applyThrough(client, directory, securitySignalLimitsMigration, tracked);
            await seed(client);
            const signal = (kind, subject) =>
              client.query(
                `INSERT INTO valo_security_signals (kind, subject_hash, window_started_at, count, expires_at)
                 VALUES ($1, $2, date_trunc('minute', now()), 1, date_trunc('minute', now()) + interval '1 day')`,
                [kind, subject],
              );
            const signals = async () =>
              (
                await client.query(
                  "SELECT kind, subject_hash, window_started_at, count, expires_at FROM valo_security_signals ORDER BY kind, subject_hash",
                )
              ).rows;
            await signal("denied_access", "a".repeat(64));
            await signal("signature_failure", "b".repeat(64));
            await signal("guard_refusal", "c".repeat(64));
            // Before it, the table refused the two kinds the API now counts.
            await assert.rejects(signal("limit_refusal", "d".repeat(64)), /valo_security_signals_kind_check/);
            await assert.rejects(signal("refused_input", "e".repeat(64)), /valo_security_signals_kind_check/);
            const kept = await signals();
            const before = await assertRollsBack(client, securitySignalLimitsMigration);
            await applyFor(client, securitySignalLimitsMigration, tracked);
            if (!tracked) await raw(client, journalTagsFrom(securitySignalLimitsMigration).slice(1));
            assert.deepEqual(await rows(client), before);
            assert.deepEqual(await signals(), kept);
            assert.deepEqual(await schema(client), finalSchema);
            assert.deepEqual(await rowSecurityGaps(client), []);
            await signal("limit_refusal", "d".repeat(64));
            await signal("refused_input", "e".repeat(64));
            assert.deepEqual(
              (await signals()).map((row) => row.kind),
              ["denied_access", "guard_refusal", "limit_refusal", "refused_input", "signature_failure"],
            );
            await assert.rejects(
              signal("synthetic_unknown", "f".repeat(64)),
              /valo_security_signals_kind_check/,
            );
            assert.deepEqual(
              (
                await client.query(
                  `SELECT has_table_privilege('valo_workspace_scope', 'valo_security_signals', 'SELECT') AS reads,
                     has_table_privilege('valo_workspace_scope', 'valo_security_signals', 'INSERT') AS adds`,
                )
              ).rows,
              [{ reads: false, adds: false }],
            );
          }),
      );
    for (const tracked of [true, false])
      await t.test(
        `drafter login migration keeps every version and lets content be added only by a session that logged in as the drafting login (tracked=${tracked})`,
        async () =>
          cluster(async (client, directory) => {
            await applyThrough(client, directory, drafterLoginMigration, tracked);
            await seed(client);
            const login = async () =>
              (
                await client.query(
                  "SELECT rolcanlogin,rolinherit,rolsuper,rolcreaterole,rolcreatedb,rolbypassrls,rolreplication FROM pg_roles WHERE rolname='valo_drafter_login'",
                )
              ).rows[0];
            const policy = `synthetic-drafter-login-${randomUUID()}`;
            await client.query(
              "INSERT INTO valo_publication_policies(id,hash,policy,authority) VALUES($1,'synthetic','{}','{}')",
              [policy],
            );
            const addVersion = `INSERT INTO valo_content_versions(id,template_id,version,slug,policy_id,candidate_hash,bundle,attestations,review_by)
              VALUES(gen_random_uuid(),$1,$2,$3,$1,'synthetic','{}','{}',now()+interval '30 days') RETURNING status`;
            const version = (number) => [policy, number, `${policy}-${number}`];
            const addPrepared = `INSERT INTO valo_prepared_candidates(artifact_id,artifact_hash,version_id,template_id,version,candidate_hash,prepared_at,review_by)
              VALUES(gen_random_uuid(),$2,gen_random_uuid(),$1,1,$3,now(),now()+interval '30 days') RETURNING version`;
            const asDrafterRole = async (statement, parameters) => {
              await client.query("BEGIN");
              try {
                await client.query("SET LOCAL ROLE valo_content_drafter_dev");
                const result = await client.query(statement, parameters);
                await client.query("COMMIT");
                return result.rows;
              } catch (error) {
                await client.query("ROLLBACK");
                throw error;
              }
            };
            // Before it, the cluster's owner added content as the drafter role, as the preparers did.
            assert.deepEqual(await asDrafterRole(addVersion, version(1)), [{ status: "candidate" }]);
            assert.deepEqual(await asDrafterRole(addPrepared, [policy, "a".repeat(64), "b".repeat(64)]), [
              { version: 1 },
            ]);
            const before = await assertRollsBack(client, drafterLoginMigration);
            assert.equal(await login(), undefined, "the interrupted migration created no login");
            await applyFor(client, drafterLoginMigration, tracked);
            if (!tracked) await raw(client, journalTagsFrom(drafterLoginMigration).slice(1));
            assert.deepEqual(await rows(client), before);
            assert.deepEqual(await schema(client), finalSchema);
            assert.deepEqual(await rowSecurityGaps(client), []);
            // The login is created unable to log in, inherits nothing, and may become the drafter role
            // and no other.
            assert.deepEqual(await login(), {
              rolcanlogin: false,
              rolinherit: false,
              rolsuper: false,
              rolcreaterole: false,
              rolcreatedb: false,
              rolbypassrls: false,
              rolreplication: false,
            });
            assert.deepEqual(
              (
                await client.query(
                  "SELECT r.rolname FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid JOIN pg_roles u ON u.oid=m.member WHERE u.rolname='valo_drafter_login'",
                )
              ).rows.map((row) => row.rolname),
              ["valo_content_drafter_dev"],
            );
            // This session logged in as the cluster's owner. It can no longer add a version or a
            // prepared candidate, as itself or as the drafter role.
            const refused = /added only by a session that logged in as valo_drafter_login/;
            await assert.rejects(client.query(addVersion, version(2)), refused);
            await assert.rejects(asDrafterRole(addVersion, version(2)), refused);
            await assert.rejects(
              asDrafterRole(addPrepared, [policy, "c".repeat(64), "d".repeat(64)]),
              refused,
            );
            // A session that logged in as the drafting login can, as the drafter role only.
            await client.query("ALTER ROLE valo_drafter_login LOGIN");
            const drafter = new pg.Client({
              host: "127.0.0.1",
              port: client.port,
              user: "valo_drafter_login",
              database: "postgres",
              connectionTimeoutMillis: 5000,
            });
            await drafter.connect();
            try {
              await assert.rejects(
                drafter.query(addVersion, version(2)),
                /permission denied for table valo_content_versions/,
              );
              await assert.rejects(
                drafter.query("SET ROLE valo_content_publisher_dev"),
                /permission denied to set role/,
              );
              await drafter.query("BEGIN");
              await drafter.query("SET LOCAL ROLE valo_content_drafter_dev");
              assert.deepEqual((await drafter.query(addVersion, version(2))).rows, [{ status: "candidate" }]);
              assert.deepEqual(
                (await drafter.query(addPrepared, [policy, "c".repeat(64), "d".repeat(64)])).rows,
                [{ version: 1 }],
              );
              // Not straight into published state, and no customer table.
              await drafter.query("SAVEPOINT attempt");
              await assert.rejects(
                drafter.query(
                  `INSERT INTO valo_content_versions(id,template_id,version,slug,policy_id,candidate_hash,bundle,attestations,status,review_by)
                   VALUES(gen_random_uuid(),$1,3,$2,$1,'synthetic','{}','{}','published',now()+interval '30 days')`,
                  [policy, `${policy}-3`],
                ),
                /Candidates cannot publish themselves/,
              );
              await drafter.query("ROLLBACK TO SAVEPOINT attempt");
              await assert.rejects(
                drafter.query("SELECT count(*) FROM valo_documents"),
                /permission denied for table valo_documents/,
              );
              // Rolled back: nothing it added here stays.
              await drafter.query("ROLLBACK");
            } finally {
              await drafter.end();
            }
            assert.deepEqual(await rows(client), before);
            // Holding a version takes content away, and stays open to the application's login.
            await client.query(
              "UPDATE valo_content_versions SET status='held' WHERE template_id=$1 AND version=1",
              [policy],
            );
            assert.equal(
              (await client.query("SELECT status FROM valo_content_versions WHERE template_id=$1", [policy]))
                .rows[0].status,
              "held",
            );
          }),
      );
    for (const tracked of [true, false])
      await t.test(
        `reviewer login migration keeps every attempt, records a review's attempt only from the review login and a drafting attempt only from the drafting login, and removes none (tracked=${tracked})`,
        async () =>
          cluster(async (client, directory) => {
            await applyThrough(client, directory, reviewerLoginMigration, tracked);
            await seed(client);
            const login = async () =>
              (
                await client.query(
                  "SELECT rolcanlogin,rolinherit,rolsuper,rolcreaterole,rolcreatedb,rolbypassrls,rolreplication FROM pg_roles WHERE rolname='valo_reviewer_login'",
                )
              ).rows[0];
            const attempts = async () =>
              (
                await client.query(
                  "SELECT to_jsonb(a) AS attempt FROM valo_publication_ai_attempts a ORDER BY id",
                )
              ).rows;
            const mismatched = async () => {
              // Counted in one snapshot, as the worker's hourly count is.
              await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
              try {
                return (
                  await client.query("SELECT name FROM valo_history_digest_mismatches() AS name")
                ).rows.map((row) => row.name);
              } finally {
                await client.query("COMMIT");
              }
            };
            const candidate = `synthetic-reviewer-login-${randomUUID()}`;
            const addReview = `INSERT INTO valo_publication_ai_attempts(candidate_hash,role,request_hash,request_meter,outcome)
              VALUES($1,$2,$3,'{}'::jsonb,'reserved') RETURNING id`;
            const addDraft =
              "INSERT INTO valo_publication_ai_attempts(candidate_hash,role) VALUES($1,'draft') RETURNING id";
            // Before it, the cluster's owner recorded both kinds of attempt, as review and drafting did.
            const reviewed = (await client.query(addReview, [candidate, "factual", "a".repeat(64)])).rows[0]
              .id;
            const drafted = (await client.query(addDraft, [candidate])).rows[0].id;
            const kept = await attempts();
            assert.equal(kept.length, 2);
            const before = await assertRollsBack(client, reviewerLoginMigration);
            assert.equal(await login(), undefined, "the interrupted migration created no login");
            assert.deepEqual(await attempts(), kept);
            await applyFor(client, reviewerLoginMigration, tracked);
            if (!tracked) await raw(client, journalTagsFrom(reviewerLoginMigration).slice(1));
            assert.deepEqual(await rows(client), before);
            assert.deepEqual(await attempts(), kept);
            assert.deepEqual(await schema(client), finalSchema);
            assert.deepEqual(await rowSecurityGaps(client), []);
            // The attempts are a history now: their digest starts from the two already held, and matches.
            assert.equal(
              Number(
                (
                  await client.query(
                    "SELECT sum(row_count) AS n FROM valo_history_digests WHERE table_name='valo_publication_ai_attempts'",
                  )
                ).rows[0].n,
              ),
              2,
            );
            assert.deepEqual(await mismatched(), []);
            // The login is created unable to log in, inherits nothing, and may become the reviewer role
            // and no other.
            assert.deepEqual(await login(), {
              rolcanlogin: false,
              rolinherit: false,
              rolsuper: false,
              rolcreaterole: false,
              rolcreatedb: false,
              rolbypassrls: false,
              rolreplication: false,
            });
            assert.deepEqual(
              (
                await client.query(
                  "SELECT r.rolname FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid JOIN pg_roles u ON u.oid=m.member WHERE u.rolname='valo_reviewer_login'",
                )
              ).rows.map((row) => row.rolname),
              ["valo_content_reviewer_dev"],
            );
            // This session logged in as the cluster's owner. It records no attempt, as itself or as
            // either service's role, changes none, removes none and cannot empty the table.
            const needsReviewer =
              /A review attempt is recorded only by a session that logged in as valo_reviewer_login/;
            const needsDrafter =
              /A drafting attempt is recorded only by a session that logged in as valo_drafter_login/;
            const asRole = async (role, statement, parameters) => {
              await client.query("BEGIN");
              try {
                await client.query(`SET LOCAL ROLE ${role}`);
                const result = await client.query(statement, parameters);
                await client.query("COMMIT");
                return result.rows;
              } catch (error) {
                await client.query("ROLLBACK");
                throw error;
              }
            };
            await assert.rejects(
              client.query(addReview, [candidate, "challenge", "b".repeat(64)]),
              needsReviewer,
            );
            await assert.rejects(
              asRole("valo_content_reviewer_dev", addReview, [candidate, "challenge", "b".repeat(64)]),
              needsReviewer,
            );
            await assert.rejects(client.query(addDraft, [candidate]), needsDrafter);
            await assert.rejects(asRole("valo_content_drafter_dev", addDraft, [candidate]), needsDrafter);
            const settle = "UPDATE valo_publication_ai_attempts SET outcome='completed' WHERE id=$1";
            await assert.rejects(client.query(settle, [reviewed]), needsReviewer);
            await assert.rejects(client.query(settle, [drafted]), needsDrafter);
            await assert.rejects(
              client.query("UPDATE valo_publication_ai_attempts SET role='challenge' WHERE id=$1", [
                reviewed,
              ]),
              /An AI attempt keeps its role/,
            );
            await assert.rejects(
              client.query("DELETE FROM valo_publication_ai_attempts WHERE id=$1", [reviewed]),
              /An AI attempt is never removed/,
            );
            await assert.rejects(
              client.query("TRUNCATE valo_publication_ai_attempts"),
              /Audit history cannot be truncated/,
            );
            await client.query("ALTER ROLE valo_reviewer_login LOGIN");
            await client.query("ALTER ROLE valo_drafter_login LOGIN");
            const connect = async (user) => {
              const session = new pg.Client({
                host: "127.0.0.1",
                port: client.port,
                user,
                database: "postgres",
                connectionTimeoutMillis: 5000,
              });
              await session.connect();
              return session;
            };
            const refusedIn = async (session, statement, parameters, message) => {
              await session.query("SAVEPOINT attempt");
              await assert.rejects(session.query(statement, parameters), message, statement);
              await session.query("ROLLBACK TO SAVEPOINT attempt");
            };
            const deniedOn = (table) => new RegExp(`permission denied for table ${table}`);
            // A session that logged in as the review login records a review's attempt and how it went,
            // as the reviewer role only.
            const reviewer = await connect("valo_reviewer_login");
            try {
              await assert.rejects(
                reviewer.query(addReview, [candidate, "challenge", "c".repeat(64)]),
                deniedOn("valo_publication_ai_attempts"),
              );
              for (const other of ["valo_content_drafter_dev", "valo_content_publisher_dev"])
                await assert.rejects(reviewer.query(`SET ROLE ${other}`), /permission denied to set role/);
              await reviewer.query("BEGIN");
              await reviewer.query("SET LOCAL ROLE valo_content_reviewer_dev");
              const id = (await reviewer.query(addReview, [candidate, "challenge", "c".repeat(64)])).rows[0]
                .id;
              await reviewer.query(
                "UPDATE valo_publication_ai_attempts SET outcome='response_received',provider_response_id='synthetic-response',input_tokens=1,output_tokens=1 WHERE id=$1",
                [id],
              );
              await reviewer.query(
                "UPDATE valo_publication_ai_attempts SET outcome='completed',completed_at=now() WHERE id=$1",
                [id],
              );
              // A review's attempt recorded before the migration settles too.
              await reviewer.query(
                "UPDATE valo_publication_ai_attempts SET outcome='failed',error_code='SYNTHETIC_FAILURE',completed_at=now() WHERE id=$1",
                [reviewed],
              );
              // Not a drafting attempt, no other column, no removal, and no customer table.
              await refusedIn(reviewer, addDraft, [candidate], needsDrafter);
              await refusedIn(reviewer, settle, [drafted], needsDrafter);
              await refusedIn(
                reviewer,
                "UPDATE valo_publication_ai_attempts SET candidate_hash='synthetic-other' WHERE id=$1",
                [id],
                deniedOn("valo_publication_ai_attempts"),
              );
              await refusedIn(
                reviewer,
                "DELETE FROM valo_publication_ai_attempts WHERE id=$1",
                [id],
                deniedOn("valo_publication_ai_attempts"),
              );
              await refusedIn(
                reviewer,
                "SELECT count(*) FROM valo_documents",
                [],
                deniedOn("valo_documents"),
              );
              // Rolled back: nothing it recorded here stays.
              await reviewer.query("ROLLBACK");
            } finally {
              await reviewer.end();
            }
            // A session that logged in as the drafting login records a drafting attempt, and no review's.
            const drafter = await connect("valo_drafter_login");
            try {
              await drafter.query("BEGIN");
              await drafter.query("SET LOCAL ROLE valo_content_drafter_dev");
              assert.ok((await drafter.query(addDraft, [candidate])).rows[0].id);
              await refusedIn(
                drafter,
                "INSERT INTO valo_publication_ai_attempts(candidate_hash,role) VALUES($1,'factual')",
                [candidate],
                needsReviewer,
              );
              await refusedIn(
                drafter,
                addReview,
                [candidate, "factual", "d".repeat(64)],
                deniedOn("valo_publication_ai_attempts"),
              );
              await refusedIn(drafter, settle, [drafted], deniedOn("valo_publication_ai_attempts"));
              await drafter.query("ROLLBACK");
            } finally {
              await drafter.end();
            }
            // Every attempt is as it was, and the digest still matches.
            assert.deepEqual(await attempts(), kept);
            assert.deepEqual(await mismatched(), []);
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
