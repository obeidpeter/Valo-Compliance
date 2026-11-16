import { createHash } from "node:crypto";
import { assertDevelopmentRuntime } from "./valo-development-runtime";

type Environment = Record<string, string | undefined>;
export type StorageScope = Readonly<{
  environment: "development" | "production";
  bucket: string;
  prefix: string;
  fingerprint: string;
}>;
const uuid = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
function fail(code: string): never {
  throw Object.assign(new Error(code), { code });
}
function root(value: string | undefined) {
  if (!value || value.length > 1024 || value.trim() !== value) fail("PRIVATE_STORAGE_UNCONFIGURED");
  const parts = value.replace(/^\/+|\/+$/g, "").split("/"),
    bucket = parts.shift()!;
  if (
    bucket.trim() !== bucket ||
    !/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(bucket) ||
    !parts.length ||
    parts.some((p) => !p || p.trim() !== p || p === "." || p === ".." || !/^[a-zA-Z0-9._-]+$/.test(p))
  )
    fail("PRIVATE_STORAGE_ROOT_INVALID");
  return { bucket, prefix: parts.join("/") };
}
function overlaps(a: ReturnType<typeof root>, b: ReturnType<typeof root>) {
  return (
    a.bucket === b.bucket &&
    (a.prefix === b.prefix || a.prefix.startsWith(b.prefix + "/") || b.prefix.startsWith(a.prefix + "/"))
  );
}
/** Explicit independent root; production never falls back to the development secret.
 * This configuration is not permission to activate customer routes or workers. */
export function privateStorageScope(
  environment: StorageScope["environment"],
  env: Environment = process.env,
): StorageScope {
  if (environment === "development") assertDevelopmentRuntime(env);
  else if (environment !== "production" || env.NODE_ENV !== "production")
    fail("PRODUCTION_STORAGE_CONTEXT_REQUIRED");
  const development = root(env.PRIVATE_OBJECT_DIR);
  const selected = environment === "development" ? development : root(env.VALO_PRODUCTION_PRIVATE_OBJECT_DIR);
  if (environment === "production" && overlaps(development, selected))
    fail("PRIVATE_STORAGE_ENVIRONMENTS_OVERLAP");
  const fingerprint = createHash("sha256")
    .update(JSON.stringify([environment, selected.bucket, selected.prefix]))
    .digest("hex");
  return Object.freeze({ environment, ...selected, fingerprint });
}
export function privateObjectName(scope: StorageScope, key: string) {
  if (
    key.trim() !== key ||
    !new RegExp(`^valo/${scope.environment}/${uuid}/${uuid}\\.(docx|pdf|json)$`).test(key)
  )
    fail("INVALID_PRIVATE_KEY");
  return `${scope.prefix}/${key}`;
}
/** Cleanup cannot address a customer key, even with a tampered run ID. */
export function storageProbeName(scope: StorageScope, runId: string) {
  if (scope.environment !== "production" || runId.length !== 36 || !new RegExp(`^${uuid}$`).test(runId))
    fail("INVALID_STORAGE_PROBE_SCOPE");
  return `${scope.prefix}/valo/production/readiness/${runId}/canary.bin`;
}
