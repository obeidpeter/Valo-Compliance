import assert from "node:assert/strict";
import { after, test } from "node:test";
import { pool, db, valoContentVersions, valoPublicationPolicies } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { evaluatePublication } from "@workspace/valo-core";
import { publishOperationalVersion, withdrawOperationalVersion } from "./publication-publisher";
import { liveOperationalVersions, readReleasedMaster } from "../../lib/valo-released-content";
const enabled =
  process.env.VALO_PUBLICATION_DB_TESTS === "synthetic-development-only" &&
  process.env.NODE_ENV === "development" &&
  !process.env.REPLIT_DEPLOYMENT;
after(() => pool.end());
async function rollbackQuery(
  role: "valo_content_drafter_dev" | "valo_content_publisher_dev" | null,
  text: string,
  values: unknown[] = [],
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (role) await client.query(`SET LOCAL ROLE ${role}`);
    return await client.query(text, values);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}
test(
  "actual development publication boundaries (no synthetic success substituted for release)",
  { skip: !enabled },
  async (t) => {
    const [row] = await db
      .select()
      .from(valoContentVersions)
      .where(eq(valoContentVersions.templateId, "TPL-07"))
      .orderBy(desc(valoContentVersions.version))
      .limit(1);
    assert.ok(row, "Run the actual development preparation first");
    await t.test("retained exact owner-scoped policy", async () => {
      const [p] = await db
        .select()
        .from(valoPublicationPolicies)
        .where(eq(valoPublicationPolicies.id, row.policyId));
      assert.ok(p);
      const policy = p.policy as { developmentOnly: boolean; authorityRefs: unknown[] };
      assert.equal(policy.developmentOnly, true);
      assert.equal(policy.authorityRefs.length, 2);
    });
    await t.test("actual held reviews do not become a released record", async () => {
      assert.equal(evaluatePublication(row.bundle).decision, "hold");
      assert.ok(!(await liveOperationalVersions()).some((r) => r.id === row.id));
    });
    await t.test("bounded publisher refuses the actual failed candidate", async () => {
      await assert.rejects(
        () => publishOperationalVersion(row.id),
        /PUBLICATION_HELD|VERSION_NOT_RELEASABLE/,
      );
    });
    await t.test("drafter cannot change publication state", async () => {
      await assert.rejects(
        () =>
          rollbackQuery(
            "valo_content_drafter_dev",
            "UPDATE valo_content_versions SET status='published' WHERE id=$1",
            [row.id],
          ),
        { code: "42501" },
      );
    });
    await t.test("publisher database role cannot read private customer drafts", async () => {
      await assert.rejects(
        () => rollbackQuery("valo_content_publisher_dev", "SELECT id FROM valo_documents LIMIT 1"),
        { code: "42501" },
      );
    });
    await t.test("publisher cannot change policy", async () => {
      await assert.rejects(
        () =>
          rollbackQuery(
            "valo_content_publisher_dev",
            "UPDATE valo_publication_policies SET hash=$1 WHERE id=$2",
            ["forged", row.policyId],
          ),
        { code: "42501" },
      );
    });
    await t.test("exact version payload is immutable even on the development owner connection", async () => {
      await assert.rejects(
        () =>
          rollbackQuery(null, "UPDATE valo_content_versions SET bundle='{}'::jsonb WHERE id=$1", [row.id]),
        /Content versions are immutable/,
      );
    });
    await t.test("drafter cannot insert directly into published state", async () => {
      await assert.rejects(
        () =>
          rollbackQuery(
            "valo_content_drafter_dev",
            `INSERT INTO valo_content_versions(id,template_id,version,slug,policy_id,candidate_hash,bundle,attestations,status,review_by)
       VALUES(gen_random_uuid(),'SYNTHETIC-FORBIDDEN',1,'synthetic-forbidden',$1,'forged','{}','{}','published',now()+interval '1 day')`,
            [row.policyId],
          ),
        /Candidates cannot publish themselves/,
      );
    });
    await t.test("failed candidate has no new master download", async () => {
      await assert.rejects(() => readReleasedMaster(row.id, "pdf"), /withdrawn|expired|unavailable/i);
    });
    await t.test(
      "withdrawal cannot turn a held candidate into fabricated historical publication",
      async () => {
        await assert.rejects(
          () => withdrawOperationalVersion(row.id, "test must fail"),
          /PUBLISHED_VERSION_REQUIRED/,
        );
      },
    );
    await t.test("source policy is append-only", async () => {
      await assert.rejects(
        () =>
          rollbackQuery(null, "UPDATE valo_publication_policies SET hash='forged' WHERE id=$1", [
            row.policyId,
          ]),
        /append-only/,
      );
    });
  },
);
