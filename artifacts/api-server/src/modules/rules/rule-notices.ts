import { and, desc, eq, isNull } from "drizzle-orm";
import { authorizeWorkspaceRead, authorizeWorkspaceWrite, type WorkspaceActor } from "../workspaces";
import { ValoProblem } from "../../platform/valo-problem";

/**
 * The workspace's unread notices that a requirements-check rule version it saved a result under, or
 * made a task from, was replaced or withdrawn (docs/architecture/rule-changes.md, slice 2), newest
 * first. The database writes each one, with the change's reason, in the transaction that makes the
 * change; a workspace only reads them and marks them read.
 */
export async function listRuleNotices(actor: WorkspaceActor) {
  const { db, valoRuleNotices: n } = await import("@workspace/db");
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
        ruleId: row.ruleId,
        title: row.title,
        version: row.version,
        kind: row.kind as "replaced" | "withdrawn",
        replacementVersion: row.replacementVersion,
        reason: row.reason,
        results: row.results,
        tasks: row.tasks,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  });
}

/** Marks one of the workspace's rule notices read, so that its home no longer lists it. Nothing else
 * of it changes; marking it again does nothing. */
export async function markRuleNoticeRead(actor: WorkspaceActor, id: string) {
  const { db, valoRuleNotices: n } = await import("@workspace/db");
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
  return listRuleNotices(actor);
}
