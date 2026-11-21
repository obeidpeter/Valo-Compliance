/** Disposable LOCAL empty PostgreSQL compatibility check. Not a backup/restore
 * system, managed database copy, production migration, or scheduled operation. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const exec = promisify(execFile),
  root = fileURLToPath(new URL("../../../../", import.meta.url));
if (
  process.env.NODE_ENV !== "development" ||
  process.env.REPLIT_DEPLOYMENT ||
  process.env.VALO_CLEAN_MIGRATION_PROOF !== "synthetic-development-only"
)
  throw Error("EXPLICIT_LOCAL_SYNTHETIC_PROOF_REQUIRED");
const directory = await mkdtemp(join(tmpdir(), "valo-clean-migrations-")),
  data = join(directory, "data");
const username = userInfo().username;
if (!/^[a-z_][a-z0-9_-]*$/.test(username)) throw Error("LOCAL_USER_NAME_UNSUPPORTED");
const env = {
  ...process.env,
  PGHOST: directory,
  PGPORT: "5432",
  PGUSER: username,
  PGDATABASE: "postgres",
  PGPASSWORD: "",
  DATABASE_URL: `postgresql://${username}@localhost/postgres?host=${encodeURIComponent(directory)}`,
};
let started = false;
const report: { [key: string]: unknown } = {
  executedAt: new Date().toISOString(),
  scope: "Empty local PostgreSQL only; no managed DB copy or restore",
  productionApplied: false,
  managedDevelopmentSchemaChanged: false,
};
try {
  await exec("initdb", ["-D", data, "--auth=trust", "--no-locale"], { env, maxBuffer: 1_000_000 });
  await exec(
    "pg_ctl",
    ["-D", data, "-l", join(directory, "postgres.log"), "-o", `-k ${directory} -h '' -p 5432`, "-w", "start"],
    { env },
  );
  started = true;
  const migration = await exec(
    "pnpm",
    ["--filter", "@workspace/db", "exec", "drizzle-kit", "migrate", "--config", "./drizzle.config.ts"],
    { env, cwd: root, maxBuffer: 1_000_000 },
  );
  report.migrationOutput = migration.stdout;
  report.migrationsPassed = true;
  const invariants = await exec(
    "psql",
    [
      "-X",
      "-A",
      "-t",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      `
    SELECT json_build_object(
      'orderTable',to_regclass('public.valo_orders') IS NOT NULL,
      'receiptOutbox',to_regclass('public.valo_purchase_outbox') IS NOT NULL,
      'dailyReconciliation',to_regclass('public.valo_payment_reconciliations') IS NOT NULL,
      'editorialRequestMeter',EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public'
        AND table_name='valo_publication_ai_attempts' AND column_name='request_meter'),
      'durableReminderLease',EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public'
        AND table_name='valo_reminder_outbox' AND column_name='lease_token'),
      'firstReminderAttempt',EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public'
        AND table_name='valo_reminder_outbox' AND column_name='first_attempt_at'),
      'refundAmount',EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public'
        AND table_name='valo_refund_requests' AND column_name='amount_kobo'),
      'refundRequestUniqueness',to_regclass('public.valo_refund_request_key_unique') IS NOT NULL,
      'financialHistoryImmutable',EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='valo_refund_transition_immutable' AND NOT tgisinternal),
      'publisherCannotRefund',NOT has_table_privilege('valo_content_publisher_dev','valo_refund_requests','INSERT'),
      'journalledMigrations',(SELECT count(*) FROM drizzle.__drizzle_migrations),
      'noSeedOrders',(SELECT count(*)=0 FROM valo_orders),
      'noSeedPrices',(SELECT count(*)=0 FROM valo_prices),
      'tenantForeignKeys',(SELECT count(*) FROM pg_constraint WHERE conname IN
        ('valo_entitlement_order_tenant_fk','valo_purchase_outbox_order_tenant_fk','valo_refund_order_tenant_fk','valo_reconciliation_order_tenant_fk')),
      'publisherCannotReadOrders',NOT has_table_privilege('valo_content_publisher_dev','valo_orders','SELECT'),
      'publisherCannotWriteOrders',NOT has_table_privilege('valo_content_publisher_dev','valo_orders','INSERT'),
      'publisherCannotWritePrices',NOT has_table_privilege('valo_content_publisher_dev','valo_prices','UPDATE')
    );`,
    ],
    { env, maxBuffer: 1_000_000 },
  );
  const checked = JSON.parse(invariants.stdout.trim());
  if (
    !checked.orderTable ||
    !checked.receiptOutbox ||
    !checked.dailyReconciliation ||
    !checked.noSeedOrders ||
    !checked.noSeedPrices ||
    checked.tenantForeignKeys !== 4 ||
    !checked.publisherCannotReadOrders ||
    !checked.publisherCannotWriteOrders ||
    !checked.publisherCannotWritePrices ||
    !checked.editorialRequestMeter ||
    !checked.durableReminderLease ||
    !checked.firstReminderAttempt ||
    !checked.refundAmount ||
    !checked.refundRequestUniqueness ||
    !checked.financialHistoryImmutable ||
    !checked.publisherCannotRefund ||
    checked.journalledMigrations < 17
  )
    throw Error("CLEAN_MIGRATION_INVARIANT_FAILED");
  report.invariants = checked;
  report.disasterRecoveryProved = false;
  report.productionCompatibilityProved = false;
} catch (error) {
  report.failed = true;
  report.failure =
    error instanceof Error ? error.message.split("\n")[0]!.slice(0, 200) : "LOCAL_PROOF_FAILED";
  process.exitCode = 1;
} finally {
  if (started)
    await exec("pg_ctl", ["-D", data, "-w", "stop", "-m", "immediate"], { env }).catch(() => {
      report.cleanupFailed = true;
      process.exitCode = 1;
    });
  await rm(directory, { recursive: true, force: true });
  report.localTemporaryClusterRemoved = true;
  await writeFile(
    resolve(root, "generated-artifacts/valo-commerce/clean-migrations.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
}
