import { randomUUID } from "node:crypto";
import { Client } from "@replit/object-storage";
import { privateStorageScope, storageProbeName } from "../lib/valo-storage-scope";
import { runStorageProbe } from "../lib/valo-storage-probe";
import { setting } from "../platform/settings";

// This opt-in operator command only addresses a separate synthetic canary prefix.
// No production route or background worker invokes it automatically.
let deadline: ReturnType<typeof setTimeout> | undefined;
const configurationCodes = new Set([
  "EXPLICIT_STORAGE_PROBE_REQUIRED",
  "STORAGE_PROBE_ARGUMENTS_INVALID",
  "PRIVATE_STORAGE_UNCONFIGURED",
  "PRIVATE_STORAGE_ROOT_INVALID",
  "PRIVATE_STORAGE_ENVIRONMENTS_OVERLAP",
  "PRODUCTION_STORAGE_CONTEXT_REQUIRED",
  "INVALID_STORAGE_PROBE_SCOPE",
]);
try {
  if (setting("VALO_PRODUCTION_STORAGE_PROBE") !== "synthetic-canary-only")
    throw Error("EXPLICIT_STORAGE_PROBE_REQUIRED");
  const [action, id, ...extra] = process.argv.slice(2);
  if (
    extra.length ||
    (action !== "--start" && action !== "--cleanup") ||
    (action === "--start" && id) ||
    (action === "--cleanup" && !id)
  )
    throw Error("STORAGE_PROBE_ARGUMENTS_INVALID");
  const scope = privateStorageScope("production"),
    runId = action === "--start" ? randomUUID() : id!;
  storageProbeName(scope, runId);
  // Preserve this scoped recovery reference even if the process/provider stalls.
  console.log(
    JSON.stringify({
      event: "storage_probe.reserved",
      runId,
      storageFingerprint: scope.fingerprint,
      cleanupConfirmed: false,
    }),
  );
  deadline = setTimeout(() => {
    console.error("STORAGE_PROBE_DEADLINE_CLEANUP_REQUIRED");
    process.exit(1);
  }, 90_000);
  const report = await runStorageProbe(
    scope,
    runId,
    action === "--start" ? "start" : "cleanup",
    new Client({ bucketId: scope.bucket }),
    async (bucket, name) => {
      const response = await fetch(
        `https://storage.googleapis.com/${encodeURIComponent(bucket)}/${name.split("/").map(encodeURIComponent).join("/")}`,
        { redirect: "manual", signal: AbortSignal.timeout(10_000) },
      );
      await response.body?.cancel();
      return response.status;
    },
  );
  console.log(JSON.stringify(report));
  if (!report.passed) process.exitCode = 1;
} catch (e) {
  console.error(e instanceof Error && configurationCodes.has(e.message) ? e.message : "STORAGE_PROBE_FAILED");
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
}
