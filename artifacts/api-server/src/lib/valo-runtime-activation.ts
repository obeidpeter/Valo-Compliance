import { createHash } from "node:crypto";
import { assertDevelopmentRuntime } from "./valo-development-runtime";
import { externalMonitorConfiguration } from "./valo-external-monitor";
import { productionPreflight } from "./valo-production-readiness";
import { privateStorageScope, privateObjectName } from "./valo-storage-scope";
import { environment, setting } from "../platform/settings";

type Environment = Record<string, string | undefined>;
type Query = (sql: string) => Promise<{ rows: Record<string, unknown>[] }>;
const profile = "private-rehearsal-v1";
let verifiedBinding: string | undefined;
const fail = (code: string): never => {
  throw Object.assign(Error(code), { code });
};
function binding(env: Environment) {
  return createHash("sha256")
    .update(
      JSON.stringify(
        // oxlint-disable-next-line typescript/require-array-sort-compare -- entries sort by their unique keys; this order is part of the fingerprint
        Object.entries(env)
          .filter(([k]) => /^(NODE_ENV|DATABASE_URL|PRIVATE_OBJECT_DIR|VALO_|REPLIT_DEPLOYMENT)/.test(k))
          .sort(),
      ),
    )
    .digest("hex");
}
/** A rehearsal can run the real export worker; it cannot open customer HTTP traffic.
 * Development flags, an arbitrary NODE_ENV or storage canary cannot activate it. */
export function rehearsalConfiguration(env: Environment) {
  if (
    !productionPreflight(env).configurationValid ||
    env.VALO_RUNTIME_ACTIVATION !== profile ||
    !/^[1-9][0-9]{0,4}$/.test(env.PORT ?? "") ||
    Number(env.PORT) > 65535 ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      env.VALO_PRODUCTION_DATABASE_ID ?? "",
    ) ||
    env.VALO_EXTERNAL_MONITORING !== "healthchecks" ||
    !env.VALO_WORKER_MONITOR_URL ||
    !env.VALO_OPERATIONS_MONITOR_URL ||
    // Without trusted proxy ranges every anonymous client behind the ingress shares one quota.
    !env.VALO_TRUSTED_PROXY_CIDRS?.trim()
  )
    fail("PRODUCTION_REHEARSAL_CONFIGURATION_REQUIRED");
  for (const name of [
    "VALO_CUSTOMER_AI_ENABLED",
    "VALO_SANDBOX_CHECKOUT_ENABLED",
    "VALO_SANDBOX_REFUNDS_ENABLED",
    "VALO_SANDBOX_DISPUTES_ENABLED",
  ])
    if (env[name] !== "false") fail("PRODUCTION_REHEARSAL_EFFECTS_MUST_BE_DISABLED");
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) fail("PRODUCTION_SIGNING_KEY_REQUIRED");
  externalMonitorConfiguration(env);
  if (env.VALO_ISOLATED_RECOVERY) fail("RECOVERY_CANNOT_ACTIVATE_PRODUCTION");
  return {
    profile,
    databaseId: env.VALO_PRODUCTION_DATABASE_ID,
    storageFingerprint: privateStorageScope("production", env).fingerprint,
  };
}
/** Read-only. The marker is assigned once by a separately reviewed fresh-DB bootstrap.
 * Restoring/copying development retains its development marker and is rejected. */
export async function verifyRehearsalDatabase(query: Query, env: Environment) {
  const config = rehearsalConfiguration(env);
  const marker = await query(
    "SELECT instance_id,environment,storage_fingerprint FROM valo_runtime_identity WHERE singleton=true",
  );
  if (
    marker.rows.length !== 1 ||
    marker.rows[0]?.instance_id !== config.databaseId ||
    marker.rows[0]?.environment !== "production-rehearsal" ||
    marker.rows[0]?.storage_fingerprint !== config.storageFingerprint
  )
    fail("PRODUCTION_DATABASE_IDENTITY_MISMATCH");
  const unsafe =
    await query(`SELECT EXISTS(SELECT 1 FROM valo_workspaces WHERE owner_identity_id NOT LIKE 'synthetic-production-%')
    OR EXISTS(SELECT 1 FROM valo_orders) OR EXISTS(SELECT 1 FROM valo_privacy_tombstones)
    OR EXISTS(SELECT 1 FROM valo_privacy_cases WHERE kind='deletion') AS unsafe`);
  if (unsafe.rows.length !== 1 || unsafe.rows[0]?.unsafe !== false)
    fail("PRODUCTION_REHEARSAL_REQUIRES_FIXTURE_ONLY_DATABASE");
  const version = await query("SELECT version FROM valo_jobs.version");
  if (version.rows.length !== 1 || version.rows[0]?.version !== 46) fail("PRODUCTION_QUEUE_VERSION_MISMATCH");
  const queues = await query(
    "SELECT name,policy,retry_limit,expire_seconds FROM valo_jobs.queue WHERE name IN ('valo-manual-export-v1','valo-workspace-data-v1')",
  );
  if (
    queues.rows.length !== 2 ||
    !queues.rows.some(
      (q) =>
        q.name === "valo-manual-export-v1" &&
        q.policy === "standard" &&
        q.retry_limit === 2 &&
        q.expire_seconds === 120,
    ) ||
    !queues.rows.some(
      (q) =>
        q.name === "valo-workspace-data-v1" &&
        q.policy === "standard" &&
        q.retry_limit === 0 &&
        q.expire_seconds === 360,
    )
  )
    fail("PRODUCTION_QUEUE_PREFLIGHT_FAILED");
  return {
    databaseBound: true,
    fixtureOnly: true,
    queuesVerified: true,
    launchReady: false,
    customerTrafficEnabled: false,
  };
}
export async function initializeApplicationRuntime() {
  if (setting("NODE_ENV") !== "production") {
    assertDevelopmentRuntime();
    return;
  }
  rehearsalConfiguration(environment()); // Fail before connecting if configuration is incomplete.
  const { Client } = await import("pg");
  const client = new Client({
    connectionString: setting("DATABASE_URL"),
    connectionTimeoutMillis: 5000,
    query_timeout: 5000,
  });
  try {
    await client.connect();
    await client.query("BEGIN READ ONLY");
    await verifyRehearsalDatabase((sql) => client.query(sql), environment());
    await client.query("ROLLBACK");
    verifiedBinding = binding(environment());
  } catch (error) {
    const code = (error as { code?: string }).code;
    fail(code?.startsWith("PRODUCTION_") ? code : "PRODUCTION_DATABASE_PREFLIGHT_FAILED");
  } finally {
    await client.end();
  }
}
export function assertApplicationRuntime() {
  if (setting("NODE_ENV") !== "production") {
    assertDevelopmentRuntime();
    return;
  }
  rehearsalConfiguration(environment());
  if (!verifiedBinding || verifiedBinding !== binding(environment())) fail("PRODUCTION_RUNTIME_NOT_VERIFIED");
}
export function runtimeEnvironment(): "development" | "production" {
  assertApplicationRuntime();
  return setting("NODE_ENV") === "production" ? "production" : "development";
}
export function runtimePrivateScope() {
  return privateStorageScope(runtimeEnvironment());
}
export function assertRuntimeObjectScope(workspaceId: string, key: string) {
  const environment = runtimeEnvironment();
  privateObjectName({ environment, bucket: "scope-check", prefix: "private", fingerprint: "" }, key);
  if (key.split("/")[2] !== workspaceId) fail("PRIVATE_OBJECT_WORKSPACE_MISMATCH");
}
