/** Controlled integration harness only. The parent simulates the accepted
 * storage request completing after SIGKILL; no native object write is made. */
import { executeExport } from "../modules/exports";
import { assertDevelopmentRuntime } from "../platform/valo-development-runtime";
import { db, valoExportJobs, valoWorkspaces } from "@workspace/db";
import { and, eq } from "drizzle-orm";
assertDevelopmentRuntime();
if (
  process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only" ||
  process.env.VALO_ERASURE_CRASH_CHILD !== "controlled-synthetic-only" ||
  !process.send
)
  throw Error("CONTROLLED_ERASURE_CHILD_ONLY");
const [id, workspaceId, queueId] = process.argv.slice(2);
if (!id || !workspaceId || !queueId) throw Error("CONTROLLED_EXPORT_IDS_REQUIRED");
const [row] = await db
  .select({ owner: valoWorkspaces.ownerIdentityId, requester: valoExportJobs.requestedBy })
  .from(valoExportJobs)
  .innerJoin(valoWorkspaces, eq(valoWorkspaces.id, valoExportJobs.workspaceId))
  .where(
    and(
      eq(valoExportJobs.id, id),
      eq(valoExportJobs.workspaceId, workspaceId),
      eq(valoExportJobs.queueId, queueId),
    ),
  );
if (!row || !row.owner.startsWith("synthetic-erasure-race-") || row.requester !== row.owner)
  throw Error("OWNED_SYNTHETIC_ERASURE_FIXTURE_REQUIRED");
await executeExport(id, workspaceId, queueId, undefined, {
  write: async (key, bytes, onUploading) => {
    await onUploading?.();
    process.send!({ stage: "upload_accepted", key, bytes: bytes.toString("base64") });
    await new Promise<never>(() => {});
    throw Error("CONTROLLED_CHILD_MUST_BE_KILLED");
  },
  remove: async () => {
    throw Error("KILLED_CHILD_CANNOT_CLEAN_UP");
  },
});
process.send({ stage: "worker_returned", errorCode: "NO_UPLOAD_BARRIER" });
