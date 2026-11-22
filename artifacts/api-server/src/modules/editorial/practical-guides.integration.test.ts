import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import {
  digest,
  evaluatePublication,
  practicalGuideIds,
  sha256,
  type PublicationBundle,
} from "@workspace/valo-core";
import type { ArtifactRef } from "../publication/publication-artifacts";
import type { ReleaseAttestations } from "../publication/publication-publisher";

test(
  "invoice and quotation reach only their blind reviews and the publisher rechecks their articles and exports",
  {
    skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only",
    timeout: 180000,
  },
  async (t) => {
    assert.equal(process.env.NODE_ENV, "development");
    assert.ok(!process.env.REPLIT_DEPLOYMENT);
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL!).hostname));
    const files = new Map<string, Buffer>();
    const put = async (bytes: Buffer, extension: ArtifactRef["extension"]) => {
      const id = randomUUID();
      files.set(id, Buffer.from(bytes));
      return { id, hash: sha256(bytes), extension };
    };
    const get = async (ref: ArtifactRef) => {
      const bytes = files.get(ref.id);
      if (!bytes || sha256(bytes) !== ref.hash) throw Error("SYNTHETIC_ARTIFACT_CHANGED");
      return bytes;
    };
    t.mock.module(new URL("../publication/publication-artifacts.ts", import.meta.url).href, {
      namedExports: { putPublicationArtifact: put, getPublicationArtifact: get },
    });
    const { db, pool, valoContentVersions } = await import("@workspace/db");
    const { prepareOperationalCandidateRelease } = await import("./operational-preparation");
    const { readOperationalInferenceReadiness } = await import("../ai-lanes/inference-operational-ready");
    const { saveOperationalReviewPlan } = await import("./operational-review");
    const { assertFiniteWorkBindings } = await import("../ai-lanes/inference-work-bindings");
    const { prepareOperationalFiniteManifest } = await import("../ai/inference-manifest");
    const {
      prepareFiniteAllocationPackage,
      finitePackagePreparers,
      assertWorkPackageMembership,
      practicalReviewLimits,
    } = await import("../ai/inference-allocation-package");
    const { validateOperationalVersionInTransaction } = await import("../publication/publication-publisher");
    const { projectReleasedResource, projectReleasedCatalogue, releaseVisible, releasedResources } =
      await import("../catalogue/valo-released-content");
    const { currentOperationalPermission } = await import("../publication/operational-read-permission");
    const { readPracticalGuideIntake, practicalGuideSlug } = await import("../publication/practical-guide");
    const { candidateArithmetic } = await import("../publication/candidate-arithmetic");
    const { controlledTermsSnapshot } = await import("../publication/guidance-release.fixtures");
    const now = new Date();
    const folder = await mkdtemp(join(tmpdir(), "valo-practical-articles-"));
    const snapshot = join(folder, "terms.json");
    await writeFile(snapshot, JSON.stringify(controlledTermsSnapshot(now)));
    t.after(async () => {
      await rm(folder, { recursive: true, force: true });
      await pool.end();
    });
    const pkg = await prepareFiniteAllocationPackage(now, finitePackagePreparers.practicalPairs);
    const templates = await prepareFiniteAllocationPackage(now);
    const regulatory = await prepareFiniteAllocationPackage(now, finitePackagePreparers.guidePairs);
    assert.equal(practicalReviewLimits.maximumCalls, 4);
    assert.equal(practicalReviewLimits.maximumReservationNanoUsd, "1482201600");
    await assert.rejects(prepareOperationalCandidateRelease("GUIDE-C03", snapshot), /PREPARER_UNAVAILABLE/);

    for (const id of practicalGuideIds) {
      await t.test(id, async () => {
        const draft = await readPracticalGuideIntake(id);
        const result = await prepareOperationalCandidateRelease(id, snapshot);
        assert.equal(
          result.release.decision,
          "awaiting_reviews",
          JSON.stringify({
            cause: result.providerFailure,
            gate: result.eligibility.reasons,
            exports: result.exportReport,
          }),
        );
        assert.ok(result.candidateArtifact);
        const binding = { candidateVersionId: result.id, candidateArtifact: result.candidateArtifact };
        try {
          const current = await readOperationalInferenceReadiness(binding);
          const candidate = current.candidate;
          assert.equal(candidate.contentClass, "practical_guide");
          assert.deepEqual(current.bundle.sources, []);
          assert.equal(candidate.risk, "general");
          assert.deepEqual(current.bundle.reviews, []);
          assert.deepEqual([...result.eligibility.reasons].sort(), [
            "manifest_not_eligible",
            "review_required:challenge",
            "review_required:factual",
          ]);
          assert.ok(!candidate.body.includes("Suggested related template"));
          const alteredBody =
            id === "GUIDE-C01"
              ? candidate.body.replace("₦6,000", "₦5,000")
              : candidate.body.replace("200 A5", "201 A5");
          assert.equal(candidateArithmetic({ ...candidate, body: alteredBody }).pass, false);
          const plan = await saveOperationalReviewPlan(
            candidate,
            current.rightsInput,
            current.provenanceInput,
            current.exportReport,
            current.serverEvidence,
          );
          const manifest = prepareOperationalFiniteManifest({
            ...binding,
            candidateHash: candidate.hash,
            bundleHash: digest(current.bundle),
            sourceHashes: [],
            sourceFiles: [
              { path: current.provenanceInput.sourcePath, sha256: current.serverEvidence.sourceHash },
            ],
            plan,
          });
          for (const work of manifest.works) {
            await assertFiniteWorkBindings(work);
            assertWorkPackageMembership(work, pkg, id);
            for (const other of [templates, regulatory])
              assert.throws(() => assertWorkPackageMembership(work, other, id), /WORK_OUTSIDE_PACKAGE/);
            assert.throws(
              () => assertWorkPackageMembership({ ...work, retryOf: work.key }, pkg, id),
              /WORK_OUTSIDE_PACKAGE/,
            );
            assert.throws(
              () => assertWorkPackageMembership(work, pkg, id === "GUIDE-C01" ? "GUIDE-C02" : "GUIDE-C01"),
              /WORK_OUTSIDE_PACKAGE/,
            );
          }
          // These two private records are test fixtures. No provider is called and the transaction rolls back.
          const evidenceHash = digest(current.bundle.sources);
          const records = plan.entries.map((entry) => ({
            role: entry.role,
            candidateHash: candidate.hash,
            evidenceHash,
            providerResponseId: "synthetic-" + randomUUID(),
            model: "synthetic-test-only",
            promptVersion: entry.promptVersion,
            receivedOtherVerdict: false,
            serverEvidence: current.serverEvidence,
            output: { verdict: "pass" as const, findings: [], missingEvidence: [], observations: [] },
          }));
          const refs = await Promise.all(
            records.map((record) => put(Buffer.from(JSON.stringify(record)), "json")),
          );
          const reviewed: PublicationBundle = {
            ...current.bundle,
            reviews: records.map((record) => ({
              runId: record.providerResponseId,
              model: record.model,
              promptVersion: record.promptVersion,
              candidateHash: candidate.hash,
              evidenceHash,
              role: record.role,
              verdict: "pass",
              findings: [],
              receivedOtherVerdict: false,
            })),
          };
          reviewed.manifest = {
            ...reviewed.manifest,
            status: "eligible",
            reviewHash: digest({ draft: reviewed.draftRun, reviews: reviewed.reviews }),
          };
          assert.equal(evaluatePublication(reviewed).decision, "eligible");
          assert.equal(
            evaluatePublication({
              ...reviewed,
              candidate: { ...candidate, contentClass: "sourced_guidance" },
            }).decision,
            "hold",
          );
          const check = async (reviews: ArtifactRef[]) =>
            db.transaction(async (tx) => {
              await tx.execute(sql`SET LOCAL ROLE valo_content_drafter_dev`);
              const attestations: ReleaseAttestations = {
                ...(current.row.attestations as ReleaseAttestations),
                reviews,
              };
              await tx.insert(valoContentVersions).values({
                id: result.id,
                templateId: id,
                version: candidate.version,
                slug: practicalGuideSlug(id),
                policyId: reviewed.policy.version,
                candidateHash: candidate.hash,
                bundle: reviewed,
                attestations,
                status: "candidate",
                reviewBy: new Date(candidate.reviewBy!),
              });
              await tx.execute(sql`RESET ROLE`);
              const { row } = await validateOperationalVersionInTransaction(tx, result.id);
              assert.equal(await currentOperationalPermission(row), true);
              const resource = projectReleasedResource(row);
              assert.equal(resource.title, draft.section.title);
              assert.equal(resource.body, draft.section.body.replace(/^- /gm, "• "));
              assert.deepEqual(resource.sources, []);
              const [item] = projectReleasedCatalogue([row]);
              assert.equal(item?.type, "article");
              assert.equal(item.access, "free");
              assert.equal(item.href, "/resources/" + practicalGuideSlug(id));
              assert.equal(releaseVisible(row, reviewed.policy.hash), false);
              const example = { ...row, status: "published" };
              assert.equal(releaseVisible(example, reviewed.policy.hash), true);
              assert.equal(releaseVisible({ ...example, status: "withdrawn" }, reviewed.policy.hash), false);
              assert.equal(
                releaseVisible(example, reviewed.policy.hash, new Date(candidate.reviewBy!)),
                false,
              );
              throw Error("ROLLBACK_AFTER_PUBLISHER_CHECKS");
            });
          await assert.rejects(check([]), /INDEPENDENT_REVIEWS_MISSING/);
          await assert.rejects(check(refs), /ROLLBACK_AFTER_PUBLISHER_CHECKS/);
          assert.ok(!(await releasedResources()).some((r) => r.id === result.id));
        } finally {
          await db.execute(sql`delete from valo_prepared_candidates where version_id=${result.id}::uuid`);
        }
      });
    }
  },
);
