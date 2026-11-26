import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { sql } from "drizzle-orm";
import { digest } from "@workspace/valo-core";
import { heldSourceBundle } from "./valo-source-controls.fixtures";

/**
 * docs/architecture/source-register.md, slice 3 (ADM-008, CMP-007): each hold opens review work that names
 * who is accountable for it, lists oldest first with what opened it, takes a note of what was checked, and
 * closes when a later release replaces its version or the version is withdrawn. Every row is synthetic,
 * and the test drives no daily check. It runs after the source controls' test (the runner sorts the files),
 * and processes the holds it made to the end, as the worker would, so no later step finds them pending.
 */
test(
  "review work names who is accountable, lists oldest first with what opened it and what was checked, and closes on a later release or a withdrawal",
  { skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only", timeout: 60_000 },
  async () => {
    const { assertDevelopmentRuntime } = await import("../../platform/valo-development-runtime");
    assertDevelopmentRuntime();
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL!).hostname));
    const { db, pool } = await import("@workspace/db");
    const { draftSynthetic } = await import("../../test-support/drafted-content");
    const review = await import("./source-review"),
      corrections = await import("./valo-source-corrections"),
      controls = await import("./valo-source-controls");
    const prefix = `synthetic-review-${randomUUID()}`;
    const staff = { identityId: `${prefix}-content`, recentMfa: true, verifiedAt: Date.now() };
    const system = { identityId: `${prefix}-system`, recentMfa: true, verifiedAt: Date.now() };
    const fresh = <T extends { verifiedAt: number }>(actor: T) => ({ ...actor, verifiedAt: Date.now() });
    try {
      for (const [actor, area] of [
        [staff, "content"],
        [system, "system"],
      ] as const)
        await db.execute(
          sql`insert into valo_staff_assignments(id,identity_id,role,active,granted_by,reason) values(${randomUUID()}::uuid,${actor.identityId},${area},true,'synthetic-ci','Controlled CI fixture only')`,
        );
      // A template version, and two versions of a rule the owner signed.
      const now = new Date(),
        b = heldSourceBundle(now),
        policyId = `${prefix}-unapproved`,
        contentId = randomUUID(),
        ruleKey = `${prefix}-rule`,
        [ruleOne, ruleTwo] = [randomUUID(), randomUUID()];
      b.candidate.id = prefix;
      await db.execute(
        sql`insert into valo_publication_policies(id,hash,policy,authority) values(${policyId},${digest(b.policy)},${JSON.stringify(b.policy)}::jsonb,'{"synthetic":true,"approved":false}')`,
      );
      await draftSynthetic((tx) =>
        tx.execute(sql`insert into valo_content_versions(id,template_id,version,slug,policy_id,candidate_hash,bundle,attestations,status,review_by)
        values(${contentId}::uuid,${prefix},1,${contentId},${policyId},${b.candidate.hash},${JSON.stringify(b)}::jsonb,'{}','candidate',${new Date(+now + 86400000)})`),
      );
      for (const [id, version] of [
        [ruleOne, 1],
        [ruleTwo, 2],
      ] as const)
        await db.execute(sql`insert into valo_rule_releases(id,rule_id,version,status,rule,publication_bundle,manifest_hash,published_at)
          values(${id}::uuid,${ruleKey},${version},'held',${JSON.stringify({ requirementVersionId: `${prefix}-${version}`, provenance: "synthetic_fixture" })}::jsonb,${JSON.stringify(b)}::jsonb,${digest(`${prefix}-${version}`)},${now})`);
      await db.execute(sql`insert into valo_rule_owner_signoffs(id,rule_id,version,manifest_hash,owner_identity_id,source_checked_at,confirmed_checks)
        values(${randomUUID()}::uuid,${ruleKey},1,${digest(`${prefix}-1`)},${`${prefix}-owner`},${now},'[]'::jsonb)`);
      // Two holds open review work, one after the other: a staff hold on the template, then a review date
      // on the rule. Each is its own transaction, so the queue's order is theirs.
      await db.transaction((tx) =>
        corrections.recordSourceImpact(tx, {
          kind: "content",
          id: contentId,
          reason: "Synthetic: a staff hold for the review check.",
          actor: staff.identityId,
          action: "hold",
          dedupe: `staff:${randomUUID()}`,
        }),
      );
      await db.transaction((tx) =>
        corrections.recordSourceImpact(tx, {
          kind: "rule",
          id: ruleOne,
          reason: "Synthetic: its review date passed.",
          actor: "system",
          action: "hold",
          dedupe: `review-due:rule:${ruleOne}`,
        }),
      );
      const mine = (queue: Awaited<ReturnType<typeof review.listSourceReview>>) =>
        queue.open.filter((row) => row.targetKey === prefix || row.targetKey === ruleKey);
      // Only an active Content editor reads the queue.
      await assert.rejects(review.listSourceReview(fresh(system)), /active role/);
      const [template, rule] = mine(await review.listSourceReview(fresh(staff)));
      assert.deepEqual(
        [template, rule].map((row) => [row?.targetKind, row?.opener, row?.accountable, row?.notes.length]),
        [
          ["content", "staff", "content", 0],
          ["rule", "review_due", "owner", 0],
        ],
      );
      // The owner's queue holds only the rules the owner signed.
      const owners = await review.reviewWorkQueue(db, { ownerOnly: true });
      assert.ok(owners.open.some((row) => row.id === rule!.id));
      assert.ok(!owners.open.some((row) => row.id === template!.id));
      // A note says what was checked, in 20 to 1,000 characters, on open work, by an active Content editor.
      await assert.rejects(
        async () => review.noteSourceReview(fresh(staff), template!.id, { note: "Too short." }),
        /20 to 1,000/,
      );
      await assert.rejects(async () =>
        review.noteSourceReview(fresh(staff), template!.id, { note: "x".repeat(30), extra: 1 }),
      );
      await assert.rejects(
        review.noteSourceReview(fresh(staff), randomUUID(), {
          note: "Synthetic: checked a row that is not there.",
        }),
        /not in the queue/,
      );
      await assert.rejects(
        review.noteSourceReview(fresh(system), template!.id, {
          note: "Synthetic: checked by someone else's area.",
        }),
        /active role/,
      );
      const noted = mine(
        await review.noteSourceReview(fresh(staff), template!.id, {
          note: "Synthetic: read the clause against the source; it still holds.",
        }),
      )[0]!;
      assert.deepEqual(
        noted.notes.map((note) => [note.note, note.recordedBy]),
        [["Synthetic: read the clause against the source; it still holds.", staff.identityId]],
      );
      // The database keeps every note, and takes one only on open work from an editor or the owner.
      await assert.rejects(
        pool.query("update valo_source_review_notes set note='Synthetic: a changed note for the check.'"),
        /never changed or removed/,
      );
      await assert.rejects(
        pool.query("delete from valo_source_review_notes where recorded_by=$1", [staff.identityId]),
        /never changed or removed/,
      );
      await assert.rejects(
        pool.query("insert into valo_source_review_notes(work_id,note,recorded_by) values($1,$2,$3)", [
          template!.id,
          "Synthetic: a note from someone not accountable.",
          system.identityId,
        ]),
        /An active content editor or the development owner is required/,
      );
      // A later release of the rule closes the review work of its earlier version, and says so.
      await db.transaction((tx) => corrections.closeSupersededReviewWork(tx, "rule", ruleKey, 2, ruleTwo));
      // Withdrawing the template closes its review work, the withdrawal's own row included.
      await controls.actOnSourceControls(fresh(staff), {
        action: "withdraw_version",
        kind: "content",
        id: contentId,
        version: 1,
        requestKey: randomUUID(),
        reason: "Synthetic: withdrawn to check that its review work closes.",
      });
      const after = await review.listSourceReview(fresh(staff));
      assert.deepEqual(mine(after), []);
      const closed = after.closed.filter((row) => row.targetKey === prefix || row.targetKey === ruleKey);
      const byText = (a: string, b: string) => a.localeCompare(b);
      assert.deepEqual(
        closed.map((row) => `${row.targetKey}:${row.outcome}`).sort(byText),
        [`${prefix}:withdrawn`, `${prefix}:withdrawn`, `${ruleKey}:superseded`].sort(byText),
      );
      const [replaced] = (
        await db.execute(sql`select w.replacement_kind,w.replacement_id from valo_source_review_work w
          join valo_source_impacts i on i.id=w.impact_id where i.target_id=${ruleOne}::uuid`)
      ).rows;
      assert.deepEqual(replaced, { replacement_kind: "rule", replacement_id: ruleTwo });
      // Closing review work releases nothing: the holds it was opened for stay.
      const holds = (
        await db.execute(
          sql`select count(*)::int as n from valo_source_impacts where target_id in (${contentId}::uuid,${ruleOne}::uuid)`,
        )
      ).rows[0]!;
      assert.equal(holds.n, 3);
      // Closed work takes no note.
      await assert.rejects(
        review.noteSourceReview(fresh(staff), template!.id, {
          note: "Synthetic: a note on closed review work.",
        }),
        /has closed/,
      );
      await assert.rejects(
        pool.query("insert into valo_source_review_notes(work_id,note,recorded_by) values($1,$2,$3)", [
          template!.id,
          "Synthetic: a note put straight into closed work.",
          staff.identityId,
        ]),
        /only on open review work/,
      );
      for (let n = 0; n < 200 && (await corrections.processSourceImpact()); n++);
    } finally {
      await pool.end();
    }
  },
);
