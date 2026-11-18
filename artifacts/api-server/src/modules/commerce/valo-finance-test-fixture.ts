/** Synthetic CI data only; never a publisher bypass or a released product. */
import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, valoContentVersions, valoPublicationPolicies } from "@workspace/db";
import { setting } from "../../platform/settings";
export async function financeHeldFixture() {
  const [existing] = await db
    .select()
    .from(valoContentVersions)
    .where(eq(valoContentVersions.status, "held"))
    .limit(1);
  if (existing) return existing;
  if (setting("VALO_RUN_DB_TESTS") !== "synthetic-development-only" || setting("REPLIT_DEPLOYMENT"))
    throw Error("Existing held development candidate or isolated synthetic CI flag required.");
  const token = randomUUID(),
    policyId = `synthetic-finance-${token}`;
  const policy = { scope: "Controlled CI financial foreign-key fixture", publicationAllowed: false },
    bundle = { fixture: true, rights: [], reviews: [], published: false };
  const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
  await db.insert(valoPublicationPolicies).values({
    id: policyId,
    hash: hash(policy),
    policy,
    authority: { syntheticOnly: true, ownerApprovalClaimed: false },
  });
  const [row] = await db
    .insert(valoContentVersions)
    .values({
      id: randomUUID(),
      templateId: `CONTROLLED-FINANCE-${token}`,
      version: 1,
      slug: `controlled-finance-${token}`,
      policyId,
      candidateHash: hash(bundle),
      bundle,
      attestations: { checks: [] },
      reviewBy: new Date(0),
    })
    .returning();
  await db
    .update(valoContentVersions)
    .set({
      status: "held",
      withdrawnReason: "Synthetic CI fixture; zero review, rights or release evidence.",
    })
    .where(eq(valoContentVersions.id, row.id));
  // Append-only evidence stays in this disposable CI database. Never delete or
  // relax its immutable triggers just to clean up a test.
  return { ...row, status: "held" };
}
