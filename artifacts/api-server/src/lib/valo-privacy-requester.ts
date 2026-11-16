import { and, desc, eq } from "drizzle-orm";
import { db, valoPrivacyCases } from "@workspace/db";
import {
  checkPrivacyAudit,
  privacyCaseRecord,
  privacyDetail,
  readPrivacyCase,
  respondPrivacyCase,
} from "./valo-privacy";
import { ValoProblem } from "./valo-problem";
import { workspaceActorFromRecord } from "../platform/workspace-context";

/** Case-only identity scope. Never provisions a workspace or revives membership.
 * Callers supply the server-verified identity, not an email or browser tenant. */
export async function requesterCaseActor(identityId: string, id: string) {
  const [row] = await db
    .select({ workspaceId: valoPrivacyCases.workspaceId })
    .from(valoPrivacyCases)
    .where(and(eq(valoPrivacyCases.id, id), eq(valoPrivacyCases.requesterIdentityId, identityId)))
    .limit(1);
  if (!row) throw new ValoProblem(404, "Privacy request not found.");
  return workspaceActorFromRecord({ identityId, workspaceId: row.workspaceId });
}
export async function requesterPrivacyList(identityId: string) {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(valoPrivacyCases)
      .where(eq(valoPrivacyCases.requesterIdentityId, identityId))
      .orderBy(desc(valoPrivacyCases.createdAt), desc(valoPrivacyCases.id))
      .limit(100);
    for (const row of rows) await checkPrivacyAudit(tx, row);
    return rows.map(privacyCaseRecord);
  });
}
export async function requesterPrivacyDetail(identityId: string, id: string) {
  const actor = await requesterCaseActor(identityId, id);
  return db.transaction(async (tx) => privacyDetail(tx, await readPrivacyCase(tx, id, actor)));
}
export async function requesterPrivacyReply(identityId: string, id: string, raw: unknown) {
  return respondPrivacyCase(await requesterCaseActor(identityId, id), id, raw);
}
