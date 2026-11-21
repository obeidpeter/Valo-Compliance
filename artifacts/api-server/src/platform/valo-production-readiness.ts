import { privateStorageScope } from "./valo-storage-scope";
/** Configuration inspection only: no SDK, database, network or process effects. */
export function productionPreflight(env: Record<string, string | undefined>) {
  const failures: string[] = [];
  let storageFingerprint: string | null = null;
  const check = (ok: boolean, code: string) => {
    if (!ok) failures.push(code);
  };
  check(env.NODE_ENV === "production", "PRODUCTION_NODE_ENV_REQUIRED");
  try {
    storageFingerprint = privateStorageScope("production", env).fingerprint;
  } catch (e) {
    failures.push((e as { code?: string }).code ?? "PRIVATE_STORAGE_CONFIGURATION_INVALID");
  }
  check(env.VALO_WORKER_TOPOLOGY === "replit-reserved-vm-same-app", "ALWAYS_ON_SAME_APP_WORKER_REQUIRED");
  check(env.VALO_WORKER_REPLICAS === "1", "SINGLE_WORKER_SUPERVISION_REQUIRED");
  check(
    env.VALO_RELEASE_SHA?.length === 40 && /^[a-f0-9]{40}$/.test(env.VALO_RELEASE_SHA),
    "PINNED_RELEASE_REQUIRED",
  );
  const port = env.VALO_WORKER_HEALTH_PORT ?? "";
  check(
    port.trim() === port &&
      /^[1-9][0-9]{0,4}$/.test(port) &&
      Number(port) <= 65535 &&
      port !== env.PORT &&
      port !== env.VALO_FRONTEND_PORT,
    "DEDICATED_WORKER_HEALTH_PORT_REQUIRED",
  );
  // NODE_ENV, hosting variables and a passing canary never grant launch approval.
  return {
    version: 1,
    configurationValid: failures.length === 0,
    configurationFailures: [...new Set(failures)],
    storageFingerprint,
    launchReady: false,
    customerExportsEnabled: false,
    workerActivationEnabled: false,
    requiredEvidence: [
      "DEPLOYED_PRIVATE_STORAGE_CANARY",
      "SUPERVISED_WORKER_RESTART_AND_DRAIN",
      "PRODUCTION_DATABASE_AND_QUEUE_PREFLIGHT",
      "EXTERNAL_ALERT_DELIVERY",
      "DEPLOYED_RESTORE_AND_ERASURE_REPLAY",
      "RETENTION_POLICY_AND_RELEASE_APPROVAL",
    ],
    scope: "configuration-only; no infrastructure was contacted or changed",
  };
}
