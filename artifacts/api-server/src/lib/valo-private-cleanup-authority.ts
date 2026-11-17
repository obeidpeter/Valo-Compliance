import { and, eq, asc } from "drizzle-orm";
import { db, valoPrivacyCases, valoPrivacyTombstones } from "@workspace/db";
import { readPrivacyCase } from "./valo-privacy";
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Take case locks BEFORE object/job locks. A recorded deletion hold must not
 * be bypassed by ordinary orphan/expiry cleanup, even before quarantine.
 * Keep this transaction open through the one authorized delete call. */
export async function privateCleanupAuthority(tx: Tx, workspaceId: string) {
  const [tombstone] = await tx
    .select({ id: valoPrivacyTombstones.id })
    .from(valoPrivacyTombstones)
    .where(eq(valoPrivacyTombstones.workspaceId, workspaceId))
    .limit(1);
  if (tombstone) return { allowed: false, privacyOwned: true };
  const cases = await tx
    .select({ id: valoPrivacyCases.id })
    .from(valoPrivacyCases)
    .where(and(eq(valoPrivacyCases.workspaceId, workspaceId), eq(valoPrivacyCases.kind, "deletion")))
    .orderBy(asc(valoPrivacyCases.id))
    .limit(101)
    .for("update");
  if (cases.length > 100) return { allowed: false, privacyOwned: false };
  for (const candidate of cases) {
    // Broken audit/key authority cannot silently turn a recorded hold into permission.
    try {
      if ((await readPrivacyCase(tx, candidate.id)).status === "held")
        return { allowed: false, privacyOwned: false };
    } catch {
      return { allowed: false, privacyOwned: false };
    }
  }
  const [quarantined] = await tx
    .select({ id: valoPrivacyTombstones.id })
    .from(valoPrivacyTombstones)
    .where(eq(valoPrivacyTombstones.workspaceId, workspaceId))
    .limit(1);
  return { allowed: !quarantined, privacyOwned: !!quarantined };
}
