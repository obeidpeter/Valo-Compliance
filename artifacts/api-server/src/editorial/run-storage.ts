import { createHash } from "node:crypto";
import { Client } from "@replit/object-storage";
import { setting } from "../platform/settings";
export const hashEditorial = (value: string) => createHash("sha256").update(value).digest("hex");
function object(id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw Error("EDITORIAL_STORAGE_INVALID_ID");
  const root = setting("PRIVATE_OBJECT_DIR");
  if (!root) throw Error("EDITORIAL_STORAGE_UNCONFIGURED");
  const [bucket, ...parts] = root.replace(/^\/+|\/+$/g, "").split("/");
  if (!bucket || !parts.length) throw Error("EDITORIAL_STORAGE_UNCONFIGURED");
  const key = `valo/editorial/development/runs/${id}.json`;
  return { client: new Client({ bucketId: bucket }), name: `${parts.join("/")}/${key}`, key, bucket };
}
export async function storeEditorialRun(id: string, artifact: unknown) {
  const bytes = Buffer.from(JSON.stringify(artifact));
  if (bytes.length > 256 * 1024) throw Error("EDITORIAL_STORAGE_TOO_LARGE");
  const { client, name, key } = object(id);
  const exists = await client.exists(name);
  if (!exists.ok || exists.value) throw Error("EDITORIAL_STORAGE_KEY_UNAVAILABLE");
  if (!(await client.uploadFromBytes(name, bytes, { compress: false })).ok)
    throw Error("EDITORIAL_STORAGE_WRITE_FAILED");
  const check = await client.downloadAsBytes(name);
  if (!check.ok || hashEditorial(check.value[0].toString()) !== hashEditorial(bytes.toString()))
    throw Error("EDITORIAL_STORAGE_CHECKSUM_FAILED");
  return { key, hash: hashEditorial(bytes.toString()) };
}
export async function readEditorialRun(id: string, expectedHash: string) {
  const { client, name } = object(id),
    r = await client.downloadAsBytes(name);
  if (!r.ok || r.value[0].length > 256 * 1024 || hashEditorial(r.value[0].toString()) !== expectedHash)
    throw Error("EDITORIAL_STORAGE_CHECKSUM_FAILED");
  return JSON.parse(r.value[0].toString()) as Record<string, unknown>;
}
export async function probeEditorialPrivate(id: string, expectedHash: string) {
  await readEditorialRun(id, expectedHash);
  const { bucket, name } = object(id);
  const r = await fetch(
    `https://storage.googleapis.com/${encodeURIComponent(bucket)}/${name.split("/").map(encodeURIComponent).join("/")}`,
    { signal: AbortSignal.timeout(10000) },
  );
  await r.body?.cancel();
  return { authorizedChecksumMatched: true, anonymousStatus: r.status };
}
