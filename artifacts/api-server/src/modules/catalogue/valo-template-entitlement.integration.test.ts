import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

/**
 * IAM-003 for files: a premium template version is released only to a workspace that
 * holds its own active purchase. Another workspace's purchase of the same version grants
 * nothing, and a suspended purchase grants nothing.
 *
 * This exercises the purchase check that readReleasedMaster runs inside its
 * transaction. The content version is a held, never-published fixture; no release,
 * review or publication record is created.
 */
test(
  "only the purchasing workspace's active entitlement releases a premium master",
  { skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only", timeout: 30_000 },
  async () => {
    assert.equal(process.env.NODE_ENV, "development");
    assert.ok(!process.env.REPLIT_DEPLOYMENT);
    const { db, pool, valoContentVersions, valoEntitlements, valoOrders, valoPrices } =
      await import("@workspace/db");
    const { resolveWorkspace } = await import("../workspaces");
    const { financeHeldFixture } = await import("../commerce/valo-finance-test-fixture");
    const { requirePurchaseForPricedMaster } = await import("./valo-released-content");
    try {
      const tag = randomUUID();
      const [purchaser, other] = await Promise.all([
        resolveWorkspace(`synthetic-entitlement-purchaser-${tag}`),
        resolveWorkspace(`synthetic-entitlement-other-${tag}`),
      ]);
      const held = await financeHeldFixture();
      assert.doesNotMatch(held.templateId, /^TPL-(0[1-9]|1[0-2])$/, "the fixture is not a free baseline");
      const priceId = randomUUID(),
        orderId = randomUUID(),
        grantId = randomUUID();
      await db.insert(valoPrices).values({
        id: priceId,
        contentVersionId: held.id,
        title: "CONTROLLED ENTITLEMENT FIXTURE — NOT RELEASED",
        amountKobo: 10000,
        licenceVersion: "test-only",
        licenceText: "No live commercial approval.",
        taxTreatment: "No tax claim.",
        approvalReference: "CONTROLLED_FIXTURE_NOT_APPROVAL",
        effectiveFrom: new Date(),
      });
      await db.insert(valoOrders).values({
        id: orderId,
        workspaceId: purchaser.workspaceId,
        requestedBy: purchaser.identityId,
        requestKey: randomUUID(),
        priceId,
        reference: "valo-test-" + orderId,
        amountKobo: 10000,
        status: "verified_success",
        providerTransactionId: String(Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16)),
        line: {
          title: "Controlled purchase",
          contentVersionId: held.id,
          licenceVersion: "test-only",
          licenceText: "No live commercial approval.",
          taxTreatment: "No tax claim.",
        },
      });
      await db.insert(valoEntitlements).values({
        id: grantId,
        workspaceId: purchaser.workspaceId,
        orderId,
        contentVersionId: held.id,
      });
      const release = (actor: typeof purchaser) =>
        db.transaction((tx) => requirePurchaseForPricedMaster(tx, actor, held));

      await release(purchaser);
      await assert.rejects(release(other), { status: 403 }, "another workspace's purchase grants nothing");
      // A purchase of one version carries to a later version of the same template at no further
      // charge, though the later one has no price of its own (docs/architecture/editions.md, slice 2).
      const versions = await db
        .select({ version: valoContentVersions.version })
        .from(valoContentVersions)
        .where(eq(valoContentVersions.templateId, held.templateId));
      const next = Math.max(...versions.map((row) => row.version)) + 1;
      const [later] = await db
        .insert(valoContentVersions)
        .values({
          id: randomUUID(),
          templateId: held.templateId,
          version: next,
          slug: held.slug + "-v" + next,
          policyId: held.policyId,
          candidateHash: held.candidateHash,
          bundle: held.bundle,
          attestations: held.attestations,
          reviewBy: held.reviewBy,
        })
        .returning();
      const releaseLater = (actor: typeof purchaser) =>
        db.transaction((tx) => requirePurchaseForPricedMaster(tx, actor, later!));
      await releaseLater(purchaser);
      await assert.rejects(releaseLater(other), { status: 403 }, "a carried purchase stays its workspace's");
      await db.update(valoEntitlements).set({ status: "suspended" }).where(eq(valoEntitlements.id, grantId));
      await assert.rejects(release(purchaser), { status: 403 }, "a suspended purchase grants nothing");
      await assert.rejects(releaseLater(purchaser), { status: 403 }, "a suspended purchase carries nothing");
    } finally {
      await pool.end();
    }
  },
);
