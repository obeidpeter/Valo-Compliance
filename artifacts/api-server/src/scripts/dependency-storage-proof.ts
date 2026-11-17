import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  writePrivateFile,
  readPrivateFile,
  deletePrivateFile,
  fileChecksum,
  anonymousPrivateFileStatus,
} from "../lib/valo-private-storage";
import { publicationWorkspaceRoot } from "../editorial/operational-policy";
async function main() {
  if (
    process.env.NODE_ENV !== "development" ||
    process.env.REPLIT_DEPLOYMENT ||
    process.env.VALO_DEPENDENCY_STORAGE_PROOF !== "synthetic-development-only"
  )
    throw Error("DEVELOPMENT_ONLY");
  const key = `valo/development/${randomUUID()}/${randomUUID()}.pdf`;
  const bytes = Buffer.from("Synthetic native SDK dependency compatibility probe; no customer data.");
  try {
    await writePrivateFile(key, bytes);
    const downloaded = await readPrivateFile(key, fileChecksum(bytes));
    if (!downloaded.equals(bytes)) throw Error("ROUND_TRIP_MISMATCH");
    const anonymous = await anonymousPrivateFileStatus(key);
    if (![401, 403, 404].includes(anonymous)) throw Error("ANONYMOUS_ACCESS_ALLOWED");
    await deletePrivateFile(key);
    let denied = false;
    try {
      await readPrivateFile(key, fileChecksum(bytes));
    } catch {
      denied = true;
    }
    if (!denied) throw Error("DELETED_FILE_READABLE");
    await writeFile(
      resolve(publicationWorkspaceRoot(), "docs/valo/evidence/dependency-storage-compatibility.json"),
      JSON.stringify(
        {
          executedAt: new Date().toISOString(),
          scope: "Development native Replit SDK with scoped UUID 11.1.1 resolution; synthetic bytes",
          writeReadChecksum: true,
          anonymousStatus: anonymous,
          deletionReadDenied: true,
          cleanupCompleted: true,
          productionWorkerCompatibilityProved: false,
        },
        null,
        2,
      ) + "\n",
    );
    console.log("NATIVE_STORAGE_DEPENDENCY_COMPATIBILITY_PASSED");
  } finally {
    // Best-effort cleanup of the synthetic object.
    await deletePrivateFile(key).catch(() => {});
  }
}
main().catch((error) => {
  console.error(
    error instanceof Error && /^[A-Z_]+$/.test(error.message)
      ? error.message
      : "NATIVE_STORAGE_COMPATIBILITY_FAILED",
  );
  process.exitCode = 1;
});
