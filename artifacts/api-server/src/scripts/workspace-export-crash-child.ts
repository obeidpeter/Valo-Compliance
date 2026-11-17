import { db, pool, valoWorkspaceExports } from "@workspace/db";
import { eq } from "drizzle-orm";
import { executeWorkspaceExport, type WorkspaceExportStage } from "../lib/valo-workspace-export-jobs";
import { fixtureWorkspaceStorage } from "../lib/test-support/workspace-export-storage";
if (
  process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only" ||
  process.env.NODE_ENV !== "development" ||
  process.env.REPLIT_DEPLOYMENT ||
  !process.send
)
  throw Error("ISOLATED_SYNTHETIC_CHILD_REQUIRED");
const [id, workspaceId, queueId, stage, directory] = process.argv.slice(2) as [
  string,
  string,
  string,
  WorkspaceExportStage,
  string,
];
const [row] = await db.select().from(valoWorkspaceExports).where(eq(valoWorkspaceExports.id, id));
if (!row || row.workspaceId !== workspaceId || !row.requesterId.startsWith("synthetic-workspace-export-"))
  throw Error("OWNED_SYNTHETIC_JOB_REQUIRED");
await executeWorkspaceExport(id, workspaceId, queueId, {
  storage: fixtureWorkspaceStorage(directory),
  onStage: async (current) => {
    if (current === stage) {
      process.send!({ stage });
      await new Promise<void>((resolve) => process.once("message", () => resolve()));
    }
  },
});
await pool.end();
