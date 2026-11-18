/** Bounded operator preparation only. No admission, execution or approval API. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { assertDevelopmentRuntime } from "../lib/valo-development-runtime";

async function main() {
  assertDevelopmentRuntime();
  assert.equal(process.argv[2], "--prepare-disabled");
  assert.equal(process.argv.length, 3);
  // Existing storage/database configuration remains available. Model credentials
  // must be absent from this preparation process, not changed in the workspace.
  for (const key of ["AI_INTEGRATIONS_OPENAI_API_KEY", "OPENAI_API_KEY"])
    assert.ok(!process.env[key], "MODEL_KEYS_MUST_BE_ABSENT");
  const [
    { db, pool, valoContentVersions },
    { eq, desc },
    { readOperationalInferenceReadiness },
    { saveOperationalReviewPlan },
    {
      prepareOperationalFiniteManifest,
      finiteManifestProposal,
      prepareFiniteAllocationPackage,
      allocationPackageId,
      requestDigest,
      buildFiniteDecisionPacket,
      InferenceBudgetStore,
    },
    { assertFiniteWorkBindings },
    { putPublicationArtifact },
    { publicationWorkspaceRoot },
  ] = await Promise.all([
    import("@workspace/db"),
    import("drizzle-orm"),
    import("../lib/inference-operational-ready"),
    import("../modules/editorial"),
    import("../modules/ai"),
    import("../lib/inference-work-bindings"),
    import("../modules/publication"),
    import("../modules/publication"),
  ]);
  const report: Record<string, unknown> = {
    startedAt: new Date().toISOString(),
    templateId: "TPL-07",
    enabled: false,
    ownerApproved: false,
    approvalRowsWritten: 0,
    providerCalls: 0,
    reservationsCreated: 0,
    authorizesDispatch: false,
    publicationAccepted: false,
  };
  try {
    const [row] = await db
      .select()
      .from(valoContentVersions)
      .where(eq(valoContentVersions.templateId, "TPL-07"))
      .orderBy(desc(valoContentVersions.version))
      .limit(1);
    if (!row) throw Error("SAVED_INVENTORY_CANDIDATE_REQUIRED");
    report.candidate = {
      id: row.id,
      templateId: row.templateId,
      version: row.version,
      hash: row.candidateHash,
      status: row.status,
    };
    const attempts = async () =>
      Number(
        (
          await pool.query(
            "SELECT count(*)::int n FROM valo_publication_ai_attempts WHERE candidate_hash=$1",
            [row.candidateHash],
          )
        ).rows[0].n,
      );
    const before = await attempts();
    try {
      const current = await readOperationalInferenceReadiness(row.id);
      const plan = await saveOperationalReviewPlan(
        current.candidate,
        current.rightsInput,
        current.provenanceInput,
        current.exportReport,
        current.serverEvidence,
      );
      const pkg = await prepareFiniteAllocationPackage(),
        packageId = allocationPackageId(pkg);
      const manifest = prepareOperationalFiniteManifest({
        candidateVersionId: row.id,
        candidateHash: row.candidateHash,
        bundleHash: requestDigest(current.bundle),
        sourceHashes: current.bundle.sources.map((s) => s.hash),
        sourceFiles: [
          { path: current.provenanceInput.sourcePath, sha256: current.serverEvidence.sourceHash },
        ],
        plan,
      });
      manifest.packageId = packageId;
      assert.deepEqual(manifest.works.map((w) => w.role).sort(), ["challenge", "factual"]);
      for (const work of manifest.works) await assertFiniteWorkBindings(work);
      const proposal = finiteManifestProposal(manifest, plan.manifest.expiresAt);
      assert.equal(proposal.worstCaseReservationNanoUsd, "741100800");
      const manifestArtifact = await putPublicationArtifact(Buffer.from(JSON.stringify(manifest)), "json");
      const capacity = await new InferenceBudgetStore(pool, "public", "additional-new").inspect();
      const decisionPacket = buildFiniteDecisionPacket([proposal], [manifestArtifact], {
        stateFingerprint: capacity.stateFingerprint,
        uncommittedCapacityNanoUsd: capacity.uncommittedCapacityNanoUsd,
        observedAt: capacity.observedAt,
      });
      const packetArtifact = await putPublicationArtifact(
        Buffer.from(
          JSON.stringify({
            kind: "tpl07-disabled-runtime-preparation-v1",
            package: pkg,
            proposals: [proposal],
            decisionPacket,
            ownerApproved: false,
            providerCalls: 0,
            approvalRowsWritten: 0,
          }),
        ),
        "json",
      );
      Object.assign(report, {
        readiness: decisionPacket.status,
        packageId,
        packageHash: requestDigest(pkg),
        allocationContentUnits: pkg.contentIds.length + pkg.namedContentSections.length,
        corpusRosters: pkg.corpora.map((c) => ({ name: c.name, cases: c.cases.length })),
        proposedParentApprovalLifetimeHours: 24,
        parentApprovedAt: null,
        parentExpiresAt: null,
        plan: plan.artifact,
        planHash: requestDigest(plan.manifest),
        childManifest: manifestArtifact,
        manifestHash: proposal.manifestHash,
        privatePreparationReport: packetArtifact,
        decisionPacketHash: requestDigest(decisionPacket),
        preparedAt: manifest.preparedAt,
        childExpiresAt: proposal.expiresAt,
        worstCaseReservationNanoUsd: proposal.worstCaseReservationNanoUsd,
        worstCaseReservationUsd: "0.7411008",
        allocationCapNanoUsd: proposal.allocationCapNanoUsd,
        attempts: decisionPacket.manifests[0]!.works,
        mechanicalChecks: current.checks.map((c) => ({ name: c.name, result: c.result })),
        evidenceBindings: current.serverEvidence,
        exportsPassed: current.exportReport.passed,
        capacityObservation: capacity,
        holds: [
          "Owner approval absent; proposed allocation remains disabled.",
          "Independent factual and challenge reviews not executed.",
          "Candidate remains held; no eligible publication.",
          ...(decisionPacket.status === "held-capacity-unverified"
            ? ["Additional-allocation capacity is unverified; this packet is held."]
            : []),
          "Child expires at its exact freshness deadline, independently of the proposed 24-hour parent approval.",
          "Customer commercial licence acceptance and production approvals remain separate.",
        ],
      });
    } catch (error) {
      report.readiness = "held";
      report.reason =
        error instanceof Error && /^[A-Z_]{3,100}$/.test(error.message)
          ? error.message
          : "PREPARATION_FAILED_SEE_PRIVATE_OPERATOR_CONTEXT";
      process.exitCode = 1;
    }
    const after = await attempts();
    report.candidateAttemptRows = { before, after, delta: after - before };
    assert.equal(after, before, "UNEXPECTED_ATTEMPT_ROW_CHANGE");
  } finally {
    report.finishedAt = new Date().toISOString();
    const dir = resolve(publicationWorkspaceRoot(), "generated-artifacts/valo-completion");
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const path = resolve(dir, "tpl07-disabled-runtime-" + randomUUID() + ".json");
    await writeFile(path, JSON.stringify(report, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify({ ...report, localReport: path }));
    await pool.end();
  }
}
main().catch((error) => {
  console.error(
    error instanceof Error && /^[A-Z_]{3,100}$/.test(error.message)
      ? error.message
      : "TPL07_DISABLED_PREPARATION_FAILED",
  );
  process.exitCode = 1;
});
