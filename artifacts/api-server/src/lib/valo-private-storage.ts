import { createHash } from "node:crypto";
import { Client } from "@replit/object-storage";
export const fileChecksum = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
export function privateStorageObject(key: string) {
  if (!/^valo\/development\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(docx|pdf|json)$/.test(key))
    throw new Error("INVALID_PRIVATE_KEY");
  const root = process.env.PRIVATE_OBJECT_DIR;
  if (!root) throw new Error("PRIVATE_STORAGE_UNCONFIGURED");
  const [bucket,...parts] = root.replace(/^\/+|\/+$/g,"").split("/");
  if (!bucket || !parts.length) throw new Error("PRIVATE_STORAGE_UNCONFIGURED");
  return { client:new Client({bucketId:bucket}),bucket,name:`${parts.join("/")}/${key}` };
}
const object=privateStorageObject;
/** Callers mint a fresh cryptographic object ID for every attempt, including crash retries.
 * The native SDK has no conditional-create primitive. Never reuse or overwrite a key.
 * Source/render hashes live in the immutable-revision/job/file relational chain.
 */
export async function writePrivateFile(key: string,bytes: Buffer,onUploading?:()=>Promise<void>) {
  const {client,name} = object(key);
  const exists = await client.exists(name);
  if (!exists.ok) throw new Error("PRIVATE_STORAGE_CHECK_FAILED");
  if (exists.value) throw new Error("PRIVATE_FILE_KEY_ALREADY_WRITTEN");
  const uploading = client.uploadFromBytes(name,bytes,{compress:false});
  if(onUploading)await onUploading();
  const uploaded = await uploading;
  if (!uploaded.ok) throw new Error("PRIVATE_STORAGE_WRITE_FAILED");
  const read = await client.downloadAsBytes(name);
  if (!read.ok) throw new Error("PRIVATE_STORAGE_READ_FAILED");
  const stored = read.value[0];
  const checksum = fileChecksum(bytes);
  if (fileChecksum(stored) !== checksum) throw new Error("PRIVATE_FILE_CHECKSUM_MISMATCH");
  return {checksum,size:stored.length};
}
export async function readPrivateFile(key: string,checksum: string) {
  const {client,name} = object(key);
  const read = await client.downloadAsBytes(name);
  if (!read.ok) throw new Error("PRIVATE_STORAGE_READ_FAILED");
  const bytes = read.value[0];
  if (bytes.length > 10*1024*1024 || fileChecksum(bytes) !== checksum)
    throw new Error("PRIVATE_FILE_CHECKSUM_MISMATCH");
  return bytes;
}
export async function deletePrivateFile(key: string) {
  const {client,name} = object(key);
  const result = await client.delete(name,{ignoreNotFound:true});
  if (!result.ok) throw new Error("PRIVATE_STORAGE_DELETE_FAILED");
}
/** Compatibility probe only: never returns the bucket/object locator. */
export async function anonymousPrivateFileStatus(key: string) {
  const {bucket,name} = object(key);
  const response = await fetch(`https://storage.googleapis.com/${encodeURIComponent(bucket)}/${name.split("/").map(encodeURIComponent).join("/")}`,
    {signal:AbortSignal.timeout(10000)});
  await response.body?.cancel();
  return response.status;
}
