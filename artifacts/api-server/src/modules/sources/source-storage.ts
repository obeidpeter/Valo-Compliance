import { createHash } from "node:crypto";
import { Client } from "@replit/object-storage";
import { setting } from "../../platform/settings";
import { anonymousObjectStatus } from "../../platform/anonymous-object";
const checksum = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
function sourceObject(snapshotId: string, kind: "raw" | "text") {
  if (!/^[a-f0-9-]{36}$/.test(snapshotId)) throw Error("SOURCE_STORAGE_INVALID_ID");
  if (kind !== "raw" && kind !== "text") throw Error("SOURCE_STORAGE_INVALID_KIND");
  const root = setting("PRIVATE_OBJECT_DIR");
  if (!root) throw Error("SOURCE_STORAGE_UNCONFIGURED");
  const [bucket, ...parts] = root.replace(/^\/+|\/+$/g, "").split("/");
  if (!bucket || !parts.length) throw Error("SOURCE_STORAGE_UNCONFIGURED");
  const key = `valo/editorial/development/${snapshotId}/source.${kind}`;
  const client = new Client({ bucketId: bucket }),
    name = `${parts.join("/")}/${key}`;
  return { client, name, key, bucket };
}
/** Dedicated namespace: cannot accept document keys or expose source bytes publicly. */
export async function storeSourceSnapshot(
  snapshotId: string,
  kind: "raw" | "text",
  bytes: Buffer,
  maximumBytes = 8 * 1024 * 1024,
) {
  if (
    ![8 * 1024 * 1024, 32 * 1024 * 1024].includes(maximumBytes) ||
    bytes.length > maximumBytes ||
    (kind === "text" && bytes.length > 8 * 1024 * 1024)
  )
    throw Error("SOURCE_STORAGE_TOO_LARGE");
  const { client, name, key } = sourceObject(snapshotId, kind);
  const existing = await client.exists(name);
  if (!existing.ok || existing.value) throw Error("SOURCE_STORAGE_KEY_UNAVAILABLE");
  const result = await client.uploadFromBytes(name, bytes, { compress: false });
  if (!result.ok) throw Error("SOURCE_STORAGE_WRITE_FAILED");
  const check = await client.downloadAsBytes(name);
  if (!check.ok || checksum(check.value[0]) !== checksum(bytes))
    throw Error("SOURCE_STORAGE_CHECKSUM_FAILED");
  return { key, checksum: checksum(bytes) };
}
/** Operator proof only; returns no bucket, object locator or source body. */
export async function probePrivateSource(snapshotId: string, kind: "raw" | "text", expectedChecksum: string) {
  const { client, name, bucket } = sourceObject(snapshotId, kind);
  const stored = await client.downloadAsBytes(name);
  if (!stored.ok || checksum(stored.value[0]) !== expectedChecksum)
    throw Error("SOURCE_STORAGE_CHECKSUM_FAILED");
  return {
    anonymousStatus: await anonymousObjectStatus(bucket, name),
    authorizedChecksumMatched: true,
    size: stored.value[0].length,
  };
}
/** Internal source-evidence reader only; never mounted as a public download. */
export async function readSourceText(snapshotId: string, expectedChecksum: string) {
  const { client, name } = sourceObject(snapshotId, "text");
  const stored = await client.downloadAsBytes(name);
  if (
    !stored.ok ||
    stored.value[0].length > 8 * 1024 * 1024 ||
    checksum(stored.value[0]) !== expectedChecksum
  )
    throw Error("SOURCE_STORAGE_CHECKSUM_FAILED");
  return stored.value[0].toString("utf8");
}
