import { assertDevelopmentRuntime } from "../lib/valo-development-runtime";
import { readFile } from "node:fs/promises";
import { requestDigest } from "../lib/inference-budget";
import { finiteManifestProposal } from "../lib/inference-manifest";
import {
  prepareCustomerEvaluationPlan,
  prepareCustomerFiniteManifest,
  validateCustomerEvaluationWork,
} from "../lib/inference-customer-evaluation";
import {
  existingCustomerEvaluationActor,
  assertCustomerEvaluationActor,
  executePreparedCustomerCase,
} from "../lib/inference-customer-runtime";
import {
  allocationPackageId,
  prepareFiniteAllocationPackage,
  readApprovedFiniteAllocationPackage,
  registerPreparedInferenceSubmanifest,
} from "../lib/inference-allocation-package";
import type { FiniteManifest } from "../lib/inference-batch-dispatch";
import type { ArtifactRef } from "../editorial/publication-artifacts";
import { workspaceActorFromRecord } from "../platform/workspace-context";

/** Private development preparation/execution only. No command writes owner
 * approval, creates an identity, changes quotas, injects provider receipts or
 * accepts the original 60-case quality gate. */
async function main() {
  assertDevelopmentRuntime();
  const [mode, id, hash, caseId, ...extra] = process.argv.slice(2);
  if (
    extra.length ||
    !["--prepare", "--admit", "--execute", "--controls"].includes(mode ?? "") ||
    (mode === "--prepare" &&
      (caseId || (id && id !== "disabled" && !/^finite-package:[a-f0-9]{64}$/.test(id)))) ||
    (mode === "--admit" &&
      (!id || !/^[a-f0-9-]{36}$/.test(id) || !hash || !/^[a-f0-9]{64}$/.test(hash) || !caseId)) ||
    (mode === "--execute" && (!id || hash || caseId || !/^[-a-zA-Z0-9_:]{1,160}$/.test(id))) ||
    (mode === "--controls" && (!id || hash || caseId))
  )
    throw Error("CUSTOMER_FINITE_ARGUMENTS_INVALID");
  if (mode === "--controls") {
    const followupFile = JSON.parse(await readFile(id!, "utf8"));
    if (followupFile.kind !== "synthetic-customer60-followups" || followupFile.synthetic !== true)
      throw Error("EXPLICIT_SYNTHETIC_FOLLOWUPS_REQUIRED");
    const plan = await prepareCustomerEvaluationPlan(null, new Date(), followupFile.values);
    const [{ runCustomerFaultControls }, { putPublicationArtifact }] = await Promise.all([
      import("../lib/inference-customer-controls"),
      import("../editorial/publication-artifacts"),
    ]);
    const report = await runCustomerFaultControls(plan),
      artifact = await putPublicationArtifact(Buffer.from(JSON.stringify(report)), "json");
    console.log(
      JSON.stringify({
        originalCases: 60,
        controlledCases: report.records.length,
        controlledOrchestrationPassed: report.records.filter(
          (r) => r.status === "controlled_orchestration_pass",
        ).length,
        actualProviderCalls: 0,
        approvalRowsWritten: 0,
        formalAcceptance: false,
        artifact,
      }),
    );
    return;
  }
  const [
    { pool },
    { putPublicationArtifact, getPublicationArtifact },
    { assertFiniteWorkBindings },
    { InferenceBudgetStore },
  ] = await Promise.all([
    import("@workspace/db"),
    import("../editorial/publication-artifacts"),
    import("../lib/inference-work-bindings"),
    import("../lib/inference-budget-store"),
  ]);
  try {
    if (mode === "--prepare") {
      const existing = id && id !== "disabled" ? await readApprovedFiniteAllocationPackage(pool, id) : null;
      const pkg = existing?.pkg ?? (await prepareFiniteAllocationPackage()),
        packageId = allocationPackageId(pkg);
      const followupFile = hash ? JSON.parse(await readFile(hash, "utf8")) : null;
      if (
        followupFile &&
        (followupFile.kind !== "synthetic-customer60-followups" || followupFile.synthetic !== true)
      )
        throw Error("EXPLICIT_SYNTHETIC_FOLLOWUPS_REQUIRED");
      const actor = await existingCustomerEvaluationActor(),
        plan = await prepareCustomerEvaluationPlan(actor, new Date(), followupFile?.values ?? {});
      const artifact = await putPublicationArtifact(Buffer.from(JSON.stringify(plan)), "json");
      const proposals: ReturnType<typeof finiteManifestProposal>[] = [],
        holds: { caseId: string; reason: string }[] = [];
      for (const entry of plan.cases) {
        if (entry.classification !== "provider_ready" || !actor) {
          holds.push({ caseId: entry.caseId, reason: entry.hold ?? "EXISTING_SYNTHETIC_ACTOR_UNAVAILABLE" });
          continue;
        }
        try {
          await assertCustomerEvaluationActor(plan, entry);
          const manifest = prepareCustomerFiniteManifest(plan, artifact, entry.caseId, packageId);
          for (const work of manifest.works) await assertFiniteWorkBindings(work);
          const expiry = new Date(
            Math.min(Date.parse(plan.expiresAt), existing ? Date.parse(existing.expiresAt) : Infinity),
          ).toISOString();
          proposals.push(finiteManifestProposal(manifest, expiry));
        } catch (error) {
          holds.push({
            caseId: entry.caseId,
            reason:
              error instanceof Error && /^[A-Z_]{3,100}$/.test(error.message)
                ? error.message
                : "CUSTOMER_PREPARATION_FAILED",
          });
        }
      }
      const report = {
        kind: "original-customer60-disabled-proposals",
        package: pkg,
        packageId,
        plan: artifact,
        cases: plan.cases.map(({ input: _input, request: _request, ...record }) => record),
        proposals,
        holds,
        originalCases: 60,
        automaticFollowups: 0,
        providerCalls: 0,
        approvalRowsWritten: 0,
        enabled: false,
        formalAcceptance: false,
      };
      const privateReportArtifact = await putPublicationArtifact(Buffer.from(JSON.stringify(report)), "json");
      console.log(
        JSON.stringify({
          originalCases: 60,
          preparedCases: proposals.length,
          attemptSlots: proposals.length * 2,
          heldCases: holds.length,
          providerCalls: 0,
          approvalRowsWritten: 0,
          formalAcceptance: false,
          privateReportArtifact,
        }),
      );
      return;
    }
    if (mode === "--admit") {
      const report = JSON.parse(
        (await getPublicationArtifact({ id: id!, hash: hash!, extension: "json" })).toString(),
      );
      if (
        report.kind !== "original-customer60-disabled-proposals" ||
        report.packageId !== allocationPackageId(report.package)
      )
        throw Error("CUSTOMER_PREPARED_REPORT_INVALID");
      const selected = report.proposals.filter(
        (p: ReturnType<typeof finiteManifestProposal>) =>
          p.manifest.packageId === report.packageId &&
          p.manifest.works.every((w) => w.bindings.caseId === caseId),
      );
      if (selected.length !== 1) throw Error("EXACT_CUSTOMER_CASE_REQUIRED");
      const admitted = await registerPreparedInferenceSubmanifest(
        new InferenceBudgetStore(pool, "public", "additional-new"),
        selected[0].manifest,
        selected[0].expiresAt,
        assertFiniteWorkBindings,
      );
      console.log(JSON.stringify(admitted));
      return;
    }
    const row = (
      await pool.query("select manifest,manifest_hash from valo_inference_batches where id=$1", [id])
    ).rows[0];
    if (!row || requestDigest(row.manifest) !== row.manifest_hash) throw Error("INFERENCE_MANIFEST_INVALID");
    const manifest = row.manifest as FiniteManifest,
      primary = manifest.works.find((w) => !w.retryOf);
    if (!primary?.bindings.customerPlan || !manifest.packageId) throw Error("CUSTOMER_RUNNER_SCOPE_INVALID");
    const { plan, entry } = await validateCustomerEvaluationWork(primary, getPublicationArtifact);
    const expected = prepareCustomerFiniteManifest(
      plan,
      primary.bindings.customerPlan,
      entry.caseId,
      manifest.packageId,
    );
    if (requestDigest(expected) !== row.manifest_hash) throw Error("CUSTOMER_RUNNER_MANIFEST_CHANGED");
    const [
      { withApprovedInferenceWork, provideFiniteWorkBindings },
      { createCustomerAIDraft, customerAIUsage },
      { organizeCustomerDraft },
    ] = await Promise.all([
      import("../lib/managed-inference"),
      import("../lib/valo-customer-ai"),
      import("../lib/valo-customer-ai-model"),
    ]);
    // This command is the composition root: the dispatcher checks approved work with these.
    provideFiniteWorkBindings(assertFiniteWorkBindings);
    const actor = plan.actor!;
    const result = await executePreparedCustomerCase(id!, manifest, plan, {
      recheck: async () => {
        for (const work of manifest.works) await assertFiniteWorkBindings(work);
        return assertCustomerEvaluationActor(plan, entry);
      },
      withWork: withApprovedInferenceWork,
      usage: () => customerAIUsage(workspaceActorFromRecord(actor)),
      recentRequests: async () =>
        Number(
          (
            await pool.query(
              "select count(*) as n from valo_ai_drafts where workspace_id=$1 and created_at >= now()-interval '1 minute'",
              [actor.workspaceId],
            )
          ).rows[0].n,
        ),
      create: async (input) => {
        let newProviderAttempts: number | null = 0;
        const preview = await createCustomerAIDraft(
          workspaceActorFromRecord(actor),
          input,
          async (current) => {
            newProviderAttempts = null;
            const response = await organizeCustomerDraft(current);
            newProviderAttempts = response.runs.filter((run) => run.outboundAttempted).length;
            return response;
          },
        );
        return { preview, newProviderAttempts };
      },
      stored: async (previewId) => {
        const saved = (
          await pool.query(
            `select input_hash,provider_input_hash,provider_runs from valo_ai_drafts
          where id=$1 and workspace_id=$2 and actor_id=$3`,
            [previewId, actor.workspaceId, actor.identityId],
          )
        ).rows[0];
        if (!saved) throw Error("CUSTOMER_RESULT_UNAVAILABLE");
        return {
          inputHash: saved.input_hash,
          providerInputHash: saved.provider_input_hash,
          providerRuns: saved.provider_runs,
        };
      },
    });
    const report = {
      kind: "original-customer60-current-run",
      completedAt: new Date().toISOString(),
      batchId: id,
      manifestHash: row.manifest_hash,
      plan: primary.bindings.customerPlan as ArtifactRef,
      originalCases: 60,
      cases: plan.cases.map((c) =>
        c.caseId === result.caseId
          ? result
          : {
              caseId: c.caseId,
              caseHash: c.caseHash,
              status: "not_executed",
              classification: c.classification,
              hold: c.hold,
              providerQualityAccepted: false,
              targetBoundaryProved: false,
            },
      ),
      executedCases: 1,
      actualNewProviderAttempts: result.actualNewProviderAttempts,
      formalAcceptance: false,
      AI008Accepted: false,
    };
    const resultArtifact = await putPublicationArtifact(Buffer.from(JSON.stringify(report)), "json");
    console.log(
      JSON.stringify({
        caseId: result.caseId,
        status: result.status,
        originalCases: 60,
        executedCases: 1,
        actualNewProviderAttempts: result.actualNewProviderAttempts,
        formalAcceptance: false,
        resultArtifact,
      }),
    );
  } finally {
    await pool.end();
  }
}
main().catch((error) => {
  console.error(
    error instanceof Error && /^[A-Z_]{3,100}$/.test(error.message)
      ? error.message
      : "CUSTOMER_FINITE_RUN_FAILED",
  );
  process.exitCode = 1;
});
