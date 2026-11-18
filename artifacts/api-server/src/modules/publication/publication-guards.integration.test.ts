import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { digest, evaluatePublication } from "@workspace/valo-core";
import { heldSourceBundle } from "../sources/valo-source-controls.fixtures";

/**
 * The publication guards that operational-publication.integration.test.ts checks against the
 * actual development candidates, here against a synthetic candidate that fails its gates, so CI
 * runs them on every change. Nothing here can publish: the candidate is not eligible, and every
 * check expects a refusal.
 */

/** Drizzle reports database errors as "Failed query: ..." with the database's own error as the
 * cause; match the database's message or code anywhere in that chain. */
const databaseError = (expected: RegExp | string) => (error: unknown) => {
  for (let e: unknown = error, depth = 0; e && depth < 5; depth++) {
    const item = e as { message?: unknown; code?: unknown; cause?: unknown };
    if (typeof expected === "string" ? item.code === expected : expected.test(String(item.message ?? "")))
      return true;
    e = item.cause;
  }
  return false;
};

test(
  "a synthetic candidate that fails its gates is held, and no role or path publishes, changes or withdraws it",
  { skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only", timeout: 60_000 },
  async (t) => {
    assert.equal(process.env.NODE_ENV, "development");
    assert.ok(!process.env.REPLIT_DEPLOYMENT);
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL!).hostname));
    const { db, pool } = await import("@workspace/db");
    const { publishOperationalVersion, recordActualPublicationHold, withdrawOperationalVersion } =
      await import("./publication-publisher");
    const { liveOperationalVersions, readReleasedMaster } =
      await import("../catalogue/valo-released-content");
    t.after(() => pool.end());
    const id = randomUUID(),
      prefix = `synthetic-publication-guards-${id}`,
      bundle = heldSourceBundle(new Date(), false);
    assert.equal(evaluatePublication(bundle).decision, "hold", "the synthetic candidate is not eligible");
    const asRole = (role: string | null, query: ReturnType<typeof sql>) =>
      db.transaction(async (tx) => {
        if (role) await tx.execute(sql.raw(`set local role ${role}`));
        return tx.execute(query);
      });
    const status = async () =>
      (await db.execute(sql`select status from valo_content_versions where id=${id}::uuid`)).rows[0]?.status;

    await db.execute(
      sql`insert into valo_publication_policies(id,hash,policy,authority) values(${prefix},${digest(bundle.policy)},${JSON.stringify(bundle.policy)}::jsonb,'{"synthetic":true,"approved":false}')`,
    );
    // Drafters add candidates; this is the only way content versions are created.
    await asRole(
      "valo_content_drafter_dev",
      sql`insert into valo_content_versions(id,template_id,version,slug,policy_id,candidate_hash,bundle,attestations,status,review_by)
        values(${id}::uuid,${prefix},1,${prefix},${prefix},${bundle.candidate.hash},${JSON.stringify(bundle)}::jsonb,'{}','candidate',${new Date(Date.now() + 86_400_000)})`,
    );

    await t.test("the bounded publisher records the failed gates as a hold", async () => {
      const held = await recordActualPublicationHold(id);
      assert.equal(held.status, "held");
      assert.ok(held.reasons.length > 0);
      assert.equal(await status(), "held");
      const audit = await db.execute(
        sql`select action from valo_publication_audit where version_id=${id}::uuid order by created_at`,
      );
      assert.deepEqual(
        audit.rows.map((r) => r.action),
        ["held"],
      );
    });

    await t.test("the bounded publisher refuses the held version", async () => {
      await assert.rejects(() => publishOperationalVersion(id), /VERSION_NOT_RELEASABLE/);
      assert.equal(await status(), "held");
    });

    await t.test("the held version is neither listed nor downloadable", async () => {
      assert.ok(!(await liveOperationalVersions()).some((r) => r.id === id));
      await assert.rejects(() => readReleasedMaster(id, "pdf"), /withdrawn|expired|unavailable/i);
    });

    await t.test("withdrawal cannot turn the held version into a past publication", async () => {
      await assert.rejects(
        () => withdrawOperationalVersion(id, "synthetic check"),
        /PUBLISHED_VERSION_REQUIRED/,
      );
      assert.equal(await status(), "held");
    });

    await t.test("the drafter role cannot change publication state", async () => {
      await assert.rejects(
        asRole(
          "valo_content_drafter_dev",
          sql`update valo_content_versions set status='published' where id=${id}::uuid`,
        ),
        databaseError("42501"),
      );
    });

    await t.test("a drafter cannot add a version straight into published state", async () => {
      await assert.rejects(
        asRole(
          "valo_content_drafter_dev",
          sql`insert into valo_content_versions(id,template_id,version,slug,policy_id,candidate_hash,bundle,attestations,status,review_by)
            values(${randomUUID()}::uuid,${prefix},2,${`${prefix}-2`},${prefix},'forged','{}','{}','published',${new Date(Date.now() + 86_400_000)})`,
        ),
        databaseError(/Candidates cannot publish themselves/),
      );
    });

    await t.test(
      "even the owner connection cannot publish a held version or change its payload",
      async () => {
        await assert.rejects(
          asRole(null, sql`update valo_content_versions set status='published' where id=${id}::uuid`),
          databaseError(/Invalid publication transition/),
        );
        await assert.rejects(
          asRole(null, sql`update valo_content_versions set bundle='{}'::jsonb where id=${id}::uuid`),
          databaseError(/Content versions are immutable/),
        );
        assert.equal(await status(), "held");
      },
    );

    await t.test("the publisher role cannot read customer drafts or change a policy", async () => {
      await assert.rejects(
        asRole("valo_content_publisher_dev", sql`select id from valo_documents limit 1`),
        databaseError("42501"),
      );
      await assert.rejects(
        asRole(
          "valo_content_publisher_dev",
          sql`update valo_publication_policies set hash='forged' where id=${prefix}`,
        ),
        databaseError("42501"),
      );
    });

    await t.test("policies and the publication audit trail are append-only", async () => {
      await assert.rejects(
        asRole(null, sql`update valo_publication_policies set hash='forged' where id=${prefix}`),
        databaseError(/append-only/),
      );
      await assert.rejects(
        asRole(null, sql`delete from valo_publication_audit where version_id=${id}::uuid`),
        databaseError(/append-only/),
      );
      await assert.rejects(
        asRole(null, sql`delete from valo_content_versions where id=${id}::uuid`),
        databaseError(/append-only/),
      );
    });
  },
);
