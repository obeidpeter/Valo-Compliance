import { and, desc, eq, isNull } from "drizzle-orm";
import { authorizeWorkspaceRead, authorizeWorkspaceWrite, type WorkspaceActor } from "../workspaces";
import { ValoProblem } from "../../platform/valo-problem";

/**
 * The workspace's unread notices that a template edition it bought or used was replaced or withdrawn
 * (docs/architecture/editions.md, slice 3), newest first. The database writes each one with the change
 * it tells of; a workspace only reads them and marks them read.
 */
export async function listEditionNotices(actor: WorkspaceActor) {
  const { db, valoEditionNotices: n } = await import("@workspace/db");
  return db.transaction(async (tx) => {
    await authorizeWorkspaceRead(tx, actor);
    const rows = await tx
      .select()
      .from(n)
      .where(and(eq(n.workspaceId, actor.workspaceId), isNull(n.readAt)))
      .orderBy(desc(n.createdAt), desc(n.id))
      .limit(50);
    return {
      items: rows.map((row) => ({
        id: row.id,
        route: row.route as "library" | "reviewed",
        title: row.title,
        version: row.version,
        kind: row.kind as "replaced" | "withdrawn",
        replacementVersion: row.replacementVersion,
        reason: row.reason,
        held: row.held,
        carries: row.carries,
        documents: row.documents,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  });
}

/** Marks one of the workspace's notices read, so that its home no longer lists it. Nothing else of it
 * changes; marking it again does nothing. */
export async function markEditionNoticeRead(actor: WorkspaceActor, id: string) {
  const { db, valoEditionNotices: n } = await import("@workspace/db");
  await db.transaction(async (tx) => {
    await authorizeWorkspaceWrite(tx, actor);
    const [row] = await tx
      .select({ id: n.id })
      .from(n)
      .where(and(eq(n.id, id), eq(n.workspaceId, actor.workspaceId)));
    if (!row) throw new ValoProblem(404, "This notice was not found.");
    await tx
      .update(n)
      .set({ readAt: new Date() })
      .where(and(eq(n.id, id), eq(n.workspaceId, actor.workspaceId), isNull(n.readAt)));
  });
  return listEditionNotices(actor);
}
