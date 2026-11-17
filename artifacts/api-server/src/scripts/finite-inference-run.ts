import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { desc } from "drizzle-orm";
import { publicationSchema } from "@workspace/valo-core";
import { assertDevelopmentRuntime } from "../lib/valo-development-runtime";
import {
  operationalInferenceTemplateIds,
  supportsOperationalInferenceTemplate,
} from "../lib/inference-operational-coverage";
import { selectPreparedProposal, parseFinitePreparationOptions } from "../lib/inference-prepared-report";
import { requestDigest } from "../lib/inference-budget";
import { prepareOperationalFiniteManifest, finiteManifestProposal } from "../lib/inference-manifest";
import type { FiniteManifest } from "../lib/inference-batch-dispatch";
import { buildFiniteDecisionPacket } from "../lib/inference-decision-packet";
import {
  prepareFiniteAllocationPackage,
  allocationPackageId,
  registerPreparedInferenceSubmanifest,
  readApprovedFiniteAllocationPackage,
} from "../lib/inference-allocation-package";

/** No approval/enable operation exists in this command. Preparation creates
 * exact, disabled private artifacts; execution can only use an existing owner
 * approval independently verified by the production dispatcher. */
const finiteRunCommands = [
  "--inspect",
  "--prepare",
  "--prepare-selection",
  "--prepare-customer",
  "--prepare-template-candidate",
  "--verify-prepared",
  "--admit",
  "--execute",
] as const;
type FiniteRunCommand = (typeof finiteRunCommands)[number];
function isFiniteRunCommand(value: string | undefined): value is FiniteRunCommand {
  return (finiteRunCommands as readonly string[]).includes(value ?? "");
}
async function main() {
  assertDevelopmentRuntime();
  const [mode, batchId, ...extra] = process.argv.slice(2);
  const commands = finiteRunCommands;
  if (mode === "--help" && !batchId && !extra.length) {
    console.log(
      JSON.stringify({
        commands,
        inferenceCalls: 0,
        ownerApprovalCreated: false,
        authorizesDispatch: false,
        note: "Preparation is disabled work only. Execution requires existing exact durable owner authorization.",
      }),
    );
    return;
  }
  // Narrowing to the command union makes a misspelled branch below a compile error.
  if (!isFiniteRunCommand(mode)) throw Error("FINITE_RUN_ARGUMENTS_INVALID");
  if (mode.startsWith("--prepare"))
    console.error(JSON.stringify({ event: "finite-preparation-loading", inferenceCalls: 0 }));
  const [
    { db, pool, valoContentVersions },
    { readOperationalInferenceReadiness },
    { assertFiniteWorkBindings },
    { withApprovedInferencePair, provideFiniteWorkBindings },
    { saveOperationalReviewPlan, executeOperationalReviewPlan },
    { getPublicationArtifact, putPublicationArtifact },
    { publicationWorkspaceRoot },
    { InferenceBudgetStore },
  ] = await Promise.all([
    import("@workspace/db"),
    import("../lib/inference-operational-ready"),
    import("../lib/inference-work-bindings"),
    import("../lib/managed-inference"),
    import("../editorial/operational-review"),
    import("../editorial/publication-artifacts"),
    import("../editorial/operational-policy"),
    import("../lib/inference-budget-store"),
  ]);
  // This command is the composition root: the dispatcher checks approved work with these.
  provideFiniteWorkBindings(assertFiniteWorkBindings);
  try {
    if (mode === "--inspect") {
      if (batchId || extra.length) throw Error("FINITE_RUN_ARGUMENTS_INVALID");
      // Sequential scopes are explicitly separate observations, not a fictitious
      // global account balance or a change to the allocation's start boundary.
      const historical = await new InferenceBudgetStore(pool).inspect();
      const additional = await new InferenceBudgetStore(pool, "public", "additional-new").inspect();
      console.log(
        JSON.stringify({
          mode: "read-only-inspection",
          historical,
          additional,
          approvalRowsWritten: 0,
          providerCalls: 0,
          quotaChanges: 0,
          authorizesDispatch: false,
        }),
      );
      return;
    }
    if (mode === "--prepare-customer") {
      if (!batchId) throw Error("FINITE_RUN_ARGUMENTS_INVALID");
      const options = parseFinitePreparationOptions(extra);
      const { prepareCustomerFiniteManifest } = await import("../lib/inference-customer-manifest");
      const existing = options.packageId
        ? await readApprovedFiniteAllocationPackage(pool, options.packageId)
        : null;
      const pkg = existing?.pkg ?? (await prepareFiniteAllocationPackage());
      const prepared = await prepareCustomerFiniteManifest(batchId, {
        retry: options.retry,
        packageId: allocationPackageId(pkg),
      });
      for (const work of prepared.manifest.works) await assertFiniteWorkBindings(work);
      const proposal = finiteManifestProposal(
        prepared.manifest,
        new Date(
          Math.min(Date.now() + 3600000, existing ? Date.parse(existing.expiresAt) : Infinity),
        ).toISOString(),
      );
      const artifact = await putPublicationArtifact(
        Buffer.from(
          JSON.stringify({
            kind: "customer-finite-preparation-v1",
            proposals: [proposal],
            package: pkg,
            ownerApproved: false,
            providerCalls: 0,
            approvalRowsWritten: 0,
          }),
        ),
        "json",
      );
      console.log(
        JSON.stringify({
          proposal: artifact,
          manifestHash: proposal.manifestHash,
          caseId: prepared.caseId,
          caseHash: prepared.caseHash,
          attemptCount: proposal.attemptCount,
          worstCaseReservationNanoUsd: proposal.worstCaseReservationNanoUsd,
          enabled: false,
          ownerApproved: false,
          providerCalls: 0,
          approvalRowsWritten: 0,
        }),
      );
      return;
    }
    if (mode === "--prepare-template-candidate") {
      if (!batchId || !supportsOperationalInferenceTemplate(batchId) || extra.length !== 1 || !extra[0])
        throw Error("FINITE_RUN_ARGUMENTS_INVALID");
      const { prepareOperationalCandidateRelease } = await import("../editorial/operational-preparation");
      const prepared = await prepareOperationalCandidateRelease(batchId, extra[0]);
      console.log(
        JSON.stringify({
          ...prepared,
          templateId: batchId,
          providerCalls: 0,
          approvalRowsWritten: 0,
          publicationAccepted: false,
        }),
      );
      return;
    }
    if (mode === "--verify-prepared") {
      const [artifactHash] = extra;
      if (
        extra.length !== 1 ||
        !batchId ||
        !/^[a-f0-9-]{36}$/.test(batchId) ||
        !/^[a-f0-9]{64}$/.test(artifactHash ?? "")
      )
        throw Error("FINITE_RUN_ARGUMENTS_INVALID");
      const report = JSON.parse(
        (await getPublicationArtifact({ id: batchId, hash: artifactHash!, extension: "json" })).toString(),
      );
      if (report.kind === "customer-finite-preparation-v1") {
        if (report.proposals?.length !== 1) throw Error("PREPARED_PACKET_CHANGED");
        const proposal = report.proposals[0],
          manifest = proposal.manifest,
          work = manifest?.works?.[0];
        if (!work?.bindings?.caseId || Date.parse(proposal.expiresAt) <= Date.now())
          throw Error("PREPARED_MANIFEST_EXPIRED");
        const pkg = await prepareFiniteAllocationPackage(new Date(report.package.preparedAt));
        if (requestDigest(pkg) !== requestDigest(report.package)) throw Error("PREPARED_PACKAGE_CHANGED");
        const { prepareCustomerFiniteManifest } = await import("../lib/inference-customer-manifest");
        const exact = await prepareCustomerFiniteManifest(work.bindings.caseId, {
          retry: manifest.works.length === 2,
          now: new Date(manifest.preparedAt),
          packageId: allocationPackageId(pkg),
        });
        const rebuilt = finiteManifestProposal(exact.manifest, proposal.expiresAt);
        if (requestDigest(rebuilt) !== requestDigest(proposal)) throw Error("PREPARED_PACKET_CHANGED");
        for (const item of manifest.works) await assertFiniteWorkBindings(item);
        const live = await new InferenceBudgetStore(pool, "public", "additional-new").inspect();
        console.log(
          JSON.stringify({
            verifiedWorkItems: manifest.works.length,
            manifests: 1,
            caseId: work.bindings.caseId,
            manifestHash: proposal.manifestHash,
            expiresAt: proposal.expiresAt,
            worstCaseReservationNanoUsd: proposal.worstCaseReservationNanoUsd,
            currentCapacitySufficient:
              live.uncommittedCapacityNanoUsd !== null &&
              BigInt(live.uncommittedCapacityNanoUsd) >= BigInt(proposal.worstCaseReservationNanoUsd),
            enabled: false,
            ownerApproved: false,
            approvalRowsWritten: 0,
            providerCalls: 0,
            authorizesDispatch: false,
          }),
        );
        return;
      }
      const packet = report.decisionPacket;
      if (!packet || Date.parse(packet.expiresAt) <= Date.now()) throw Error("PREPARED_MANIFEST_EXPIRED");
      const currentPackage = await prepareFiniteAllocationPackage(new Date(report.package.preparedAt));
      if (requestDigest(currentPackage) !== requestDigest(report.package))
        throw Error("PREPARED_PACKAGE_CHANGED");
      const rebuilt = buildFiniteDecisionPacket(
        report.proposals,
        packet.manifests.map((m: { artifact: unknown }) => m.artifact),
        packet.capacityObservation,
        new Date(packet.preparedAt),
      );
      if (requestDigest(rebuilt) !== requestDigest(packet)) throw Error("PREPARED_PACKET_CHANGED");
      let verifiedWorkItems = 0;
      for (const [index, proposal] of report.proposals.entries()) {
        const saved = JSON.parse((await getPublicationArtifact(packet.manifests[index].artifact)).toString());
        if (requestDigest(saved) !== proposal.manifestHash) throw Error("PRIVATE_MANIFEST_CHANGED");
        for (const work of proposal.manifest.works) {
          await assertFiniteWorkBindings(work);
          verifiedWorkItems++;
        }
        const manifest = proposal.manifest as FiniteManifest,
          first = manifest.works[0]!;
        if (manifest.works.every((w) => w.lane === "customer")) {
          const { prepareCustomerFiniteManifest } = await import("../lib/inference-customer-manifest");
          const actual = await prepareCustomerFiniteManifest(first.bindings.caseId!, {
            retry: manifest.works.length === 2,
            now: new Date(manifest.preparedAt),
            packageId: manifest.packageId,
          });
          if (requestDigest(actual.manifest) !== proposal.manifestHash)
            throw Error("PREPARED_CUSTOMER_CHANGED");
        } else await readOperationalInferenceReadiness(first.bindings.candidateVersionId!);
      }
      const live = await new InferenceBudgetStore(pool, "public", "additional-new").inspect();
      console.log(
        JSON.stringify({
          verifiedWorkItems,
          manifests: report.proposals.length,
          decisionPacketHash: requestDigest(packet),
          expiresAt: packet.expiresAt,
          currentCapacitySufficient:
            live.uncommittedCapacityNanoUsd !== null &&
            BigInt(live.uncommittedCapacityNanoUsd) >= BigInt(packet.worstCaseReservationNanoUsd),
          reviewStatus: "independent-review-pending",
          approvalRowsWritten: 0,
          providerCalls: 0,
          authorizesDispatch: false,
        }),
      );
      return;
    }
    if (mode === "--admit") {
      const [artifactHash, candidateVersionId] = extra;
      if (
        extra.length < 1 ||
        extra.length > 2 ||
        (candidateVersionId &&
          !/^(?:[a-f0-9-]{36}|customer:CAI-CAND-[A-Z]{3}-[0-9]{2})$/.test(candidateVersionId)) ||
        !batchId ||
        !/^[a-f0-9-]{36}$/.test(batchId) ||
        !artifactHash ||
        !/^[a-f0-9]{64}$/.test(artifactHash)
      )
        throw Error("FINITE_RUN_ARGUMENTS_INVALID");
      const report = JSON.parse(
        (await getPublicationArtifact({ id: batchId, hash: artifactHash, extension: "json" })).toString(),
      );
      const proposal = selectPreparedProposal(report, candidateVersionId);
      const admitted = await registerPreparedInferenceSubmanifest(
        new InferenceBudgetStore(pool, "public", "additional-new"),
        proposal.manifest,
        proposal.expiresAt,
        assertFiniteWorkBindings,
      );
      console.log(JSON.stringify(admitted));
      return;
    }
    const selection = mode === "--prepare-selection";
    const selectionOptions = selection ? parseFinitePreparationOptions(extra) : null;
    if (
      (extra.length && !selection) ||
      !["--prepare", "--prepare-selection", "--execute"].includes(mode ?? "") ||
      (selection && (!batchId || !/^CAI-CAND-[A-Z]{3}-[0-9]{2}$/.test(batchId))) ||
      (mode === "--prepare" && batchId && !/^finite-package:[a-f0-9]{64}$/.test(batchId)) ||
      (mode === "--execute" && (!batchId || !/^[-a-zA-Z0-9_:]{1,160}$/.test(batchId)))
    )
      throw Error("FINITE_RUN_ARGUMENTS_INVALID");
    if (mode === "--prepare" || selection) {
      const parentId = selection ? selectionOptions?.packageId : batchId;
      const existingPackage = parentId ? await readApprovedFiniteAllocationPackage(pool, parentId) : null;
      const allocationPackage = existingPackage?.pkg ?? (await prepareFiniteAllocationPackage()),
        packageId = allocationPackageId(allocationPackage);
      const latest = new Map<string, typeof valoContentVersions.$inferSelect>();
      for (const row of await db
        .select()
        .from(valoContentVersions)
        .orderBy(desc(valoContentVersions.version)))
        if (!latest.has(row.templateId)) latest.set(row.templateId, row);
      const holds: { candidateVersionId: string; templateId: string; reason: string }[] = [];
      const prepared: ReturnType<typeof finiteManifestProposal>[] = [];
      const customerHolds: { caseId: string; reason: string }[] = [];
      for (const row of latest.values()) {
        if (!supportsOperationalInferenceTemplate(row.templateId)) {
          holds.push({
            candidateVersionId: row.id,
            templateId: row.templateId,
            reason: "CANDIDATE_REQUEST_PREPARER_UNAVAILABLE",
          });
          continue;
        }
        try {
          console.error(
            JSON.stringify({
              event: "finite-preparation-template",
              templateId: row.templateId,
              inferenceCalls: 0,
            }),
          );
          const current = await readOperationalInferenceReadiness(row.id);
          const plan = await saveOperationalReviewPlan(
            current.candidate,
            current.rightsInput,
            current.provenanceInput,
            current.exportReport,
            current.serverEvidence,
          );
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
          for (const work of manifest.works) await assertFiniteWorkBindings(work);
          prepared.push(
            finiteManifestProposal(
              manifest,
              existingPackage
                ? new Date(
                    Math.min(Date.parse(existingPackage.expiresAt), Date.parse(plan.manifest.expiresAt)),
                  ).toISOString()
                : plan.manifest.expiresAt,
            ),
          );
        } catch (error) {
          holds.push({
            candidateVersionId: row.id,
            templateId: row.templateId,
            reason:
              error instanceof Error && /^[A-Z_]{3,100}$/.test(error.message)
                ? error.message
                : "FINITE_PREPARATION_FAILED",
          });
        }
      }
      if (selection) {
        try {
          const { prepareCustomerFiniteManifest } = await import("../lib/inference-customer-manifest");
          const customer = await prepareCustomerFiniteManifest(batchId!, {
            retry: selectionOptions!.retry,
            now: new Date(allocationPackage.preparedAt),
            packageId,
          });
          for (const work of customer.manifest.works) await assertFiniteWorkBindings(work);
          prepared.push(
            finiteManifestProposal(
              customer.manifest,
              new Date(
                Math.min(
                  Date.now() + 3600000,
                  existingPackage ? Date.parse(existingPackage.expiresAt) : Infinity,
                ),
              ).toISOString(),
            ),
          );
        } catch (error) {
          customerHolds.push({
            caseId: batchId!,
            reason:
              error instanceof Error && /^[A-Z_]{3,100}$/.test(error.message)
                ? error.message
                : "CUSTOMER_PREPARATION_FAILED",
          });
        }
      }
      const manifestArtifacts = await Promise.all(
        prepared.map((p) => putPublicationArtifact(Buffer.from(JSON.stringify(p.manifest)), "json")),
      );
      const capacity = await new InferenceBudgetStore(pool, "public", "additional-new").inspect();
      const decisionPacket = prepared.length
        ? buildFiniteDecisionPacket(prepared, manifestArtifacts, {
            stateFingerprint: capacity.stateFingerprint,
            uncommittedCapacityNanoUsd: capacity.uncommittedCapacityNanoUsd,
            observedAt: capacity.observedAt,
          })
        : null;
      const report = {
        preparedAt: new Date().toISOString(),
        scope: "one finite additional allocation with automatic exact submanifest admission",
        packageId,
        package: allocationPackage,
        ownerApprovalScope: "finite-allocation-package",
        ownerApproved: !!existingPackage,
        executableScope: selection
          ? "Exact operational pairs and explicitly listed supported customer attempts under one package"
          : "one exact operational review pair per verified saved candidate",
        supportedTemplateIds: operationalInferenceTemplateIds,
        latestCandidatesInspected: latest.size,
        proposals: prepared,
        proposal: prepared.length === 1 ? prepared[0] : null,
        decisionPacket,
        holds,
        customerHolds,
        providerCalls: 0,
        approvalRowsWritten: 0,
        nonpublicationCorpora:
          "Original 80/60/60 rosters remain frozen; only listed supported customer attempts are prepared. Editorial/checker preparers remain held.",
        excluded: ["authoring", "real customer confidential data", "production", "payments", "emails"],
        readiness: prepared.length
          ? "disabled exact proposals ready; no inference approval created"
          : "no eligible prepared work",
      };
      const artifact = await putPublicationArtifact(Buffer.from(JSON.stringify(report)), "json");
      const dir = resolve(publicationWorkspaceRoot(), "generated-artifacts/valo-completion");
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const path = resolve(dir, `finite-inference-proposal-${randomUUID()}.json`);
      await writeFile(path, JSON.stringify({ ...report, privateReportArtifact: artifact }, null, 2) + "\n", {
        flag: "wx",
        mode: 0o600,
      });
      console.log(
        JSON.stringify({
          ready: prepared.length > 0,
          manifestHashes: prepared.map((p) => p.manifestHash),
          preparedPairs: prepared.filter((p) => p.manifest.works.every((w) => w.lane === "publication"))
            .length,
          customerCases: prepared.filter((p) => p.manifest.works.every((w) => w.lane === "customer")).length,
          attemptCount: prepared.reduce((sum, p) => sum + p.attemptCount, 0),
          holds: holds.length + customerHolds.length,
          providerCalls: 0,
          ownerApproved: false,
          decisionPacketHash: decisionPacket ? requestDigest(decisionPacket) : null,
          worstCaseReservationNanoUsd: decisionPacket?.worstCaseReservationNanoUsd ?? null,
          privateReportArtifact: artifact,
          report: path,
        }),
      );
      return;
    }
    const row = (
      await pool.query("SELECT manifest,manifest_hash FROM valo_inference_batches WHERE id=$1", [batchId])
    ).rows[0];
    if (!row || requestDigest(row.manifest) !== row.manifest_hash) throw Error("INFERENCE_MANIFEST_INVALID");
    const manifest = row.manifest as FiniteManifest;
    if (
      manifest.version === 2 &&
      manifest.works.length > 0 &&
      manifest.works.every((w) => w.lane === "customer")
    ) {
      const { executeApprovedCustomerManifest } = await import("../lib/inference-customer-manifest");
      const result = await executeApprovedCustomerManifest(batchId!, manifest);
      const artifact = await putPublicationArtifact(Buffer.from(JSON.stringify(result)), "json");
      console.log(
        JSON.stringify({
          caseId: result.caseId,
          caseHash: result.caseHash,
          resultArtifact: artifact,
          status: result.result.status === "ready" ? "structured-result-retained" : "held",
          providerQualityAccepted: false,
        }),
      );
      return;
    }
    if (manifest.version !== 2 || manifest.works.length !== 2) throw Error("RUNNER_SCOPE_UNSUPPORTED");
    const [first, second] = manifest.works;
    if (
      !first ||
      !second ||
      first.lane !== "publication" ||
      second.lane !== "publication" ||
      !first.pair ||
      first.pair !== second.pair ||
      !first.bindings.candidateVersionId ||
      first.bindings.candidateVersionId !== second.bindings.candidateVersionId ||
      !first.bindings.operationalPlan ||
      requestDigest(first.bindings.operationalPlan) !== requestDigest(second.bindings.operationalPlan)
    )
      throw Error("RUNNER_PAIR_BINDING_INVALID");
    const current = await readOperationalInferenceReadiness(first.bindings.candidateVersionId);
    const artifact = first.bindings.operationalPlan;
    const retained = JSON.parse((await getPublicationArtifact(artifact)).toString());
    const plan = { manifest: retained.manifest, entries: retained.entries, artifact } as Awaited<
      ReturnType<typeof saveOperationalReviewPlan>
    >;
    // Rebuild at the original timestamp: owner approval is for this exact roster,
    // never for newly generated requests, a refreshed timestamp, or extra retries.
    const expected = prepareOperationalFiniteManifest(
      {
        candidateVersionId: current.row.id,
        candidateHash: current.row.candidateHash,
        bundleHash: requestDigest(publicationSchema.parse(current.row.bundle)),
        sourceHashes: current.bundle.sources.map((s) => s.hash),
        sourceFiles: [
          { path: current.provenanceInput.sourcePath, sha256: current.serverEvidence.sourceHash },
        ],
        plan,
      },
      new Date(manifest.preparedAt),
    );
    expected.packageId = manifest.packageId;
    if (requestDigest(expected) !== row.manifest_hash) throw Error("RUNNER_MANIFEST_CHANGED");
    for (const work of manifest.works) await assertFiniteWorkBindings(work);
    const reviews = await withApprovedInferencePair(batchId!, first.pair, () =>
      executeOperationalReviewPlan(plan, current.candidate, current.serverEvidence),
    );
    const report = {
      completedAt: new Date().toISOString(),
      batchId,
      manifestHash: row.manifest_hash,
      reviews: reviews.map((r) => ({
        role: r.record.role,
        artifact: r.artifact,
        providerResponseId: r.record.providerResponseId,
      })),
      expectedIndependentReviews: 2,
      complete: reviews.length === 2,
      publicationAccepted: false,
    };
    const resultArtifact = await putPublicationArtifact(Buffer.from(JSON.stringify(report)), "json");
    console.log(JSON.stringify({ ...report, resultArtifact }));
  } finally {
    await pool.end();
  }
}
main().catch((error) => {
  console.error(
    error instanceof Error && /^[A-Z_]{3,100}$/.test(error.message)
      ? error.message
      : "FINITE_INFERENCE_RUN_FAILED",
  );
  process.exitCode = 1;
});
