import { db, pool, valoWorkspaceExports } from "@workspace/db";
import { eq } from "drizzle-orm";
import { assertDevelopmentRuntime } from "../platform/valo-development-runtime";
import { prepareWorkspaceExport } from "../modules/privacy";
import { workspaceActorFromRecord } from "../platform/workspace-context";
assertDevelopmentRuntime();
if (process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only" || !process.send)
  throw Error("CONTROLLED_CHILD_ONLY");
const [id, workspaceId, identityId] = process.argv.slice(2);
if (!identityId?.startsWith("synthetic-workspace-export-")) throw Error("OWNED_SYNTHETIC_FIXTURE_REQUIRED");
const [row] = await db.select().from(valoWorkspaceExports).where(eq(valoWorkspaceExports.id, id!));
if (!row || row.requesterId !== identityId || row.workspaceId !== workspaceId)
  throw Error("FIXTURE_MISMATCH");
try {
  await prepareWorkspaceExport(
    workspaceActorFromRecord({ workspaceId: workspaceId!, identityId }),
    id!,
    new AbortController().signal,
    async () => {},
    undefined,
    async (section, rows) => {
      if (section === "yourActivity" && rows === 500) {
        process.send!({ stage: "page" });
        await new Promise<void>(() => {});
      }
    },
  );
} finally {
  await pool.end();
}
