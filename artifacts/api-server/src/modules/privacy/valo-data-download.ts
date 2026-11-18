import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db } from "@workspace/db";
import { workspaceDataExport } from "./valo-customer-access";
import { authorizeWorkspaceRead, type WorkspaceActor } from "../../lib/valo-store";
import { abortable } from "../../lib/valo-abort";

/** Build a complete snapshot before sending headers. Private scratch bytes are
 * removed on success, denied authorization, reader failure or client disconnect.
 * This is regenerable scratch, never a persistent file asset or privacy result. */
export async function withWorkspaceDataFile<T>(
  actor: WorkspaceActor,
  consume: (path: string) => Promise<T>,
  options: {
    signal?: AbortSignal;
    /** Server-owned live-session check, after preparation and before the final DB guard. */
    beforeRelease?: () => Promise<void>;
    duringPreparation?: (section: string, rows: number) => Promise<void>;
  } = {},
) {
  const { signal, beforeRelease } = options;
  signal?.throwIfAborted();
  const directory = await mkdtemp(join(tmpdir(), "valo-data-access-"));
  const path = join(directory, "workspace.json");
  try {
    const file = await open(path, "wx", 0o600);
    try {
      await workspaceDataExport(
        actor,
        async (chunk) => {
          signal?.throwIfAborted();
          await file.writeFile(chunk, "utf8");
        },
        signal,
        options.duringPreparation,
      );
    } finally {
      await file.close();
    }
    signal?.throwIfAborted();
    await abortable(signal, async () => {
      await beforeRelease?.();
    });
    signal?.throwIfAborted();
    // Do not release a completed snapshot to a membership revoked while it built.
    await db.transaction(async (tx) => {
      await authorizeWorkspaceRead(tx, actor);
    });
    signal?.throwIfAborted();
    return await consume(path);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
