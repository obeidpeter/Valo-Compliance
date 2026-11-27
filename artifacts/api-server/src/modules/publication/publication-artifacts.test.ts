import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";

test("a release file read again within ten minutes is served from memory after its hash check, and read again after that", async (t) => {
  const files = new Map<string, Buffer>();
  const downloads: string[] = [];
  t.mock.module("@replit/object-storage", {
    namedExports: {
      Client: class {
        async downloadAsBytes(name: string) {
          downloads.push(name);
          return files.has(name) ? { ok: true, value: [Buffer.from(files.get(name)!)] } : { ok: false };
        }
      },
    },
  });
  process.env.PRIVATE_OBJECT_DIR = "/synthetic-bucket/private";
  const { getPublicationArtifact, RECENT_ARTIFACT_MS } = await import("./publication-artifacts");
  const bytes = Buffer.from('{"synthetic":"release record"}');
  const ref = {
    id: randomUUID(),
    hash: createHash("sha256").update(bytes).digest("hex"),
    extension: "json" as const,
  };
  const name = `private/valo/publication/development/${ref.id}.json`;
  files.set(name, bytes);
  const now = Date.now();
  assert.deepEqual(await getPublicationArtifact(ref, now), bytes);
  const copy = await getPublicationArtifact(ref, now + 1000);
  assert.deepEqual(copy, bytes);
  assert.equal(downloads.length, 1, "the second read came from memory");
  // A caller that changes what it was given changes nothing held.
  copy.fill(0);
  assert.deepEqual(await getPublicationArtifact(ref, now + 2000), bytes);
  assert.equal(downloads.length, 1);
  // A reference with another hash is another file: it is downloaded and refused.
  await assert.rejects(
    getPublicationArtifact({ ...ref, hash: "0".repeat(64) }, now + 3000),
    /PUBLICATION_ASSET_HASH_MISMATCH/,
  );
  assert.equal(downloads.length, 2);
  // After ten minutes the file is read again, and a file that changed in storage is refused.
  files.set(name, Buffer.from('{"synthetic":"changed"}'));
  await assert.rejects(
    getPublicationArtifact(ref, now + RECENT_ARTIFACT_MS + 1),
    /PUBLICATION_ASSET_HASH_MISMATCH/,
  );
  assert.equal(downloads.length, 3);
  // An invalid reference is refused before anything is read.
  await assert.rejects(getPublicationArtifact({ ...ref, id: "../escape" }, now), /INVALID_PUBLICATION_ASSET/);
  assert.equal(downloads.length, 3);
});
