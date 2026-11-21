import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { sql } from "drizzle-orm";
import { digest, mandatoryEnhancedChecks, sha256, type PublicationBundle } from "@workspace/valo-core";
import type { ArtifactRef } from "../publication/publication-artifacts";
import type { ReleaseAttestations } from "../publication/publication-publisher";

/**
 * A guide's whole route on a real database, short of a model call and short of a release: prepared
 * from captures, rebuilt for its reviews, and put through every check the publisher makes.
 *
 * Three things are stood in for, and the test says so where it does it. Private storage is a map in
 * memory. The captures are the retained passages, set out as today's captures of their official
 * addresses would hold them. And the owner's approval of the guidance policy is supposed: without
 * it no guide reaches the publisher's deeper checks at all.
 *
 * Nothing is published. The publisher's checks run in a transaction that is always rolled back, and
 * the two reviews are made up: no model is called.
 */
test(
  "a prepared guide passes every publisher check on a real database, in a transaction that is rolled back",
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
    const captureTexts = new Map<string, string>();
    const storage = await import("../sources/source-storage");
    t.mock.module(new URL("../sources/source-storage.ts", import.meta.url).href, {
      namedExports: {
        ...storage,
        readSourceText: async (snapshotId: string, checksum: string) => {
          const text = captureTexts.get(snapshotId);
          if (text === undefined || sha256(text) !== checksum) throw Error("SOURCE_STORAGE_CHECKSUM_FAILED");
          return text;
        },
      },
    });

    // The owner's approval, supposed: the policy file as it stands, counted as approved, under a
    // version of its own so that it never meets the real, unapproved policy's row.
    const real = await import("../publication/guidance-policy");
    const { publicationWorkspaceRoot } = await import("../publication/operational-policy");
    const policyFile = readFileSync(resolve(publicationWorkspaceRoot(), real.GUIDANCE_POLICY_PATH), "utf8");
    assert.equal(real.guidancePolicyApprovedHash(), null, "no approval is recorded outside this test");
    const supposedPolicy = async (options: Parameters<typeof real.guidancePolicy>[0] = {}) => {
      const base = await real.guidancePolicy({ ...options, approvedHash: sha256(policyFile) });
      const { hash: _unapprovedVersionHash, ...body } = base.policy;
      const supposed = { ...body, version: `${body.version}/approval-supposed-in-a-test` };
      return { policy: { ...supposed, hash: digest(supposed) }, authority: base.authority };
    };
    // The supposition can be taken away again, which leaves the policy as it really stands today.
    const approval = { supposed: true };
    t.mock.module(new URL("../publication/guidance-policy.ts", import.meta.url).href, {
      namedExports: {
        ...real,
        guidancePolicy: (options?: Parameters<typeof real.guidancePolicy>[0]) =>
          approval.supposed ? supposedPolicy(options) : real.guidancePolicy(options),
      },
    });

    const { db } = await import("@workspace/db");
    const { prepareGuideCandidateRelease, guideSlug } = await import("./guidance-preparation");
    const { operationalReviewRequests } = await import("./operational-review");
    const { readOperationalInferenceReadiness } = await import("../ai-lanes/inference-operational-ready");
    const { validateOperationalVersionInTransaction } = await import("../publication/publication-publisher");
    const { enhancedChecksFromReviews } = await import("../publication/operational-review-contract");
    const { retainedGuidePassages } = await import("../publication/guidance-passages");
    const { guideActLeads, guideCaptureLeads } = await import("../publication/guidance-captures");
    const { currentSourceCaptures } = await import("../sources/source-current-captures");
    const { guideAmendmentRecords } = await import("../publication/guidance-amendments");
    const { guideClaimMaps } = await import("../publication/guidance-bundle");
    const { buildGuideClaims } = await import("../publication/guidance-claim-map");
    const { readGuidanceIntake } = await import("../publication/operational-intake");
    const { controlledTermsSnapshot } = await import("../publication/guidance-release.fixtures");
    const { REVIEW_INPUT_CEILING } = await import("./review-meter");

    const guide = "GUD-01",
      now = new Date(),
      checkedAt = new Date(+now - 3_600_000);

    // The captures: for each official address the guide rests on, the retained passages of that
    // text as a capture checked an hour ago would hold them. An Act's capture carries the checksum
    // of the file its amendment record describes.
    const retained = retainedGuidePassages();
    const intake = await readGuidanceIntake(guide);
    const needed = buildGuideClaims(
      guideClaimMaps.find((m) => m.id === guide)!,
      intake.section.body,
      retained,
    ).sources.map((s) => retained(s.id)!);
    const texts = new Map<string, { url: string; rawChecksum: string; parts: string[] }>();
    for (const passage of needed) {
      const act = passage.instrument.kind === "act";
      const leadId = act ? guideActLeads[passage.instrument.id]! : passage.instrument.id;
      const held = texts.get(leadId) ?? {
        url: passage.instrument.url,
        rawChecksum: act
          ? guideAmendmentRecords.find((r) => r.instrument === passage.instrument.id)!.rawSha256
          : sha256(passage.text),
        parts: [],
      };
      held.parts.push(passage.text);
      texts.set(leadId, held);
    }
    const captures = [...texts].map(([leadId, held]) => ({
      leadId,
      url: held.url,
      snapshotId: randomUUID(),
      checkedAt: checkedAt.toISOString(),
      rawChecksum: held.rawChecksum,
      text: held.parts.join("\n\f\n"),
    }));
    for (const capture of captures) {
      assert.ok(guideCaptureLeads.includes(capture.leadId), capture.leadId);
      captureTexts.set(capture.snapshotId, capture.text);
    }

    const folder = await mkdtemp(join(tmpdir(), "valo-guide-route-"));
    t.after(() => rm(folder, { recursive: true, force: true }));
    const termsPath = join(folder, "terms.json");
    // Controlled pages holding the passages the provider-permission record looks for.
    await writeFile(termsPath, JSON.stringify(controlledTermsSnapshot(checkedAt)));

    // 1. Prepared: with the approval supposed, the gate names nothing but the two reviews, so the
    // candidate is kept as a private artifact with a row that lets staff find it.
    const prepared = await prepareGuideCandidateRelease(guide, termsPath, { captures, now });
    assert.equal(prepared.state, "awaiting_reviews", prepared.reasons.join(", "));
    assert.ok(prepared.candidateArtifact && prepared.id);
    assert.deepEqual(prepared.failedChecks, []);
    assert.deepEqual(prepared.missingEvidence, []);
    const { policy } = await supposedPolicy();
    t.after(async () => {
      // The row that lets staff find the candidate is this test's own; it is taken away again. A
      // policy row can never be changed or deleted, so the supposed policy's row stays in the test
      // database under its own name. The publisher trusts only the policy it builds itself from the
      // real file and the recorded approval, as the last check below shows.
      await db.execute(sql`delete from valo_prepared_candidates where version_id=${prepared.id}::uuid`);
    });
    const listed = await db.execute(
      sql`select template_id, version from valo_prepared_candidates where version_id=${prepared.id}::uuid`,
    );
    assert.deepEqual(listed.rows, [{ template_id: guide, version: 1 }]);
    const kept = JSON.parse((await get(prepared.candidateArtifact)).toString());
    assert.equal(kept.slug, guideSlug("Check the name you trade under"));
    assert.equal(kept.slug, "check-the-name-you-trade-under");
    assert.deepEqual(kept.bundle.reviews, []);
    assert.equal(kept.bundle.candidate.sourceCheckDate, checkedAt.toISOString());
    assert.deepEqual(Object.keys(kept.attestations.sourceSnapshots).sort(), needed.map((p) => p.id).sort());

    // The check the site makes before it shows a published version, that the provider's permission
    // for its wording is still current, reads a guide's own records as it reads a template's.
    const { currentOperationalPermission } = await import("../publication/operational-read-permission");
    assert.equal(
      await currentOperationalPermission({
        attestations: kept.attestations,
      } as Parameters<typeof currentOperationalPermission>[0]),
      true,
    );

    // 2. Rebuilt for its reviews: the stored candidate is read back, its words built again from the
    // retained draft, its checks run again, and the two review requests are made from it. Each
    // carries the guide's sources and the amendment records of the Acts it quotes.
    const current = await readOperationalInferenceReadiness({
      candidateVersionId: prepared.id,
      candidateArtifact: prepared.candidateArtifact,
    });
    assert.equal(current.candidate.hash, prepared.candidateHash);
    assert.ok(current.checks.every((check) => check.result === "pass"));
    const requests = operationalReviewRequests(
      current.candidate,
      current.rightsInput,
      current.provenanceInput,
      current.exportReport,
      current.serverEvidence,
      now.toISOString(),
      current.bundle.sources,
    );
    assert.deepEqual(
      requests.map((r) => r.role),
      ["factual", "challenge"],
    );
    for (const request of requests) {
      assert.equal(request.request.response_format.json_schema.name, "operational_enhanced_review");
      // A guide's request is measured against the limit the policy file states for guides. This one
      // is larger than a template's request may be.
      assert.equal(request.meter.inputCeiling, real.GUIDE_REVIEW_INPUT_CEILING);
      assert.ok(request.meter.withinInputCeiling, `${request.role} request is within the guides' limit`);
      assert.ok(request.meter.conservativeInputTokenBound > REVIEW_INPUT_CEILING);
      const sent = JSON.parse(request.request.messages[1]!.content) as {
        sources: { id: string }[];
        rights: { officialText: { longestSharedWords: number; withinLimit: boolean } };
        provenance: {
          originalItemSha256: string;
          amendmentBasis: {
            text: string;
            sectionsQuoted: string[];
            searched: unknown[];
            amendingInstruments: {
              title: string;
              sectionsItChanges: string[];
              onSectionsQuoted: Record<string, unknown>;
            }[];
            limits: string;
          }[];
        };
      };
      assert.deepEqual(sent.sources.map((source) => source.id).sort(), needed.map((p) => p.id).sort());
      assert.equal(sent.rights.officialText.withinLimit, true);
      assert.equal(sent.provenance.originalItemSha256, sha256(intake.section.body));
      // The one Act this guide quotes, as its amendment record bears on the sections quoted.
      assert.equal(sent.provenance.amendmentBasis.length, 1);
      const basis = sent.provenance.amendmentBasis[0]!;
      assert.equal(basis.text, "Companies and Allied Matters Act 2020");
      assert.deepEqual(basis.sectionsQuoted, ["814", "863", "868"]);
      assert.ok(basis.searched.length >= 5 && basis.limits.length > 0);
      const facilitation = basis.amendingInstruments.find((a) => a.title.includes("Business Facilitation"))!;
      assert.ok(facilitation.sectionsItChanges.length > 1);
      assert.deepEqual(Object.keys(facilitation.onSectionsQuoted), ["868"]);
    }

    // The review route's own gates, short of spending anything. The pair is saved as a plan that is
    // not held for its size. The manifest takes a guide. The check the dispatcher makes just before
    // it sends anything builds both requests again from the stored candidate and finds them
    // unchanged. And only a package for guides admits the pair.
    const { saveOperationalReviewPlan } = await import("./operational-review");
    const { prepareOperationalFiniteManifest } = await import("../ai/inference-manifest");
    const { assertFiniteWorkBindings } = await import("../ai-lanes/inference-work-bindings");
    const { assertWorkPackageMembership, finitePackagePreparers, prepareFiniteAllocationPackage } =
      await import("../ai/inference-allocation-package");
    const { requestDigest } = await import("../ai/inference-budget");
    const plan = await saveOperationalReviewPlan(
      current.candidate,
      current.rightsInput,
      current.provenanceInput,
      current.exportReport,
      current.serverEvidence,
      undefined,
      current.bundle.sources,
    );
    assert.equal(plan.manifest.status, "mechanically_planned_not_reserved");
    const manifest = prepareOperationalFiniteManifest({
      candidateVersionId: prepared.id,
      candidateArtifact: prepared.candidateArtifact,
      candidateHash: current.candidate.hash,
      bundleHash: requestDigest(current.bundle),
      sourceHashes: current.bundle.sources.map((source) => source.hash),
      sourceFiles: [{ path: current.provenanceInput.sourcePath, sha256: current.serverEvidence.sourceHash }],
      plan,
    });
    assert.deepEqual(
      manifest.works.map((work) => [work.lane, work.role, work.bindings.candidateArtifact?.templateId]),
      [
        ["publication", "factual", guide],
        ["publication", "challenge", guide],
      ],
    );
    for (const work of manifest.works) await assertFiniteWorkBindings(work);
    const guidePackage = await prepareFiniteAllocationPackage(new Date(), finitePackagePreparers.guidePairs),
      templatePackage = await prepareFiniteAllocationPackage(new Date());
    for (const work of manifest.works) {
      assert.doesNotThrow(() => assertWorkPackageMembership(work, guidePackage, guide));
      assert.throws(() => assertWorkPackageMembership(work, templatePackage, guide), /PREPARER_UNAVAILABLE/);
    }

    // Without the owner's approval no review can be planned or sent. With the supposition taken
    // away, the policy is the unapproved one it really is: the prepared guide is refused before any
    // request is made from it, and the dispatcher's check refuses the pair already planned.
    approval.supposed = false;
    await assert.rejects(
      readOperationalInferenceReadiness({
        candidateVersionId: prepared.id,
        candidateArtifact: prepared.candidateArtifact,
      }),
      /SAVED_PLAN_INPUT_CHANGED/,
    );
    for (const work of manifest.works)
      await assert.rejects(assertFiniteWorkBindings(work), /SAVED_PLAN_INPUT_CHANGED/);
    const unapproved = await prepareGuideCandidateRelease(guide, termsPath, { captures, now });
    assert.equal(unapproved.state, "held");
    assert.ok(unapproved.reasons.includes("policy_not_owner_approved"));
    assert.equal(unapproved.candidateArtifact, null);
    approval.supposed = true;

    // 3. Two reviews, made up: both pass, each answering the five enhanced checks from the guide's
    // own sources. No model was called.
    const evidenceHash = digest(current.bundle.sources);
    const passage = current.bundle.sources[0]!.text.slice(0, 200);
    const outputs = (["factual", "challenge"] as const).map((role) => ({
      role,
      output: {
        verdict: "pass" as const,
        findings: [],
        missingEvidence: [],
        observations: [],
        enhancedChecks: mandatoryEnhancedChecks.map((name) => ({
          name,
          result: "pass" as const,
          passage,
          note: "made up for a test",
        })),
      },
    }));
    const records = outputs.map(({ role, output }) => ({
      role,
      candidateHash: current.candidate.hash,
      evidenceHash,
      providerResponseId: `no-model-was-called-${role}-${randomUUID()}`,
      model: "none: made up for a test",
      promptVersion: requests.find((r) => r.role === role)!.promptVersion,
      receivedOtherVerdict: false,
      serverEvidence: current.serverEvidence,
      output,
    }));
    const reviewRefs: ArtifactRef[] = [];
    for (const record of records) reviewRefs.push(await put(Buffer.from(JSON.stringify(record)), "json"));
    const reviewed: PublicationBundle = {
      ...current.bundle,
      reviews: records.map((record) => ({
        runId: record.providerResponseId,
        model: record.model,
        promptVersion: record.promptVersion,
        candidateHash: record.candidateHash,
        evidenceHash: record.evidenceHash,
        role: record.role,
        verdict: "pass",
        findings: [],
        receivedOtherVerdict: false,
      })),
      enhancedChecks: enhancedChecksFromReviews(current.bundle, outputs),
    };
    reviewed.manifest = {
      ...current.bundle.manifest,
      status: "eligible",
      reviewHash: digest({ draft: reviewed.draftRun, reviews: reviewed.reviews }),
      checksHash: digest({ mechanical: reviewed.mechanicalChecks, enhanced: reviewed.enhancedChecks }),
    };
    const attested: ReleaseAttestations = {
      ...(current.row.attestations as ReleaseAttestations),
      reviews: reviewRefs,
    };

    // 4. Every check the publisher makes, in a transaction that is always rolled back. The captures
    // are put where the daily check would have stored them, and the reviewed version is saved as a
    // candidate, only inside that transaction.
    const rolledBack = "ROLLED_BACK_ON_PURPOSE";
    type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
    type CaptureRows = { lastRawHash?: (hash: string) => string; checkedAt?: Date };
    const storeCaptures = async (tx: Tx, options: CaptureRows = {}) => {
      const checked = options.checkedAt ?? checkedAt;
      for (const capture of captures) {
        await tx.execute(
          sql`insert into valo_source_snapshots(id,source_id,url,final_url,attempted_at,fetched_at,status,http_status,mime,raw_checksum,text_checksum,raw_object_key,text_object_key,extraction_version,metadata)
            values(${capture.snapshotId}::uuid,${capture.leadId},${capture.url},${capture.url},${checked},${checked},'retrieved_unreviewed',200,'text/plain',${capture.rawChecksum},${sha256(capture.text)},'synthetic-in-memory','synthetic-in-memory','synthetic','{"synthetic":true}')`,
        );
        const lastRawHash = (options.lastRawHash ?? ((hash) => hash))(capture.rawChecksum);
        await tx.execute(
          sql`insert into valo_source_watches(source_id,url,risk,last_snapshot_id,last_raw_hash,checked_at,failure_code)
            values(${capture.leadId},${capture.url},'high',${capture.snapshotId}::uuid,${lastRawHash},${checked},null)
            on conflict(source_id) do update set url=excluded.url,last_snapshot_id=excluded.last_snapshot_id,
              last_raw_hash=excluded.last_raw_hash,checked_at=excluded.checked_at,failure_code=null`,
        );
      }
    };

    // The preparer's own reading of the captures, from rows as the daily check stores them: each
    // address's current capture, and none that is stale or no longer the file its address serves.
    const readCaptures = async (options: CaptureRows = {}) => {
      let read: Awaited<ReturnType<typeof currentSourceCaptures>> = [];
      await db
        .transaction(async (tx) => {
          await storeCaptures(tx, options);
          read = await currentSourceCaptures(guideCaptureLeads, now, {
            reader: tx,
            readText: async (snapshotId) => captureTexts.get(snapshotId)!,
          });
          throw Error(rolledBack);
        })
        .catch((error: Error) => assert.equal(error.message, rolledBack));
      return read;
    };
    const byLead = <T extends { leadId: string }>(rows: readonly T[]) =>
      [...rows].sort((a, b) => a.leadId.localeCompare(b.leadId));
    assert.deepEqual(
      byLead(await readCaptures()).map(({ textChecksum: _unused, ...capture }) => capture),
      byLead(captures),
    );
    assert.deepEqual(await readCaptures({ checkedAt: new Date(+now - 25 * 3_600_000) }), []);
    assert.deepEqual(await readCaptures({ lastRawHash: () => sha256("another file") }), []);

    const publisherChecks = async (options: CaptureRows & { attestations?: ReleaseAttestations } = {}) => {
      const versionId = randomUUID();
      let passed: Awaited<ReturnType<typeof validateOperationalVersionInTransaction>> | undefined;
      const outcome = await db
        .transaction(async (tx) => {
          await storeCaptures(tx, options);
          await tx.execute(sql`SET LOCAL ROLE valo_content_drafter_dev`);
          await tx.execute(
            sql`insert into valo_content_versions(id,template_id,version,slug,policy_id,candidate_hash,bundle,attestations,status,review_by)
              values(${versionId}::uuid,${guide},${reviewed.candidate.version},${kept.slug},${policy.version},${reviewed.candidate.hash},${JSON.stringify(reviewed)}::jsonb,${JSON.stringify(options.attestations ?? attested)}::jsonb,'candidate',${new Date(reviewed.candidate.reviewBy!)})`,
          );
          await tx.execute(sql`RESET ROLE`);
          passed = await validateOperationalVersionInTransaction(tx, versionId);
          throw Error(rolledBack);
        })
        .catch((error: Error) => error);
      return { passed, error: outcome instanceof Error ? outcome.message : String(outcome), versionId };
    };

    const whole = await publisherChecks();
    assert.equal(whole.error, rolledBack, "every publisher check passed");
    assert.equal(whole.passed?.row.id, whole.versionId);
    assert.equal(whole.passed?.bundle.candidate.id, guide);
    assert.equal(whole.passed?.bundle.policy.hash, policy.hash);

    // The same version without its recorded claim scope, or with a capture that is no longer the
    // one its address serves, is refused.
    const { claimScope: _dropped, ...withoutScope } = attested;
    assert.equal((await publisherChecks({ attestations: withoutScope })).error, "GUIDE_CLAIM_SCOPE_MISSING");
    assert.equal(
      (await publisherChecks({ lastRawHash: () => sha256("the address now serves another file") })).error,
      "SOURCE_CURRENT_CAPTURE_REQUIRED",
    );

    // And with the supposition taken away the publisher refuses the very version that passed: the
    // policy it was prepared under is not the policy as it really stands.
    approval.supposed = false;
    assert.equal((await publisherChecks()).error, "POLICY_NOT_TRUSTED");
    approval.supposed = true;

    // Nothing was saved or published: no version of the guide exists, and no capture row remains.
    const versions = await db.execute(
      sql`select count(*)::int as n from valo_content_versions where template_id=${guide}`,
    );
    assert.equal(versions.rows[0]!.n, 0);
    const snapshots = await db.execute(
      sql`select count(*)::int as n from valo_source_snapshots where raw_object_key='synthetic-in-memory'`,
    );
    assert.equal(snapshots.rows[0]!.n, 0);
  },
);
