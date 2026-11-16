import { runtimePrivateScope } from "./valo-runtime-activation";
import { createHash } from "node:crypto";
import { Client } from "@replit/object-storage";
import { privateStorageScope, privateObjectName, type StorageScope } from "./valo-storage-scope";
export const fileChecksum = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
function object(key: string, scope = runtimePrivateScope()) {
  const name = privateObjectName(scope, key);
  return { client: new Client({ bucketId: scope.bucket }), bucket: scope.bucket, name };
}
/** Callers mint a fresh cryptographic object ID for every attempt, including crash retries.
 * The native SDK has no conditional-create primitive. Never reuse or overwrite a key.
 * Source/render hashes live in the immutable-revision/job/file relational chain.
 */
async function write(scope: StorageScope, key: string, bytes: Buffer, onUploading?: () => Promise<void>) {
  const { client, name } = object(key, scope);
  const exists = await client.exists(name);
  if (!exists.ok) throw new Error("PRIVATE_STORAGE_CHECK_FAILED");
  if (exists.value) throw new Error("PRIVATE_FILE_KEY_ALREADY_WRITTEN");
  const uploading = client.uploadFromBytes(name, bytes, { compress: false });
  if (onUploading) await onUploading();
  const uploaded = await uploading;
  if (!uploaded.ok) throw new Error("PRIVATE_STORAGE_WRITE_FAILED");
  const read = await client.downloadAsBytes(name);
  if (!read.ok) throw new Error("PRIVATE_STORAGE_READ_FAILED");
  const stored = read.value[0];
  const checksum = fileChecksum(bytes);
  if (fileChecksum(stored) !== checksum) throw new Error("PRIVATE_FILE_CHECKSUM_MISMATCH");
  return { checksum, size: stored.length };
}
async function read(scope: StorageScope, key: string, checksum: string) {
  const { client, name } = object(key, scope);
  const read = await client.downloadAsBytes(name);
  if (!read.ok) throw new Error("PRIVATE_STORAGE_READ_FAILED");
  const bytes = read.value[0];
  if (bytes.length > 10 * 1024 * 1024 || fileChecksum(bytes) !== checksum)
    throw new Error("PRIVATE_FILE_CHECKSUM_MISMATCH");
  return bytes;
}
async function remove(scope: StorageScope, key: string) {
  const { client, name } = object(key, scope);
  const result = await client.delete(name, { ignoreNotFound: true });
  if (!result.ok) throw new Error("PRIVATE_STORAGE_DELETE_FAILED");
}
/** Server-owned candidate adapter. Existing customer exports remain development-only. */
export function productionPrivateStorage(env: Record<string, string | undefined> = process.env) {
  const scope = privateStorageScope("production", env);
  return Object.freeze({
    scopeFingerprint: scope.fingerprint,
    write: (key: string, bytes: Buffer) => write(scope, key, bytes),
    read: (key: string, checksum: string) => read(scope, key, checksum),
    remove: (key: string) => remove(scope, key),
  });
}
export const writePrivateFile = (key: string, bytes: Buffer, onUploading?: () => Promise<void>) =>
  write(runtimePrivateScope(), key, bytes, onUploading);
export const readPrivateFile = (key: string, checksum: string) => read(runtimePrivateScope(), key, checksum);
export const deletePrivateFile = (key: string) => remove(runtimePrivateScope(), key);
/** Compatibility probe only: never returns the bucket/object locator. */
export async function anonymousPrivateFileStatus(key: string) {
  const { bucket, name } = object(key);
  const response = await fetch(
    `https://storage.googleapis.com/${encodeURIComponent(bucket)}/${name.split("/").map(encodeURIComponent).join("/")}`,
    { signal: AbortSignal.timeout(10000) },
  );
  await response.body?.cancel();
  return response.status;
}
export function privateWorkspaceObject(key: string) {
  if (!key.endsWith(".json")) throw Error("WORKSPACE_JSON_REQUIRED");
  return object(key);
}
