import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sql } from "drizzle-orm";
import { digest, mandatoryEnhancedChecks, sha256, type PublicationBundle } from "@workspace/valo-core";
import type { ArtifactRef } from "../publication/publication-artifacts";
import type { ReleaseAttestations } from "../publication/publication-publisher";

/**
 * A template that states the law, its whole route on a real database, short of a model call and short
 * of a release (docs/architecture/reviewed-route.md, part 4): prepared, rebuilt for its reviews, and put
 * through every check the publisher makes.
 *
 * Three things are stood in for, and the test says so where it does it. Private storage is a map in
 * memory. The Data Protection Act's words are not kept in the repository, so TPL-31's passages are
 * stand-ins: their words hold the quoted words and are otherwise not the Act's or the directive's, and
 * they carry the identity the repository's own amendment records describe, so the code's own records
 * decide whether each is current. And the owner has approved no text of the policy for templates that
 * state the law, so the test supposes that approval, under a policy version of its own that the real
 * policy never meets, and supposes it absent again to show what it holds.
 *
 * Nothing is published. The publisher's checks run in a transaction that is always rolled back, and the
 * two reviews are made up: no model is called.
 */
test(
  "a template that states the law, under a supposed approval of its policy, is prepared, measured for its reviews and passes every publisher check on a real database, with nothing published",
  { skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only", timeout: 300_000 },
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

    // The policy: the owner has approved no text of it. The test supposes an approval of the file as it
    // stands, under a version of its own, and can take the supposition away again.
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
    const approval = { supposed: true };
    t.mock.module(new URL("../publication/template-law-policy.ts", import.meta.url).href, {
      namedExports: {
        ...real,
        templateLawPolicy: (options?: Parameters<typeof real.templateLawPolicy>[0]) =>
          approval.supposed ? withSupposedApproval(options) : real.templateLawPolicy(options),
      },
    });

    // The passages: stand-ins, read an hour ago from the addresses the amendment records describe.
    const fixtures = await import("../publication/template-law-release.fixtures");
    const captured = await import("../publication/guidance-captures");
    const { retainedGuidePassages } = await import("../publication/guidance-passages");
    const now = new Date(),
      checkedAt = new Date(+now - 3_600_000),
      readAt = checkedAt.toISOString();
    t.mock.module(new URL("../publication/guidance-captures.ts", import.meta.url).href, {
      namedExports: {
        ...captured,
        capturedGuidePassages: () => fixtures.lawTemplateStandIns(readAt, fixtures.standInWords, "recorded"),
      },
    });
    // Each address's capture holds the stand-in words of its passages.
    const retained = retainedGuidePassages();
    const texts = new Map<string, { url: string; rawChecksum: string; parts: string[] }>();
    for (const [id, words] of Object.entries(fixtures.standInWords)) {
      const passage = fixtures.lawTemplateStandIn(id, words, readAt, "recorded");
      const leadId = captured.passageLead(id, retained)!;
      assert.ok(passage.instrument.rawSha256, id);
      const held = texts.get(leadId) ?? {
        url: passage.instrument.url,
        rawChecksum: passage.instrument.rawSha256,
        parts: [] as string[],
      };
      held.parts.push(words);
      texts.set(leadId, held);
    }
    const captures = [...texts].map(([leadId, held]) => ({
      leadId,
      url: held.url,
      snapshotId: randomUUID(),
      checkedAt: readAt,
      rawChecksum: held.rawChecksum,
      text: held.parts.join("\n\f\n"),
    }));
    for (const capture of captures) captureTexts.set(capture.snapshotId, capture.text);

    const { db } = await import("@workspace/db");
    const { asDraftingLogin } = await import("../../test-support/drafted-content");
    const { prepareLawTemplateCandidate } = await import("./law-template-preparation");
    const { operationalReviewRequests, saveOperationalReviewPlan } = await import("./operational-review");
    const { readOperationalInferenceReadiness } = await import("../ai-lanes/inference-operational-ready");
    const { validateOperationalVersionInTransaction } = await import("../publication/publication-publisher");
    const { enhancedChecksFromReviews } = await import("../publication/operational-review-contract");
    const { controlledTermsSnapshot } = await import("../publication/guidance-release.fixtures");
    const { prepareOperationalFiniteManifest } = await import("../ai/inference-manifest");
    const { assertFiniteWorkBindings } = await import("../ai-lanes/inference-work-bindings");
    const { assertWorkPackageMembership, finitePackagePreparers, prepareFiniteAllocationPackage } =
      await import("../ai/inference-allocation-package");
    const { requestDigest } = await import("../ai/inference-budget");
    const template = "TPL-31";
    const terms = controlledTermsSnapshot(new Date(+now - 1_800_000));

    // 1. Prepared: under the supposed approval, the gate names nothing but the two reviews, so the
    // candidate is kept as a private artifact with a row that lets staff find it.
    const prepared = await prepareLawTemplateCandidate(template, terms, { now, captures });
    assert.equal(prepared.state, "awaiting_reviews", prepared.reasons.join(", "));
    assert.ok(prepared.candidateArtifact && prepared.id);
    assert.deepEqual(prepared.failedChecks, []);
    assert.deepEqual(prepared.missingEvidence, []);
    assert.deepEqual(prepared.rightsProblems, []);
    const { policy } = await withSupposedApproval();
    assert.equal(prepared.policyHash, policy.hash);
    t.after(async () => {
      // The row that lets staff find the candidate is this test's own; it is taken away again. A policy
      // row can never be changed or deleted, so the supposed policy's row stays in the test database,
      // under its own version: the real policy never meets it.
      await db.execute(sql`delete from valo_prepared_candidates where version_id=${prepared.id}::uuid`);
    });
    const kept = JSON.parse((await get(prepared.candidateArtifact)).toString());
    assert.equal(kept.slug, "tpl-31");
    assert.deepEqual(kept.bundle.reviews, []);
    assert.equal(kept.bundle.candidate.sourceCheckDate, readAt);
    assert.deepEqual(
      Object.keys(kept.attestations.sourceSnapshots).sort(),
      Object.keys(fixtures.standInWords).sort(),
    );
    const binding = { candidateVersionId: prepared.id, candidateArtifact: prepared.candidateArtifact };

    // 2. Rebuilt for its reviews: the stored candidate is read back, built again from its retained draft
    // and the passages its claim scope records, its ten checks run again, and the two review requests
    // made from it. Each is within the limit the policy states for such templates.
    const current = await readOperationalInferenceReadiness(binding);
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
    for (const request of requests) {
      assert.equal(request.request.response_format.json_schema.name, "operational_enhanced_review");
      assert.equal(request.meter.inputCeiling, real.TEMPLATE_LAW_REVIEW_INPUT_CEILING);
      assert.ok(request.meter.withinInputCeiling, `${request.role} request is within the policy's limit`);
    }

    // A prepared template whose rights record no longer clears it is refused before any request is made
    // from it: here, a record that says a customer licence was accepted.
    const rightsRecord = JSON.parse((await get(kept.attestations.rights)).toString());
    const wrongRights = await put(
      Buffer.from(JSON.stringify({ ...rightsRecord, customerLicenceAccepted: true })),
      "json",
    );
    const tampered = await put(
      Buffer.from(JSON.stringify({ ...kept, attestations: { ...kept.attestations, rights: wrongRights } })),
      "json",
    );
    await assert.rejects(
      readOperationalInferenceReadiness({
        candidateVersionId: prepared.id,
        candidateArtifact: { id: tampered.id, hash: tampered.hash, extension: "json", templateId: template },
      }),
      /SAVED_PLAN_MECHANICAL_HOLD/,
    );

    // The review route's own gates, short of spending anything. The pair is saved as a plan; the check
    // the dispatcher makes before admission and just before it sends anything builds both requests again
    // from the stored candidate and finds them unchanged. No person signs each such template (the
    // policy's point 10), so nothing else is asked for. Only a package of its own kind takes the pair.
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
      ...binding,
      candidateHash: current.candidate.hash,
      bundleHash: requestDigest(current.bundle),
      sourceHashes: current.bundle.sources.map((source) => source.hash),
      sourceFiles: [{ path: current.provenanceInput.sourcePath, sha256: current.serverEvidence.sourceHash }],
      plan,
    });
    assert.deepEqual(
      manifest.works.map((work) => [work.lane, work.role, work.bindings.candidateArtifact?.templateId]),
      [
        ["publication", "factual", template],
        ["publication", "challenge", template],
      ],
    );
    for (const work of manifest.works) await assertFiniteWorkBindings(work);
    const lawTemplatePackage = await prepareFiniteAllocationPackage(
        new Date(),
        finitePackagePreparers.lawTemplatePairs,
      ),
      templatePackage = await prepareFiniteAllocationPackage(new Date()),
      guidePackage = await prepareFiniteAllocationPackage(new Date(), finitePackagePreparers.guidePairs);
    for (const work of manifest.works) {
      assert.doesNotThrow(() => assertWorkPackageMembership(work, lawTemplatePackage, template));
      for (const other of [templatePackage, guidePackage])
        assert.throws(() => assertWorkPackageMembership(work, other, template), /WORK_OUTSIDE_PACKAGE/);
    }

    // Without the owner's approval no review could be planned or sent. With the supposition taken away,
    // the policy is no longer the one the template was prepared under: the prepared template is refused
    // before any request is made from it, the dispatcher's check refuses the pair already planned, and
    // the preparer keeps nothing.
    approval.supposed = false;
    await assert.rejects(readOperationalInferenceReadiness(binding), /SAVED_PLAN_INPUT_CHANGED/);
    for (const work of manifest.works)
      await assert.rejects(assertFiniteWorkBindings(work), /SAVED_PLAN_INPUT_CHANGED/);
    const unapproved = await prepareLawTemplateCandidate(template, terms, { now, captures });
    assert.equal(unapproved.state, "held");
    assert.ok(unapproved.reasons.includes("policy_not_owner_approved"));
    assert.equal(unapproved.candidateArtifact, null);
    approval.supposed = true;

    // 3. Two reviews, made up: both pass, each answering the five enhanced checks from the template's
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

    // 4. Every check the publisher makes, in a transaction that is always rolled back. The captures are
    // put where the daily check would have stored them, and the reviewed version is saved as a candidate,
    // only inside that transaction.
    const rolledBack = "ROLLED_BACK_ON_PURPOSE";
    type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
    type CaptureRows = { lastRawHash?: (hash: string) => string };
    const storeCaptures = async (tx: Tx, options: CaptureRows = {}) => {
      for (const capture of captures) {
        await tx.execute(
          sql`insert into valo_source_snapshots(id,source_id,url,final_url,attempted_at,fetched_at,status,http_status,mime,raw_checksum,text_checksum,raw_object_key,text_object_key,extraction_version,metadata)
            values(${capture.snapshotId}::uuid,${capture.leadId},${capture.url},${capture.url},${checkedAt},${checkedAt},'retrieved_unreviewed',200,'text/plain',${capture.rawChecksum},${sha256(capture.text)},'synthetic-in-memory','synthetic-in-memory','synthetic','{"synthetic":true}')`,
        );
        const lastRawHash = (options.lastRawHash ?? ((hash) => hash))(capture.rawChecksum);
        await tx.execute(
          sql`insert into valo_source_watches(source_id,url,risk,last_snapshot_id,last_raw_hash,checked_at,failure_code)
            values(${capture.leadId},${capture.url},'high',${capture.snapshotId}::uuid,${lastRawHash},${checkedAt},null)
            on conflict(source_id) do update set url=excluded.url,last_snapshot_id=excluded.last_snapshot_id,
              last_raw_hash=excluded.last_raw_hash,checked_at=excluded.checked_at,failure_code=null`,
        );
      }
    };
    const publisherChecks = async (options: CaptureRows & { attestations?: ReleaseAttestations } = {}) => {
      const versionId = randomUUID();
      let passed: Awaited<ReturnType<typeof validateOperationalVersionInTransaction>> | undefined;
      const outcome = await db
        .transaction(async (tx) => {
          await storeCaptures(tx, options);
          // Saved as drafting saves it, inside this transaction, which is always undone.
          await asDraftingLogin(tx, () =>
            tx.execute(
              sql`insert into valo_content_versions(id,template_id,version,slug,policy_id,candidate_hash,bundle,attestations,status,review_by)
              values(${versionId}::uuid,${template},${reviewed.candidate.version},${kept.slug},${policy.version},${reviewed.candidate.hash},${JSON.stringify(reviewed)}::jsonb,${JSON.stringify(options.attestations ?? attested)}::jsonb,'candidate',${new Date(reviewed.candidate.reviewBy!)})`,
            ),
          );
          passed = await validateOperationalVersionInTransaction(tx, versionId);
          throw Error(rolledBack);
        })
        .catch((error: Error) => error);
      return { passed, error: outcome instanceof Error ? outcome.message : String(outcome), versionId };
    };

    const whole = await publisherChecks();
    assert.equal(whole.error, rolledBack, "every publisher check passed");
    assert.equal(whole.passed?.row.id, whole.versionId);
    assert.equal(whole.passed?.bundle.candidate.id, template);
    assert.equal(whole.passed?.bundle.policy.hash, policy.hash);

    // The same version without its recorded claim scope, or with a capture that is no longer the one its
    // address serves, is refused.
    const { claimScope: _dropped, ...withoutScope } = attested;
    assert.equal(
      (await publisherChecks({ attestations: withoutScope })).error,
      "TEMPLATE_CLAIM_SCOPE_MISSING",
    );
    assert.equal(
      (await publisherChecks({ lastRawHash: () => sha256("the address now serves another file") })).error,
      "SOURCE_CURRENT_CAPTURE_REQUIRED",
    );

    // And with the supposed approval taken away, the publisher refuses the very version that passed: the
    // policy it was prepared under is not the policy as it stands.
    approval.supposed = false;
    assert.equal((await publisherChecks()).error, "POLICY_NOT_TRUSTED");
    approval.supposed = true;

    // Nothing was saved or published: no version of the template exists, and no capture row remains.
    const versions = await db.execute(
      sql`select count(*)::int as n from valo_content_versions where template_id=${template}`,
    );
    assert.equal(versions.rows[0]!.n, 0);
    const snapshots = await db.execute(
      sql`select count(*)::int as n from valo_source_snapshots where raw_object_key='synthetic-in-memory'`,
    );
    assert.equal(snapshots.rows[0]!.n, 0);
  },
);
