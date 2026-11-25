import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { sql } from "drizzle-orm";
import { digest, sha256 } from "@workspace/valo-core";
import type { ArtifactRef } from "../publication/publication-artifacts";

/**
 * docs/architecture/source-register.md, slice 4 (ADM-003, CMP-007): a Content editor asks, from an open
 * row of review work on a held template, for its next candidate. The worker takes a copy of the AI
 * provider's terms through a stand-in for the provider's pages, runs the template's preparer with its
 * mechanical checks, and the row then points at the prepared candidate, which waits for its two
 * reviews. Nothing calls a model, spends, sends or publishes. Every row is synthetic, and the stored
 * files are kept in memory. The test processes the holds it made to the end, as the worker would.
 */
test(
  "a Content editor asks for a held template's next candidate from its review work, and the worker prepares it with its checks and nothing sent or published",
  { skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only", timeout: 240_000 },
  async (t) => {
    const { assertDevelopmentRuntime } = await import("../../platform/valo-development-runtime");
    assertDevelopmentRuntime();
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL!).hostname));
    // The candidate's files are kept in memory, not in the private store.
    const files = new Map<string, Buffer>();
    t.mock.module(new URL("../publication/publication-artifacts.ts", import.meta.url).href, {
      namedExports: {
        putPublicationArtifact: async (bytes: Buffer, extension: ArtifactRef["extension"]) => {
          const id = randomUUID();
          files.set(id, Buffer.from(bytes));
          return { id, hash: sha256(bytes), extension };
        },
        getPublicationArtifact: async (ref: ArtifactRef) => {
          const bytes = files.get(ref.id);
          if (!bytes || sha256(bytes) !== ref.hash) throw Error("SYNTHETIC_ARTIFACT_CHANGED");
          return bytes;
        },
      },
    });
    const { db, pool } = await import("@workspace/db");
    const preparation = await import("./review-preparation");
    const corrections = await import("../sources/valo-source-corrections"),
      controls = await import("../sources/valo-source-controls"),
      review = await import("../sources/source-review");
    const { providerPermissionSentences } = await import("../publication/rights-applicability");
    const { heldSourceBundle } = await import("../sources/valo-source-controls.fixtures");
    // The provider's pages, made up from the sentences the permission record looks for. Nothing is fetched.
    const asked: string[] = [];
    const page =
      (change: (url: string, text: string) => string = (_url, text) => text) =>
      async (url: string) => {
        asked.push(url);
        const sentences = providerPermissionSentences.filter((s) => s.url === url).map((s) => s.quote);
        return {
          url,
          fetchedAt: new Date().toISOString(),
          rawChecksum: sha256(`bytes of ${url}`),
          text: change(url, `A page of the provider's terms.\n${sentences.join("\n")}\nMore of the page.`),
        };
      };
    const prefix = `synthetic-preparation-${randomUUID()}`;
    const staff = { identityId: `${prefix}-content`, recentMfa: true, verifiedAt: Date.now() };
    const system = { identityId: `${prefix}-system`, recentMfa: true, verifiedAt: Date.now() };
    const fresh = <T extends { verifiedAt: number }>(actor: T) => ({ ...actor, verifiedAt: Date.now() });
    const counts = async () =>
      (
        await db.execute(sql`select
          (select count(*)::int from valo_publication_ai_attempts) as attempts,
          (select count(*)::int from valo_inference_budgets) as budgets,
          (select count(*)::int from valo_inference_budget_events) as events,
          (select count(*)::int from valo_content_versions where template_id in ('TPL-10','TPL-11') and status='published') as published`)
      ).rows[0];
    try {
      for (const [actor, area] of [
        [staff, "content"],
        [system, "system"],
      ] as const)
        await db.execute(
          sql`insert into valo_staff_assignments(id,identity_id,role,active,granted_by,reason) values(${randomUUID()}::uuid,${actor.identityId},${area},true,'synthetic-ci','Controlled CI fixture only')`,
        );
      // Held versions: of two templates the preparer serves, of a template it does not, and of a rule.
      const now = new Date(),
        b = heldSourceBundle(now),
        policyId = `${prefix}-unapproved`;
      await db.execute(
        sql`insert into valo_publication_policies(id,hash,policy,authority) values(${policyId},${digest(b.policy)},${JSON.stringify(b.policy)}::jsonb,'{"synthetic":true,"approved":false}')`,
      );
      const version = async (templateId: string) => {
        const id = randomUUID();
        await db.execute(sql`insert into valo_content_versions(id,template_id,version,slug,policy_id,candidate_hash,bundle,attestations,status,review_by)
          values(${id}::uuid,${templateId},1,${id},${policyId},${b.candidate.hash},${JSON.stringify(b)}::jsonb,'{}','candidate',${new Date(+now + 86400000)})`);
        return id;
      };
      const [template, other, unserved] = [
        await version("TPL-10"),
        await version("TPL-11"),
        await version(prefix),
      ];
      const ruleId = randomUUID();
      await db.execute(sql`insert into valo_rule_releases(id,rule_id,version,status,rule,publication_bundle,manifest_hash,published_at)
        values(${ruleId}::uuid,${`${prefix}-rule`},1,'held',${JSON.stringify({ requirementVersionId: `${prefix}-1`, provenance: "synthetic_fixture" })}::jsonb,${JSON.stringify(b)}::jsonb,${digest(`${prefix}-1`)},${now})`);
      const hold = (kind: "content" | "rule", id: string) =>
        db.transaction((tx) =>
          corrections.recordSourceImpact(tx, {
            kind,
            id,
            reason: "Synthetic: a staff hold for the preparation check.",
            actor: staff.identityId,
            action: "hold",
            dedupe: `staff:${randomUUID()}`,
          }),
        );
      for (const [kind, id] of [
        ["content", template],
        ["content", other],
        ["content", unserved],
        ["rule", ruleId],
      ] as const)
        await hold(kind, id);
      const queue = () => review.listSourceReview(fresh(staff), { preparable: preparation.reviewPreparable });
      const row = async (key: string, kind = "content") =>
        (await queue()).open.find((item) => item.targetKind === kind && item.targetKey === key)!;
      const [onTemplate, onOther, onUnserved, onRule] = [
        await row("TPL-10"),
        await row("TPL-11"),
        await row(prefix),
        await row(`${prefix}-rule`, "rule"),
      ];
      // Only a template or guide that has a preparer can be prepared from.
      assert.deepEqual(
        [onTemplate, onOther, onUnserved, onRule].map((item) => [item.preparable, item.preparation]),
        [
          [true, null],
          [true, null],
          [false, null],
          [false, null],
        ],
      );
      assert.deepEqual(["TPL-10", "GUIDE-C01", "GUD-01", "TPL-16", prefix].map(preparation.reviewPreparer), [
        "template",
        "template",
        "guide",
        null,
        null,
      ]);
      const before = await counts();

      // Only an active Content editor asks, and only on open work on a template or guide with a preparer.
      await assert.rejects(preparation.requestReviewPreparation(fresh(system), onTemplate.id), /active role/);
      await assert.rejects(
        preparation.requestReviewPreparation(fresh(staff), randomUUID()),
        /not in the queue/,
      );
      for (const item of [onUnserved, onRule])
        await assert.rejects(
          preparation.requestReviewPreparation(fresh(staff), item.id),
          /only for a template or guide that has a preparer/,
        );
      const waiting = (await preparation.requestReviewPreparation(fresh(staff), onTemplate.id)).open.find(
        (item) => item.id === onTemplate.id,
      )!;
      assert.equal(waiting.preparation?.status, "pending");
      assert.equal(waiting.preparation?.requestedBy, staff.identityId);
      // One request at a time waits or runs for a row.
      await assert.rejects(
        preparation.requestReviewPreparation(fresh(staff), onTemplate.id),
        /already being prepared/,
      );

      // The worker takes the provider's terms and prepares the next version with its checks.
      assert.equal(await preparation.prepareRequestedCandidates({ readPage: page() }), true);
      assert.deepEqual(asked, [...new Set(providerPermissionSentences.map((s) => s.url))]);
      const prepared = (await row("TPL-10")).preparation!;
      assert.equal(prepared.status, "prepared", JSON.stringify(prepared));
      assert.equal(prepared.candidateVersion, 2);
      assert.deepEqual(prepared.reasons, []);
      const [record] = (
        await db.execute(sql`select p.candidate_artifact_id,c.template_id,c.version,c.artifact_hash
          from valo_source_review_preparations p join valo_prepared_candidates c on c.artifact_id=p.candidate_artifact_id
          where p.work_id=${onTemplate.id}::uuid`)
      ).rows;
      assert.equal(record?.template_id, "TPL-10");
      assert.equal(record?.version, 2);
      // The candidate waits for its two reviews: none was asked for, and it is not eligible to publish.
      const candidate = JSON.parse(files.get(String(record?.candidate_artifact_id))!.toString());
      assert.equal(candidate.kind, "valo-prepared-candidate-v1");
      assert.equal(candidate.templateId, "TPL-10");
      assert.deepEqual(candidate.bundle.reviews, []);
      assert.equal(candidate.bundle.manifest.status, "review");
      // Nothing was sent to a model, spent or published, and the row stays open: a release closes it.
      assert.deepEqual(await counts(), before);
      assert.ok((await queue()).open.some((item) => item.id === onTemplate.id));
      // With no request waiting, the worker does nothing.
      assert.equal(await preparation.prepareRequestedCandidates({ readPage: page() }), false);

      // A copy of the terms that no longer holds a sentence the permission record looks for stops the
      // preparation, and nothing is kept.
      await preparation.requestReviewPreparation(fresh(staff), onTemplate.id);
      const kept = Number(
        (
          await db.execute(
            sql`select count(*)::int as n from valo_prepared_candidates where template_id='TPL-10'`,
          )
        ).rows[0]!.n,
      );
      const [changed] = [...new Set(providerPermissionSentences.map((s) => s.url))];
      assert.equal(
        await preparation.prepareRequestedCandidates({
          readPage: page((url, text) =>
            url === changed
              ? text.replaceAll(providerPermissionSentences.find((s) => s.url === url)!.quote, "")
              : text,
          ),
        }),
        true,
      );
      const stopped = (await row("TPL-10")).preparation!;
      assert.equal(stopped.status, "failed");
      assert.deepEqual(stopped.reasons, [`PROVIDER_TERMS_SENTENCE_MISSING:${changed}`]);
      assert.equal(
        Number(
          (
            await db.execute(
              sql`select count(*)::int as n from valo_prepared_candidates where template_id='TPL-10'`,
            )
          ).rows[0]!.n,
        ),
        kept,
      );

      // A run that stopped without finishing is tried again after its lease, at most three times.
      await preparation.requestReviewPreparation(fresh(staff), onOther.id);
      await db.execute(sql`update valo_source_review_preparations set status='running',attempts=3,
        lease_until=now()-interval '1 minute' where work_id=${onOther.id}::uuid and status='pending'`);
      assert.equal(await preparation.prepareRequestedCandidates({ readPage: page() }), true);
      const exhausted = (await row("TPL-11")).preparation!;
      assert.deepEqual([exhausted.status, exhausted.reasons], ["failed", ["PREPARATION_ATTEMPTS_EXHAUSTED"]]);

      // A request whose review work closed before its turn prepares nothing.
      await preparation.requestReviewPreparation(fresh(staff), onTemplate.id);
      await controls.actOnSourceControls(fresh(staff), {
        action: "withdraw_version",
        kind: "content",
        id: template,
        version: 1,
        requestKey: randomUUID(),
        reason: "Synthetic: withdrawn to check that a waiting preparation prepares nothing.",
      });
      asked.length = 0;
      assert.equal(await preparation.prepareRequestedCandidates({ readPage: page() }), true);
      assert.deepEqual(asked, []);
      const [closed] = (
        await db.execute(sql`select status,candidate_artifact_id from valo_source_review_preparations
          where work_id=${onTemplate.id}::uuid order by requested_at desc limit 1`)
      ).rows;
      assert.deepEqual(closed, { status: "closed", candidate_artifact_id: null });
      // A finished request is never changed or removed.
      await assert.rejects(
        pool.query("update valo_source_review_preparations set status='pending' where work_id=$1", [
          onTemplate.id,
        ]),
        /never changes/,
      );
      await assert.rejects(
        pool.query("delete from valo_source_review_preparations where work_id=$1", [onTemplate.id]),
        /never removed/,
      );
      assert.deepEqual(await counts(), before);
      for (let n = 0; n < 200 && (await corrections.processSourceImpact()); n++);
    } finally {
      await pool.end();
    }
  },
);
