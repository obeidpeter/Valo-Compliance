import { randomUUID } from "node:crypto";
import type { db } from "@workspace/db";
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** Atomic with its already-authorized source intake. Case creation has no
 * dependency on staff operations, source controls or outbound services. */
export async function openSupportCase(
  tx: Tx,
  kind: "workspace" | "access",
  sourceId: string,
  workspaceId: string | null,
) {
  const { valoSupportCases } = await import("@workspace/db");
  const values = {
    id: randomUUID(),
    sourceKind: kind,
    ticketId: kind === "workspace" ? sourceId : null,
    accessId: kind === "access" ? sourceId : null,
    workspaceId,
  };
  await tx.insert(valoSupportCases).values(values).onConflictDoNothing();
}
