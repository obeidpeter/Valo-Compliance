import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import {
  db,
  pool,
  valoContentVersions,
  valoPreparedCandidates,
  valoPublicationPolicies,
  valoStaffAssignments,
} from "@workspace/db";
import { preparedCandidateState, staffOperations } from "./valo-staff-operations";

// A template candidate awaiting its reviews is a private artifact (decision 0014), so the
// staff Content area lists it from its own record. Every row here is synthetic.
test(
  "the staff Content area lists prepared candidates with where each stands",
  { skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only", timeout: 60000 },
  async () => {
    const staff = "user_synthetic_content_" + randomUUID(),
      run = randomUUID().slice(0, 8),
      template = (n: number) => `SYNTH-${run}-${n}`,
      hex = (c: string) => c.repeat(64),
      day = 86400000,
      now = Date.now();
    try {
      await db.insert(valoStaffAssignments).values({
        id: randomUUID(),
        identityId: staff,
        role: "content",
        grantedBy: "synthetic-fixture",
        reason: "Disposable test database only; not an actual staff approval",
      });
      const policyId = `synthetic-policy-${run}`;
      await db.insert(valoPublicationPolicies).values({
        id: policyId,
        hash: hex("0"),
        policy: { synthetic: true },
        authority: { synthetic: true },
      });
      const version = async (id: string, templateId: string, status: "candidate" | "held") => {
        await db.insert(valoContentVersions).values({
          id,
          templateId,
          version: 1,
          slug: templateId.toLowerCase(),
          policyId,
          candidateHash: hex("1"),
          bundle: { synthetic: true },
          attestations: { synthetic: true },
          reviewBy: new Date(now + 30 * day),
        });
        if (status === "held")
          await db.update(valoContentVersions).set({ status }).where(eq(valoContentVersions.id, id));
      };
      const prepared = (n: number, change: { reviewBy?: Date; versionId?: string } = {}) => ({
        artifactId: randomUUID(),
        artifactHash: hex(String(n)),
        versionId: change.versionId ?? randomUUID(),
        templateId: template(n),
        version: 1,
        candidateHash: hex("a"),
        preparedAt: new Date(now - (10 - n) * 60000),
        reviewBy: change.reviewBy ?? new Date(now + 30 * day),
      });
      // 1 awaits its reviews; 2 was saved and held; 3 passed its review date; 4 lost its version
      // number to another candidate saved first.
      const savedId = randomUUID();
      const rows = [
        prepared(1),
        prepared(2, { versionId: savedId }),
        prepared(3, { reviewBy: new Date(now - day) }),
        prepared(4),
      ];
      await version(savedId, template(2), "held");
      await version(randomUUID(), template(4), "candidate");
      await db.insert(valoPreparedCandidates).values(rows);

      const actor = { identityId: staff, recentMfa: true, verifiedAt: Date.now() };
      const result = await staffOperations(actor, "content");
      const listed = (result.preparedCandidates ?? []).filter((c) =>
        c.templateId.startsWith(`SYNTH-${run}-`),
      );
      // Most recent first, each with its artifact, version and state.
      assert.deepEqual(
        listed.map((c) => [c.templateId, c.state, c.savedStatus]),
        [
          [template(4), "version_taken", null],
          [template(3), "expired", null],
          [template(2), "saved", "held"],
          [template(1), "awaiting_reviews", null],
        ],
      );
      const first = listed.at(-1)!;
      assert.deepEqual(
        {
          artifactId: first.artifactId,
          artifactHash: first.artifactHash,
          versionId: first.versionId,
          version: first.version,
        },
        {
          artifactId: rows[0]!.artifactId,
          artifactHash: rows[0]!.artifactHash,
          versionId: rows[0]!.versionId,
          version: 1,
        },
      );
      assert.ok(first.preparedAt instanceof Date && first.reviewBy instanceof Date);
      // The other areas carry no prepared candidates.
      await db.insert(valoStaffAssignments).values({
        id: randomUUID(),
        identityId: staff,
        role: "support",
        grantedBy: "synthetic-fixture",
        reason: "Disposable test database only; not an actual staff approval",
      });
      assert.equal(Object.hasOwn(await staffOperations(actor, "support"), "preparedCandidates"), false);
    } finally {
      // Content versions and staff access records are append-only, so only the prepared records
      // are removed; the rest stay in the disposable database under their synthetic names.
      await db.execute(sql`delete from valo_prepared_candidates where template_id like ${`SYNTH-${run}-%`}`);
      await pool.end();
    }
  },
);

test("a prepared candidate's state: saved first, then a taken version number, then its review date", () => {
  const now = new Date("2026-11-20T00:00:00Z"),
    later = new Date("2026-12-20T00:00:00Z"),
    earlier = new Date("2026-11-19T00:00:00Z");
  const state = (savedStatus: string | null, versionTaken: boolean, reviewBy: Date) =>
    preparedCandidateState({ savedStatus, versionTaken, reviewBy }, now);
  assert.equal(state(null, false, later), "awaiting_reviews");
  assert.equal(state("published", true, earlier), "saved");
  assert.equal(state(null, true, later), "version_taken");
  assert.equal(state(null, false, earlier), "expired");
  assert.equal(state(null, false, now), "expired");
});
