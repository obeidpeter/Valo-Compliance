import { randomUUID } from "node:crypto";
import { Client } from "@replit/object-storage";
import { sha256 } from "@workspace/valo-core";
import { setting } from "../../platform/settings";
export type ArtifactRef = { id: string; hash: string; extension: "json" | "pdf" | "docx" };
function location(ref: Pick<ArtifactRef, "id" | "extension">) {
  if (!/^[a-f0-9-]{36}$/.test(ref.id) || !["json", "pdf", "docx"].includes(ref.extension))
    throw Error("INVALID_PUBLICATION_ASSET");
  const [bucket, ...parts] = (setting("PRIVATE_OBJECT_DIR") ?? "").replace(/^\/+|\/+$/g, "").split("/");
  if (!bucket || !parts.length) throw Error("PRIVATE_STORAGE_NOT_CONFIGURED");
  return {
    client: new Client({ bucketId: bucket }),
    name: `${parts.join("/")}/valo/publication/development/${ref.id}.${ref.extension}`,
  };
}

/**
 * Release files are written once under a new name and never changed, and every read checks a file's
 * bytes against the hash its release recorded. So a file read in the last ten minutes is served from
 * memory, after the same check, instead of being downloaded again: listing what is published reads
 * three files an item. What is published, its holds and its permission are still read every time, so
 * a withdrawal or a hold takes effect at once (EDP-011).
 */
export const RECENT_ARTIFACT_MS = 10 * 60_000;
const RECENT_ARTIFACT_BYTES = 32 * 1024 * 1024;
const recent = new Map<string, { bytes: Buffer; at: number }>();
let recentBytes = 0;
function remember(key: string, bytes: Buffer, at: number) {
  const earlier = recent.get(key);
  if (earlier) {
    recent.delete(key);
    recentBytes -= earlier.bytes.length;
  }
  recent.set(key, { bytes, at });
  recentBytes += bytes.length;
  // The oldest go first once the files held pass their limit.
  for (const [oldest, entry] of recent) {
    if (recentBytes <= RECENT_ARTIFACT_BYTES) break;
    recent.delete(oldest);
    recentBytes -= entry.bytes.length;
  }
}
export async function putPublicationArtifact(
  bytes: Buffer,
  extension: ArtifactRef["extension"],
): Promise<ArtifactRef> {
  if (bytes.length > 2 * 1024 * 1024) throw Error("PUBLICATION_ASSET_TOO_LARGE");
  const ref = { id: randomUUID(), hash: sha256(bytes), extension };
  const { client, name } = location(ref);
  const exists = await client.exists(name);
  if (!exists.ok || exists.value) throw Error("PUBLICATION_ASSET_KEY_UNAVAILABLE");
  if (!(await client.uploadFromBytes(name, bytes, { compress: false })).ok)
    throw Error("PUBLICATION_ASSET_WRITE_FAILED");
  await getPublicationArtifact(ref);
  return ref;
}
export async function getPublicationArtifact(ref: ArtifactRef, now = Date.now()) {
  const { client, name } = location(ref);
  const key = `${name}:${ref.hash}`;
  const held = recent.get(key);
  if (held && now - held.at < RECENT_ARTIFACT_MS && sha256(held.bytes) === ref.hash)
    return Buffer.from(held.bytes);
  const read = await client.downloadAsBytes(name);
  if (!read.ok || sha256(read.value[0]) !== ref.hash) throw Error("PUBLICATION_ASSET_HASH_MISMATCH");
  remember(key, Buffer.from(read.value[0]), now);
  return read.value[0];
}
