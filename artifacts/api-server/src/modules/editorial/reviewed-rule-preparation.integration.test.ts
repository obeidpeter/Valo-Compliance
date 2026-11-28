import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { evaluatePublication, sha256, type PublicationBundle } from "@workspace/valo-core";
import type { ArtifactRef } from "../publication/publication-artifacts";

/**
 * A rule prepared in the repository, prepared for the reviewed route on a real database
 * (docs/architecture/reviewed-route.md, part 3, slice 3a): built from today's capture of its official
 * source, its sheet rendered as Word and PDF and inspected, and kept as a prepared candidate on
 * drafting's own login; and, when anything but its two reviews holds it, nothing kept at all.
 *
 * What stands in is said where it is made. Private storage is a map in memory. Today's capture of the
 * Act is the retained passage, under the checksum its amendment record describes. The rights record
 * for this route is a synthetic one, since the owner has chosen none. The rule, its sources' records
 * and the guidance policy are the real ones. Nothing calls a model, and nothing is released.
 */
test(
  "a rule prepared in the repository is kept for its two reviews only when nothing else holds it",
  { skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only", timeout: 240_000 },
  async (t) => {
    assert.equal(process.env.NODE_ENV, "development");
    assert.ok(!process.env.REPLIT_DEPLOYMENT);
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL!).hostname));

    // Private storage, in memory.
    const stored = new Map<string, Buffer>();
    const put = async (bytes: Buffer, extension: ArtifactRef["extension"]): Promise<ArtifactRef> => {
      const ref = { id: randomUUID(), hash: sha256(bytes), extension };
      stored.set(ref.id, Buffer.from(bytes));
      return ref;
    };
    const get = async (ref: ArtifactRef) => {
      const bytes = stored.get(ref.id);
      if (!bytes || sha256(bytes) !== ref.hash) throw Error("PUBLICATION_ASSET_HASH_MISMATCH");
      return bytes;
    };
    t.mock.module(new URL("../publication/publication-artifacts.ts", import.meta.url).href, {
      namedExports: { putPublicationArtifact: put, getPublicationArtifact: get },
    });

    const { db } = await import("@workspace/db");
    const { ownerRuleCandidates } = await import("./owner-rule-candidates");
    const { prepareReviewedRuleCandidate } = await import("./reviewed-rule-preparation");
    const { REVIEWED_ROUTE_RIGHTS_MISSING, RULE_SHEET_NOTICE, ruleSheet } = await import("./reviewed-rule");
    const { guideAmendmentRecords } = await import("../publication/guidance-amendments");
    const { retainedGuidePassages } = await import("../publication/guidance-passages");
    const { guideOpenReasons } = await import("../publication/guidance-release");
    const { inspectOperationalExports } = await import("../publication/operational-export-inspection");
    const { readPreparedCandidate } = await import("../publication/prepared-candidate");

    const now = new Date(),
      checkedAt = new Date(+now - 3_600_000).toISOString();
    const businessName = ownerRuleCandidates.find((c) => c.rule.id === "cac-business-name-814")!;
    const evidence = "Synthetic rights record for a test of the reviewed route; not the owner's choice.";
    const withRights = {
      ...businessName,
      reviewedRouteRights: {
        status: "cleared" as const,
        evidence,
        evidenceHash: sha256(evidence),
        commercialUse: true,
      },
    };
    // Today's capture of the Act the rule quotes: the retained passage, as a capture checked an hour
    // ago would hold it, under the checksum of the file the Act's amendment record describes.
    const passage = retainedGuidePassages()("CAMA-814")!;
    const record = guideAmendmentRecords.find((r) => r.instrument === passage.instrument.id)!;
    const text = `Front matter.\n\f\n${passage.text}\n\f\nMore of the Act.`;
    const capture = {
      leadId: "SV-010",
      url: passage.instrument.url,
      snapshotId: randomUUID(),
      checkedAt,
      rawChecksum: record.rawSha256,
      textChecksum: sha256(text),
      text,
    };
    const rows = async () =>
      (
        await db.execute<{ version_id: string; template_id: string; version: number }>(
          sql`select version_id, template_id, version from valo_prepared_candidates where template_id = 'CAC-BUSINESS-NAME-814'`,
        )
      ).rows;
    const before = await rows();
    const latest = Number(
      (
        await db.execute<{ version: number }>(
          sql`select coalesce(max(version), 0)::int as version from valo_rule_releases where rule_id = 'cac-business-name-814'`,
        )
      ).rows[0]!.version,
    );

    // 1. Held: with no rights record for this route, the rule waits on the owner. Nothing is kept.
    const held = await prepareReviewedRuleCandidate("cac-business-name-814", { captures: [capture], now });
    assert.equal(held.state, "held");
    assert.ok(held.reasons.includes(REVIEWED_ROUTE_RIGHTS_MISSING), held.reasons.join("; "));
    assert.ok(held.reasons.includes("rights_not_cleared"));
    assert.equal(held.candidateArtifact, null);
    assert.deepEqual(await rows(), before, "no row is added");
    assert.equal(stored.size, 0, "and nothing is stored");

    // Held too, with a rights record for this route, when no copy of the source was checked within the
    // last day. Nothing is kept.
    const uncaptured = await prepareReviewedRuleCandidate("cac-business-name-814", {
      candidates: [withRights],
      captures: [],
      now,
    });
    assert.equal(uncaptured.state, "held");
    assert.ok(
      uncaptured.reasons.some((r) =>
        /has no copy of its official source checked within the last day/.test(r),
      ),
      uncaptured.reasons.join("; "),
    );
    assert.deepEqual(await rows(), before);
    assert.equal(stored.size, 0);

    // 2. Kept: with the rights record and today's capture, only the two reviews hold the rule. Its
    // candidate is a private artifact, with a row that lets staff find it, made on drafting's login.
    const kept = await prepareReviewedRuleCandidate("cac-business-name-814", {
      candidates: [withRights],
      captures: [capture],
      now,
    });
    assert.equal(kept.state, "awaiting_reviews", kept.reasons.join("; "));
    assert.ok(kept.candidateArtifact && kept.id);
    assert.equal(kept.version, latest + 1, "the next version after every one stored");
    assert.deepEqual(kept.failedChecks, []);
    t.after(async () => {
      // The row is this test's own; it is taken away again.
      await db.execute(sql`delete from valo_prepared_candidates where version_id = ${kept.id}::uuid`);
    });
    assert.deepEqual(
      (await rows()).filter((r) => r.version_id === kept.id).map((r) => [r.template_id, r.version]),
      [["CAC-BUSINESS-NAME-814", latest + 1]],
    );
    const candidate = await readPreparedCandidate(kept.candidateArtifact);
    assert.equal(candidate.templateId, "CAC-BUSINESS-NAME-814");
    assert.equal(candidate.slug, "cac-business-name-814");
    assert.equal(candidate.candidateHash, kept.candidateHash);
    const bundle = candidate.bundle as PublicationBundle;
    assert.deepEqual(bundle.reviews, []);
    assert.equal(bundle.manifest.status, "review");
    assert.deepEqual(guideOpenReasons(evaluatePublication(bundle, now)), []);
    const attestations = candidate.attestations as {
      sourceSnapshots: Record<string, string>;
      exports: { docx: ArtifactRef; pdf: ArtifactRef };
      exportReport: ArtifactRef;
    };
    assert.deepEqual(attestations.sourceSnapshots, { "cama-814": capture.snapshotId });

    // Its two files hold the whole sheet, and reading them again finds what the preparation found.
    const rule = JSON.parse(bundle.candidate.body);
    const files = {
      docx: await get(attestations.exports.docx),
      pdf: await get(attestations.exports.pdf),
    };
    const again = await inspectOperationalExports(
      bundle.candidate,
      files,
      RULE_SHEET_NOTICE,
      ruleSheet(rule, bundle.candidate),
    );
    assert.equal(again.passed, true);
    assert.deepEqual(again, JSON.parse((await get(attestations.exportReport)).toString()));
    assert.deepEqual(
      bundle.exports.map((e) => [e.format, e.fileHash]),
      [
        ["docx", sha256(files.docx)],
        ["pdf", sha256(files.pdf)],
      ],
    );
  },
);
