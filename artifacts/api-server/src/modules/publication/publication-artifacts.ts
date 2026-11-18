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
export async function getPublicationArtifact(ref: ArtifactRef) {
  const { client, name } = location(ref);
  const read = await client.downloadAsBytes(name);
  if (!read.ok || sha256(read.value[0]) !== ref.hash) throw Error("PUBLICATION_ASSET_HASH_MISMATCH");
  return read.value[0];
}
