import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { isPracticalGuideId, publicationSchema } from "@workspace/valo-core";
import { assertDevelopmentRuntime } from "../platform/valo-development-runtime";
import {
  mappedGuideIds,
  operationalInferenceTemplateIds,
  readPreparedCandidate,
  supportsOperationalInferenceTemplate,
} from "../modules/publication";
import { selectPreparedProposal, parseFinitePreparationOptions } from "../modules/ai-lanes";
import {
  requestDigest,
  prepareOperationalFiniteManifest,
  finiteManifestProposal,
  buildFiniteDecisionPacket,
  prepareFiniteAllocationPackage,
  allocationPackageId,
  registerPreparedInferenceSubmanifest,
  readApprovedFiniteAllocationPackage,
  finitePackagePreparers,
  practicalReviewLimitsFor,
} from "../modules/ai";
import type { FiniteManifest } from "../modules/ai";

/** No approval/enable operation exists in this command. Preparation creates
 * exact, disabled private artifacts; execution can only use an existing owner
 * approval independently verified by the production dispatcher. */
const finiteRunCommands = [
  "--inspect",
  "--prepare",
  "--prepare-selection",
  "--prepare-customer",
  "--prepare-editorial-case",
  "--prepare-template-candidate",
  "--prepare-practical-guide-candidate",
  "--prepare-guide-candidate",
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
    { pool },
    { readOperationalInferenceReadiness },
    { assertFiniteWorkBindings },
    { withApprovedInferencePair, provideFiniteWorkBindings, InferenceBudgetStore },
    { saveOperationalReviewPlan, executeOperationalReviewPlan },
    { getPublicationArtifact, putPublicationArtifact },
    { publicationWorkspaceRoot },
  ] = await Promise.all([
    import("@workspace/db"),
    import("../modules/ai-lanes"),
    import("../modules/ai-lanes"),
    import("../modules/ai"),
    import("../modules/editorial"),
    import("../modules/publication"),
    import("../modules/publication"),
  ]);
  // This command is the composition root: the dispatcher checks approved work with these.
  provideFiniteWorkBindings(assertFiniteWorkBindings);
  // A follow-up editorial case (C060) is prepared, admitted and run only while the case it follows
  // is held by its real reviews. Read outside any transaction, at each of those steps.
  const editorialPrerequisite = async (caseId: string) => {
    const { assertEditorialCasePrerequisite, editorialCasePrerequisite, readEditorialCaseBatches } =
      await import("../modules/editorial");
    const prior = editorialCasePrerequisite(caseId);
    if (!prior) return null;
    return assertEditorialCasePrerequisite(caseId, await readEditorialCaseBatches(pool, [prior]));
  };
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
      if (options.candidates.length || options.guidePairs || options.practicalPairs)
        throw Error("FINITE_RUN_ARGUMENTS_INVALID");
      const { prepareCustomerFiniteManifest } = await import("../modules/ai-lanes");
      const existing = options.packageId
        ? await readApprovedFiniteAllocationPackage(pool, options.packageId)
        : null;
      const pkg = existing?.pkg ?? (await prepareFiniteAllocationPackage());
      if (pkg.supportedPreparers[0] !== finitePackagePreparers.templatePairs[0])
        throw Error("CANDIDATE_OUTSIDE_PACKAGE_KIND");
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
    if (mode === "--prepare-editorial-case") {
      // One case-bound editorial case's review pair (decision 0015, point 4), under an editorial-case
      // package: the case is named by its corpus id, as in --prepare-editorial-case EVAL-EDP-C019.
      if (!batchId || !/^EVAL-EDP-C\d{3}$/.test(batchId)) throw Error("FINITE_RUN_ARGUMENTS_INVALID");
      const options = parseFinitePreparationOptions(extra);
      if (options.candidates.length || options.retry || options.guidePairs || options.practicalPairs)
        throw Error("FINITE_RUN_ARGUMENTS_INVALID");
      const { prepareEditorialCaseManifest, isControlledFailureEditorialCase } =
        await import("../modules/editorial");
      // C041's review must fail under control; it never goes to the provider.
      if (isControlledFailureEditorialCase(batchId)) throw Error("EDITORIAL_CASE_CONTROLLED_FAILURE_ONLY");
      // C060 follows C018's real hold, and names the batch that keeps C018's failed evidence.
      const prerequisite = await editorialPrerequisite(batchId);
      const existing = options.packageId
        ? await readApprovedFiniteAllocationPackage(pool, options.packageId)
        : null;
      const pkg =
        existing?.pkg ??
        (await prepareFiniteAllocationPackage(new Date(), finitePackagePreparers.editorialCases));
      if (requestDigest(pkg.supportedPreparers) !== requestDigest(finitePackagePreparers.editorialCases))
        throw Error("EDITORIAL_CASE_PACKAGE_REQUIRED");
      const manifest = prepareEditorialCaseManifest(batchId, { packageId: allocationPackageId(pkg) });
      for (const work of manifest.works) await assertFiniteWorkBindings(work);
      const proposal = finiteManifestProposal(
        manifest,
        new Date(
          Math.min(Date.now() + 3600000, existing ? Date.parse(existing.expiresAt) : Infinity),
        ).toISOString(),
      );
      const artifact = await putPublicationArtifact(
        Buffer.from(
          JSON.stringify({
            kind: "editorial-case-finite-preparation-v1",
            proposals: [proposal],
            prerequisite,
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
          caseId: batchId,
          prerequisite,
          candidateVersionId: manifest.works[0]!.bindings.candidateVersionId,
          packageId: allocationPackageId(pkg),
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
    if (mode === "--prepare-template-candidate" || mode === "--prepare-practical-guide-candidate") {
      if (
        !batchId ||
        !(mode === "--prepare-practical-guide-candidate"
          ? isPracticalGuideId(batchId)
          : supportsOperationalInferenceTemplate(batchId)) ||
        extra.length !== 1 ||
        !extra[0]
      )
        throw Error("FINITE_RUN_ARGUMENTS_INVALID");
      const { prepareOperationalCandidateRelease } = await import("../modules/editorial");
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
    if (mode === "--prepare-guide-candidate") {
      // A guide with a claim map, and the path of a provider-terms snapshot taken within a day. The
      // guide is bound to the captures the daily source check holds. It is kept as a candidate only
      // when the gate names nothing but its two reviews; otherwise the reasons are printed.
      if (!batchId || !mappedGuideIds.includes(batchId) || extra.length !== 1 || !extra[0])
        throw Error("FINITE_RUN_ARGUMENTS_INVALID");
      const { prepareGuideCandidateRelease } = await import("../modules/editorial");
      const prepared = await prepareGuideCandidateRelease(batchId, extra[0]);
      console.log(
        JSON.stringify({
          ...prepared,
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
        const pkg = await prepareFiniteAllocationPackage(
          new Date(report.package.preparedAt),
          report.package.supportedPreparers,
        );
        if (requestDigest(pkg) !== requestDigest(report.package)) throw Error("PREPARED_PACKAGE_CHANGED");
        const { prepareCustomerFiniteManifest } = await import("../modules/ai-lanes");
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
      const currentPackage = await prepareFiniteAllocationPackage(
        new Date(report.package.preparedAt),
        report.package.supportedPreparers,
      );
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
          const { prepareCustomerFiniteManifest } = await import("../modules/ai-lanes");
          const actual = await prepareCustomerFiniteManifest(first.bindings.caseId!, {
            retry: manifest.works.length === 2,
            now: new Date(manifest.preparedAt),
            packageId: manifest.packageId,
          });
          if (requestDigest(actual.manifest) !== proposal.manifestHash)
            throw Error("PREPARED_CUSTOMER_CHANGED");
        } else {
          if (!first.bindings.candidateVersionId || !first.bindings.candidateArtifact)
            throw Error("PREPARED_CANDIDATE_REQUIRED");
          await readOperationalInferenceReadiness({
            candidateVersionId: first.bindings.candidateVersionId,
            candidateArtifact: first.bindings.candidateArtifact,
          });
        }
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
      const editorialWorks = proposal.manifest.works.filter((w) => w.lane === "editorial_evaluation");
      if (editorialWorks.length) {
        const { isControlledFailureEditorialCase } = await import("../modules/editorial");
        const caseId = editorialWorks[0]!.bindings.caseId ?? "";
        if (isControlledFailureEditorialCase(caseId)) throw Error("EDITORIAL_CASE_CONTROLLED_FAILURE_ONLY");
        await editorialPrerequisite(caseId);
      }
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
    // Prepared candidates are named by their exact artifacts (decision 0014): --candidate=<id>:<sha256>.
    const preparationOptions =
      mode === "--prepare" || selection ? parseFinitePreparationOptions(extra) : null;
    const selectionOptions = selection ? preparationOptions : null;
    if (
      (extra.length && !preparationOptions) ||
      !["--prepare", "--prepare-selection", "--execute"].includes(mode ?? "") ||
      (selection && (!batchId || !/^CAI-CAND-[A-Z]{3}-[0-9]{2}$/.test(batchId))) ||
      (mode === "--prepare" &&
        (!batchId ||
          !/^(?:new|finite-package:[a-f0-9]{64})$/.test(batchId) ||
          preparationOptions!.retry ||
          preparationOptions!.packageId ||
          // --guide-pairs chooses the kind of a new package; an approved package has its kind already.
          ((preparationOptions!.guidePairs || preparationOptions!.practicalPairs) && batchId !== "new") ||
          !preparationOptions!.candidates.length)) ||
      (selection && (preparationOptions!.guidePairs || preparationOptions!.practicalPairs)) ||
      (mode === "--execute" && (!batchId || !/^[-a-zA-Z0-9_:]{1,160}$/.test(batchId)))
    )
      throw Error("FINITE_RUN_ARGUMENTS_INVALID");
    if (mode === "--prepare" || selection) {
      const parentId = selection ? selectionOptions?.packageId : batchId === "new" ? undefined : batchId;
      const existingPackage = parentId ? await readApprovedFiniteAllocationPackage(pool, parentId) : null;
      const allocationPackage =
          existingPackage?.pkg ??
          (await prepareFiniteAllocationPackage(
            new Date(),
            preparationOptions!.guidePairs
              ? finitePackagePreparers.guidePairs
              : preparationOptions!.reminderInventoryPairs
                ? finitePackagePreparers.reminderInventoryPairs
                : preparationOptions!.practicalPairs
                  ? finitePackagePreparers.practicalPairs
                  : finitePackagePreparers.templatePairs,
          )),
        packageId = allocationPackageId(allocationPackage);
      // A package admits one kind of work: the templates' review pairs, or the guides'.
      const guidePackage =
        requestDigest(allocationPackage.supportedPreparers) ===
        requestDigest(finitePackagePreparers.guidePairs);
      const practicalReviewLimits = practicalReviewLimitsFor(allocationPackage.supportedPreparers);
      const practicalPackage = !!practicalReviewLimits;
      if (
        allocationPackage.supportedPreparers[0] === finitePackagePreparers.editorialCases[0] ||
        (selection && (guidePackage || practicalPackage)) ||
        (practicalReviewLimits &&
          preparationOptions!.candidates.length > practicalReviewLimits.articleIds.length)
      )
        throw Error("FINITE_RUN_ARGUMENTS_INVALID");
      const practicalArticles = new Set<string>();
      const holds: { candidateVersionId: string | null; templateId: string | null; reason: string }[] = [];
      const prepared: ReturnType<typeof finiteManifestProposal>[] = [];
      const customerHolds: { caseId: string; reason: string }[] = [];
      for (const ref of preparationOptions!.candidates) {
        let candidateVersionId: string | null = null,
          templateId: string | null = null;
        try {
          const saved = await readPreparedCandidate(ref);
          candidateVersionId = saved.versionId;
          templateId = saved.templateId;
          const guide = mappedGuideIds.includes(saved.templateId);
          const practical = isPracticalGuideId(saved.templateId);
          if (!guide && !practical && !supportsOperationalInferenceTemplate(saved.templateId))
            throw Error("CANDIDATE_REQUEST_PREPARER_UNAVAILABLE");
          if (guide !== guidePackage || practical !== practicalPackage)
            throw Error("CANDIDATE_OUTSIDE_PACKAGE_KIND");
          console.error(
            JSON.stringify({
              event: "finite-preparation-template",
              templateId: saved.templateId,
              inferenceCalls: 0,
            }),
          );
          if (practical) {
            if (!practicalReviewLimits?.articleIds.includes(saved.templateId))
              throw Error("PRACTICAL_GUIDE_OUTSIDE_PACKAGE");
            if (practicalArticles.has(saved.templateId)) throw Error("DUPLICATE_PRACTICAL_GUIDE");
            practicalArticles.add(saved.templateId);
          }
          const candidateArtifact = { ...ref, templateId: saved.templateId };
          const current = await readOperationalInferenceReadiness({
            candidateVersionId: saved.versionId,
            candidateArtifact,
          });
          const plan = await saveOperationalReviewPlan(
            current.candidate,
            current.rightsInput,
            current.provenanceInput,
            current.exportReport,
            current.serverEvidence,
            undefined,
            current.bundle.sources,
          );
          const manifest = prepareOperationalFiniteManifest({
            candidateVersionId: saved.versionId,
            candidateArtifact,
            candidateHash: current.row.candidateHash,
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
            candidateVersionId,
            templateId,
            reason:
              error instanceof Error && /^[A-Z_]{3,100}$/.test(error.message)
                ? error.message
                : "FINITE_PREPARATION_FAILED",
          });
        }
      }
      if (selection) {
        try {
          const { prepareCustomerFiniteManifest } = await import("../modules/ai-lanes");
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
          : practicalPackage
            ? `one factual and challenge pair each for ${practicalReviewLimits.articleIds.join(" and ")}`
            : guidePackage
              ? "one exact review pair per verified prepared guide"
              : "one exact operational review pair per verified prepared candidate",
        supportedTemplateIds: guidePackage || practicalPackage ? [] : operationalInferenceTemplateIds,
        supportedGuideIds: practicalReviewLimits?.articleIds ?? (guidePackage ? mappedGuideIds : []),
        ...(practicalPackage ? { practicalReviewLimits } : {}),
        candidatesInspected: preparationOptions!.candidates.length,
        proposals: prepared,
        proposal: prepared.length === 1 ? prepared[0] : null,
        decisionPacket,
        holds,
        customerHolds,
        providerCalls: 0,
        approvalRowsWritten: 0,
        nonpublicationCorpora: practicalPackage
          ? `This package only admits the review pairs for ${practicalReviewLimits.articleIds.join(" and ")}.`
          : "Original 80/60/60 rosters remain frozen; only listed supported customer attempts are prepared. Editorial/checker preparers remain held.",
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
          ownerApproved: !!existingPackage,
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
      const { executeApprovedCustomerManifest } = await import("../modules/ai-lanes");
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
    if (
      manifest.version === 2 &&
      manifest.works.length === 2 &&
      manifest.works.every((w) => w.lane === "editorial_evaluation")
    ) {
      const { prepareEditorialCaseManifest, executeEditorialCaseReviews, isControlledFailureEditorialCase } =
        await import("../modules/editorial");
      const [first, second] = manifest.works as [
        FiniteManifest["works"][number],
        FiniteManifest["works"][number],
      ];
      if (!first.pair || first.pair !== second.pair || !first.bindings.caseId)
        throw Error("RUNNER_PAIR_BINDING_INVALID");
      if (isControlledFailureEditorialCase(first.bindings.caseId))
        throw Error("EDITORIAL_CASE_CONTROLLED_FAILURE_ONLY");
      const prerequisite = await editorialPrerequisite(first.bindings.caseId);
      // Rebuild at the original moment: the owner approved this exact roster, never fresh requests.
      const expected = prepareEditorialCaseManifest(
        first.bindings.caseId,
        manifest.packageId ? { packageId: manifest.packageId } : {},
        new Date(manifest.preparedAt),
      );
      if (requestDigest(expected) !== row.manifest_hash) throw Error("RUNNER_MANIFEST_CHANGED");
      for (const work of manifest.works) await assertFiniteWorkBindings(work);
      const reviews = await withApprovedInferencePair(batchId!, first.pair, () =>
        executeEditorialCaseReviews(manifest.works),
      );
      const report = {
        kind: "editorial-case-run-v1",
        completedAt: new Date().toISOString(),
        batchId,
        manifestHash: row.manifest_hash,
        caseId: first.bindings.caseId,
        caseHash: first.caseHash,
        candidateHash: first.candidateHash,
        prerequisite,
        reviews,
        expectedIndependentReviews: 2,
        complete: reviews.filter((r) => r.outcome === "completed").length === 2,
        // An independent reviewer confirms the expected outcome before the case counts (decision 0015).
        formalCaseAccepted: false,
        evaluatorDecision: null,
      };
      const resultArtifact = await putPublicationArtifact(Buffer.from(JSON.stringify(report)), "json");
      console.log(JSON.stringify({ ...report, resultArtifact }));
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
      !first.bindings.candidateArtifact ||
      requestDigest(first.bindings.candidateArtifact) !== requestDigest(second.bindings.candidateArtifact) ||
      !first.bindings.operationalPlan ||
      requestDigest(first.bindings.operationalPlan) !== requestDigest(second.bindings.operationalPlan)
    )
      throw Error("RUNNER_PAIR_BINDING_INVALID");
    const current = await readOperationalInferenceReadiness({
      candidateVersionId: first.bindings.candidateVersionId,
      candidateArtifact: first.bindings.candidateArtifact,
    });
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
        candidateArtifact: first.bindings.candidateArtifact,
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
      // The candidate is saved as a version only by publish-reviewed-pair.ts, which checks these
      // reviews against this batch and the publisher's gates (decision 0014).
      candidateVersionId: current.row.id,
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
