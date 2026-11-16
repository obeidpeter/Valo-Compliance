import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writePrivateFile, readPrivateFile, deletePrivateFile } from "../lib/valo-private-storage";

/** Test composition only. Production storage never falls back to local files. */
export function erasureProofMode(env: NodeJS.ProcessEnv) {
  const mode = env.VALO_ERASURE_STORAGE_PROOF ?? "portable";
  if (mode !== "portable" && mode !== "native-replit") throw Error("UNKNOWN_ERASURE_PROOF_STORAGE_MODE");
  if (mode === "native-replit") {
    if (env.CI) throw Error("NATIVE_ERASURE_PROOF_FORBIDDEN_IN_CI");
    if (!env.PRIVATE_OBJECT_DIR?.trim()) throw Error("NATIVE_ERASURE_PROOF_UNCONFIGURED");
  }
  return mode;
}
export async function erasureProofStorage(workspaceId: string, mode: "portable" | "native-replit") {
  if (!/^[a-f0-9-]{36}$/.test(workspaceId)) throw Error("INVALID_PROOF_WORKSPACE");
  // Private scratch file bytes, not SQL/base64 or a native-provider simulation.
  const dir = mode === "portable" ? await mkdtemp(join(tmpdir(), "valo-erasure-proof-")) : null;
  const stats = { writes: 0, reads: 0, deletes: 0 },
    owned = new Set<string>();
  const path = (key: string) => {
    if (
      !key.startsWith(`valo/development/${workspaceId}/`) ||
      !/^valo\/development\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.(pdf|docx|json)$/.test(key)
    )
      throw Error("PROOF_OBJECT_OUTSIDE_SYNTHETIC_WORKSPACE");
    return dir ? join(dir, createHash("sha256").update(key).digest("hex")) : "";
  };
  const checksum = (b: Buffer) => createHash("sha256").update(b).digest("hex");
  const remove = async (key: string) => {
    const p = path(key);
    stats.deletes++;
    if (dir) await rm(p, { force: true });
    else await deletePrivateFile(key);
    owned.delete(key);
  };
  return {
    backend: mode === "portable" ? "controlled-private-filesystem" : "native-replit-app-storage",
    stats,
    async write(key: string, bytes: Buffer) {
      const p = path(key);
      owned.add(key);
      stats.writes++;
      if (!dir) return writePrivateFile(key, bytes);
      await writeFile(p, bytes, { flag: "wx", mode: 0o600 });
      assertPrivateMode((await stat(p)).mode);
      return { checksum: checksum(bytes), size: bytes.length };
    },
    async read(key: string, expected: string) {
      const p = path(key);
      stats.reads++;
      if (!dir) return readPrivateFile(key, expected);
      let b: Buffer;
      try {
        b = await readFile(p);
      } catch {
        throw Error("PRIVATE_STORAGE_READ_FAILED");
      }
      if (checksum(b) !== expected) throw Error("PRIVATE_FILE_CHECKSUM_MISMATCH");
      return b;
    },
    remove,
    async close() {
      // Keep DB locators if native cleanup cannot be confirmed by the caller.
      for (const key of [...owned]) await remove(key);
      if (dir) await rm(dir, { recursive: true, force: true });
    },
  };
}
function assertPrivateMode(mode: number) {
  if ((mode & 0o077) !== 0) throw Error("PROOF_FILE_PERMISSIONS_TOO_BROAD");
}
