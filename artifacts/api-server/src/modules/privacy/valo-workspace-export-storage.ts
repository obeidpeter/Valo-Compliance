import { createReadStream, createWriteStream } from "node:fs";
import { createHash } from "node:crypto";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { privateWorkspaceObject, deletePrivateFile } from "../../lib/valo-private-storage";
import { abortable } from "../../lib/valo-abort";
export const WORKSPACE_EXPORT_MAX_BYTES = 128 * 1024 * 1024;
export const WORKSPACE_EXPORT_ATTEMPT_MS = 5 * 60_000;
export async function workspaceFileDigest(path: string, signal?: AbortSignal) {
  const read = createReadStream(path, { signal });
  let size = 0;
  const hash = createHash("sha256");
  for await (const chunk of read) {
    size += chunk.length;
    if (size > WORKSPACE_EXPORT_MAX_BYTES) throw Error("WORKSPACE_EXPORT_SIZE_LIMIT");
    hash.update(chunk);
  }
  return { size, checksum: hash.digest("hex") };
}
export const workspaceExportStorage = {
  async put(key: string, path: string, signal: AbortSignal) {
    signal.throwIfAborted();
    await workspaceFileDigest(path, signal);
    const { client, name } = privateWorkspaceObject(key),
      exists = await abortable(signal, () => client.exists(name));
    if (!exists.ok || exists.value) throw Error("FRESH_PRIVATE_OBJECT_REQUIRED");
    signal.throwIfAborted();
    const source = createReadStream(path, { signal });
    // The native SDK cannot guarantee recall of an accepted upload. The caller
    // retains its pre-I/O reservation through cleanup and erasure replay.
    try {
      await client.uploadFromStream(name, source, { compress: false });
    } finally {
      source.destroy();
    }
  },
  async get(key: string, path: string, signal: AbortSignal) {
    signal.throwIfAborted();
    const { client, name } = privateWorkspaceObject(key);
    let bytes = 0,
      upstream: Readable | undefined;
    const limit = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        callback(bytes > WORKSPACE_EXPORT_MAX_BYTES ? Error("WORKSPACE_EXPORT_SIZE_LIMIT") : null, chunk);
      },
    });
    const read = client.downloadAsStream(name);
    // SDK 1.0 pipes its GCS source asynchronously into this wrapper. Destroy
    // both early and late upstreams so cancellation cannot leave an open read.
    read.on("pipe", (source: Readable) => {
      upstream = source;
      if (signal.aborted || read.destroyed) source.destroy();
    });
    const stop = () => upstream?.destroy();
    signal.addEventListener("abort", stop, { once: true });
    read.once("close", stop);
    try {
      await pipeline(read, limit, createWriteStream(path, { flags: "wx", mode: 0o600 }), { signal });
    } finally {
      signal.removeEventListener("abort", stop);
      if (read.destroyed) stop();
    }
  },
  remove: deletePrivateFile,
};
export type WorkspaceExportStorage = typeof workspaceExportStorage;
