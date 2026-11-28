import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { sql } from "drizzle-orm";
import { digest, sha256 } from "@workspace/valo-core";
import type { ArtifactRef } from "../publication/publication-artifacts";

/**
 * docs/architecture/reviewed-route.md, part 4, and source-register.md, slice 4 (ADM-003, CMP-007): a
 * Content editor asks, from the open review work of a held version of a template that states the law,
 * for its next candidate, and the worker prepares it with that template's own preparer, from the daily
 * check's captures of its sources.
 *
 * Three things are stood in for, as in the route's own test (law-template-route.integration.test.ts),
 * and the test says so where it does it. Private storage is a map in memory. The Data Protection Act's
 * words are not kept in the repository, so TPL-31's passages, and the daily check's captures of its two
 * sources, are stand-ins that carry the identity the repository's own amendment records describe. And
 * the owner has approved no text of the policy for templates that state the law, so the test supposes
 * that approval, under a policy version of its own, only where it says so. The provider's pages are made
 * up from the sentences the permission record looks for: nothing is fetched. Nothing calls a model,
 * spends, sends or publishes.
 *
 * It keeps a held version of TPL-31 and the candidate prepared from it, so it runs last in its group:
 * the law templates' tests before it check that no version of TPL-31 exists.
 */
test(
  "review work on a held template that states the law prepares its next candidate with that template's own preparer, from the daily check's captures of its sources",
  { skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only", timeout: 300_000 },
  async (t) => {
    const { assertDevelopmentRuntime } = await import("../../platform/valo-development-runtime");
    assertDevelopmentRuntime();
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL!).hostname));

    // Private storage, in memory.
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

    // The policy: the owner has approved no text of it. Only while `approval.supposed` is set, the test
    // supposes an approval of the file as it stands, under a version of its own that the real policy
    // never meets.
    const real = await import("../publication/template-law-policy");
    const { publicationWorkspaceRoot } = await import("../publication/operational-policy");
    const policyFile = readFileSync(
      resolve(publicationWorkspaceRoot(), real.TEMPLATE_LAW_POLICY_PATH),
      "utf8",
    );
    assert.equal(real.templateLawPolicyApprovedHash(), null, "the owner has approved no text of the policy");
    const withSupposedApproval = async (options: Parameters<typeof real.templateLawPolicy>[0] = {}) => {
      const base = await real.templateLawPolicy({ ...options, approvedHash: sha256(policyFile) });
      const { hash: _approvedVersionHash, ...body } = base.policy;
      const supposed = { ...body, version: `${body.version}/approval-supposed-in-a-test` };
      return { policy: { ...supposed, hash: digest(supposed) }, authority: base.authority };
    };
    const approval = { supposed: false };
    t.mock.module(new URL("../publication/template-law-policy.ts", import.meta.url).href, {
      namedExports: {
        ...real,
        templateLawPolicy: (options?: Parameters<typeof real.templateLawPolicy>[0]) =>
          approval.supposed ? withSupposedApproval(options) : real.templateLawPolicy(options),
      },
    });

    // The captures: only while `captured.today` is set, the daily check holds a capture of each of the
    // template's two sources, read an hour ago, whose words are the stand-in passages. Otherwise both are
    // read as the code reads them.
    const fixtures = await import("../publication/template-law-release.fixtures");
    const captures = await import("../publication/guidance-captures");
    const current = await import("../sources/source-current-captures");
    const { retainedGuidePassages } = await import("../publication/guidance-passages");
    const captured = { today: false };
    const readAt = new Date(Date.now() - 3_600_000).toISOString();
    const retained = retainedGuidePassages();
    const texts = new Map<string, { url: string; rawChecksum: string; parts: string[] }>();
    for (const [id, words] of Object.entries(fixtures.standInWords)) {
      const passage = fixtures.lawTemplateStandIn(id, words, readAt, "recorded");
      const leadId = captures.passageLead(id, retained)!;
      assert.ok(passage.instrument.rawSha256, id);
      const held = texts.get(leadId) ?? {
        url: passage.instrument.url,
        rawChecksum: passage.instrument.rawSha256,
        parts: [] as string[],
      };
      held.parts.push(words);
      texts.set(leadId, held);
    }
    const todays = [...texts].map(([leadId, held]) => {
      const text = held.parts.join("\n\f\n");
      return {
        leadId,
        url: held.url,
        snapshotId: randomUUID(),
        checkedAt: readAt,
        rawChecksum: held.rawChecksum,
        textChecksum: sha256(text),
        text,
      };
    });
    t.mock.module(new URL("../publication/guidance-captures.ts", import.meta.url).href, {
      namedExports: {
        ...captures,
        capturedGuidePassages: (...args: Parameters<typeof captures.capturedGuidePassages>) =>
          captured.today
            ? fixtures.lawTemplateStandIns(readAt, fixtures.standInWords, "recorded")
            : captures.capturedGuidePassages(...args),
      },
    });
    t.mock.module(new URL("../sources/source-current-captures.ts", import.meta.url).href, {
      namedExports: {
        ...current,
        currentSourceCaptures: async (...args: Parameters<typeof current.currentSourceCaptures>) =>
          captured.today
            ? todays.filter((capture) => args[0].includes(capture.leadId))
            : current.currentSourceCaptures(...args),
      },
    });

    const { db, pool } = await import("@workspace/db");
    const { draftSynthetic } = await import("../../test-support/drafted-content");
    const preparation = await import("./review-preparation");
    const corrections = await import("../sources/valo-source-corrections"),
      review = await import("../sources/source-review");
    const { providerPermissionSentences } = await import("../publication/rights-applicability");
    const { lawTemplatePassageIds } = await import("../publication/template-law-maps");
    const { heldSourceBundle } = await import("../sources/valo-source-controls.fixtures");
    // The provider's pages, made up from the sentences the permission record looks for.
    const page = async (url: string) => ({
      url,
      fetchedAt: new Date().toISOString(),
      rawChecksum: sha256(`bytes of ${url}`),
      text: `A page of the provider's terms.\n${providerPermissionSentences
        .filter((s) => s.url === url)
        .map((s) => s.quote)
        .join("\n")}\nMore of the page.`,
    });
    const template = "TPL-31";
    const prefix = `synthetic-law-preparation-${randomUUID()}`;
    const staff = { identityId: `${prefix}-content`, recentMfa: true, verifiedAt: Date.now() };
    const fresh = () => ({ ...staff, verifiedAt: Date.now() });
    const counts = async () =>
      (
        await db.execute(sql`select
          (select count(*)::int from valo_publication_ai_attempts) as attempts,
          (select count(*)::int from valo_inference_budgets) as budgets,
          (select count(*)::int from valo_inference_budget_events) as events,
          (select count(*)::int from valo_content_versions where template_id=${template} and status='published') as published,
          (select count(*)::int from valo_prepared_candidates where template_id=${template}) as kept`)
      ).rows[0]!;
    try {
      await db.execute(
        sql`insert into valo_staff_assignments(id,identity_id,role,active,granted_by,reason) values(${randomUUID()}::uuid,${staff.identityId},'content',true,'synthetic-ci','Controlled CI fixture only')`,
      );
      // A held version of TPL-31, the next it has.
      const now = new Date(),
        b = heldSourceBundle(now),
        policyId = `${prefix}-unapproved`;
      await db.execute(
        sql`insert into valo_publication_policies(id,hash,policy,authority) values(${policyId},${digest(b.policy)},${JSON.stringify(b.policy)}::jsonb,'{"synthetic":true,"approved":false}')`,
      );
      const next = Number(
        (
          await db.execute(
            sql`select coalesce(max(version),0)::int+1 as next from valo_content_versions where template_id=${template}`,
          )
        ).rows[0]!.next,
      );
      const held = randomUUID();
      await draftSynthetic((tx) =>
        tx.execute(sql`insert into valo_content_versions(id,template_id,version,slug,policy_id,candidate_hash,bundle,attestations,status,review_by)
          values(${held}::uuid,${template},${next},${held},${policyId},${b.candidate.hash},${JSON.stringify(b)}::jsonb,'{}','candidate',${new Date(+now + 86400000)})`),
      );
      await db.transaction((tx) =>
        corrections.recordSourceImpact(tx, {
          kind: "content",
          id: held,
          reason: "Synthetic: a staff hold for the preparation of a template that states the law.",
          actor: staff.identityId,
          action: "hold",
          dedupe: `staff:${randomUUID()}`,
        }),
      );
      const queue = () => review.listSourceReview(fresh(), { preparable: preparation.reviewPreparable });
      const row = async () =>
        (await queue()).open.find(
          (item) =>
            item.targetKind === "content" && item.targetKey === template && item.targetVersion === next,
        )!;
      const work = await row();
      assert.deepEqual([work.preparable, work.preparation], [true, null]);
      const before = await counts();
      // A Content editor asks; the worker takes the request and settles it.
      const ask = async () => {
        await preparation.requestReviewPreparation(fresh(), work.id);
        assert.equal(await preparation.prepareRequestedCandidates({ readPage: page }), true);
        return (await row()).preparation!;
      };

      // 1. The daily check holds no capture of either source the template's passages are read from, so
      // its preparer binds nothing and stops with the code its own command prints, which no other
      // preparer gives. Nothing is kept.
      const leads = [
        ...new Set(lawTemplatePassageIds(template).flatMap((passage) => captures.passageLead(passage) ?? [])),
      ];
      assert.deepEqual(leads, ["S04", "S05"]);
      assert.deepEqual(await current.currentSourceCaptures(leads), []);
      const unbound = await ask();
      assert.deepEqual([unbound.status, unbound.reasons], ["failed", ["TEMPLATE_HAS_NO_BOUND_SOURCE"]]);
      assert.deepEqual(await counts(), before);

      // 2. With today's captures of both sources, the template is built from them as its next version.
      // No text of its policy is approved, so it is not ready, and nothing is kept.
      captured.today = true;
      const unapproved = await ask();
      assert.equal(unapproved.status, "not_ready", JSON.stringify(unapproved));
      assert.equal(unapproved.candidateVersion, next + 1);
      assert.ok(unapproved.reasons.includes("policy_not_owner_approved"), unapproved.reasons.join(", "));
      assert.deepEqual(await counts(), before);

      // 3. Under the supposed approval, nothing but its two reviews holds it: the candidate is kept for
      // them, and the request names it.
      approval.supposed = true;
      const prepared = await ask();
      assert.equal(prepared.status, "prepared", JSON.stringify(prepared));
      assert.equal(prepared.candidateVersion, next + 1);
      assert.deepEqual(prepared.reasons, []);
      const [record] = (
        await db.execute(sql`select p.candidate_artifact_id,c.template_id,c.version
          from valo_source_review_preparations p join valo_prepared_candidates c on c.artifact_id=p.candidate_artifact_id
          where p.work_id=${work.id}::uuid`)
      ).rows;
      assert.equal(record?.template_id, template);
      assert.equal(record?.version, next + 1);
      const candidate = JSON.parse(files.get(String(record?.candidate_artifact_id))!.toString());
      assert.equal(candidate.kind, "valo-prepared-candidate-v1");
      assert.equal(candidate.templateId, template);
      assert.equal(candidate.version, next + 1);
      // Prepared under the policy for templates that state the law, from the captures of its sources.
      assert.equal(candidate.policyId, (await withSupposedApproval()).policy.version);
      assert.equal(candidate.bundle.candidate.sourceCheckDate, readAt);
      // It waits for its two reviews: none was asked for, and it is not eligible to publish.
      assert.deepEqual(candidate.bundle.reviews, []);
      assert.equal(candidate.bundle.manifest.status, "review");
      // Nothing was sent to a model, spent or published. The one row added lets staff find the
      // candidate, and the review work stays open: a release closes it.
      assert.deepEqual(await counts(), { ...before, kept: Number(before.kept) + 1 });
      assert.ok((await queue()).open.some((item) => item.id === work.id));
      approval.supposed = false;
      captured.today = false;
      for (let n = 0; n < 200 && (await corrections.processSourceImpact()); n++);
    } finally {
      await pool.end();
    }
  },
);
