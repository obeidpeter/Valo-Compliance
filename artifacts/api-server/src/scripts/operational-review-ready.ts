import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { openai } from "@workspace/integrations-openai-ai-server";
import { desc, eq, sql } from "drizzle-orm";
import { db, pool, valoContentVersions } from "@workspace/db";
import { digest, publicationSchema } from "@workspace/valo-core";
import { getPublicationArtifact, putPublicationArtifact } from "../editorial/publication-artifacts";
import { readOperationalIntake } from "../editorial/operational-intake";
import { inventoryCandidate } from "../editorial/operational-content";
import { loadChatGPTPermission } from "../editorial/rights-applicability";
import {
  operationalPolicy,
  publicationWorkspaceRoot,
  developmentPublicationOnly,
} from "../editorial/operational-policy";
import { operationalMechanicalChecks } from "../editorial/operational-mechanical";
import { inspectOperationalExports } from "../editorial/operational-export-inspection";
import {
  saveOperationalReviewPlan,
  executeOperationalReviewPlan,
  type OperationalServerEvidence,
} from "../editorial/operational-review";
import { meterReviewRequest } from "../editorial/review-meter";
import type { ReleaseAttestations } from "../editorial/publication-publisher";
async function main() {
  developmentPublicationOnly();
  // This command NEVER dispatches a model, raises a cap, or changes a candidate.
  const [row] = await db
    .select()
    .from(valoContentVersions)
    .where(eq(valoContentVersions.templateId, "TPL-07"))
    .orderBy(desc(valoContentVersions.version))
    .limit(1);
  if (!row) throw Error("SAVED_INVENTORY_CANDIDATE_REQUIRED");
  const bundle = publicationSchema.parse(row.bundle),
    candidate = bundle.candidate,
    a = row.attestations as ReleaseAttestations;
  const provenance = JSON.parse((await getPublicationArtifact(a.provenance)).toString());
  const rights = JSON.parse((await getPublicationArtifact(a.rights)).toString());
  const snapshot = JSON.parse((await getPublicationArtifact(rights.snapshot)).toString());
  const intake = await readOperationalIntake("TPL-07", row.version),
    { policy } = await operationalPolicy();
  if (
    intake.sourceHash !== provenance.hash ||
    intake.manifestHash !== provenance.noteHash ||
    policy.hash !== bundle.policy.hash ||
    candidate.hash !== row.candidateHash
  )
    throw Error("SAVED_PLAN_INPUT_CHANGED");
  const original = await inventoryCandidate(row.version, new Date(candidate.sourceCheckDate), {
    original: intake.section.body,
    provenance,
  });
  if (JSON.stringify(original.document) !== candidate.body)
    throw Error("SAVED_BODY_NOT_EXACT_CURRENT_INTAKE");
  const applicability = await loadChatGPTPermission(snapshot, provenance);
  const checks = operationalMechanicalChecks({
    candidate,
    policy,
    provenance,
    provenanceArtifactHash: a.provenance.hash,
    rights,
    applicability,
    snapshot,
    now: new Date(),
  });
  if (!applicability.verified || checks.some((c) => c.result !== "pass"))
    throw Error("SAVED_PLAN_MECHANICAL_HOLD");
  const exportReport = await inspectOperationalExports(candidate, {
    docx: await getPublicationArtifact(a.exports.docx),
    pdf: await getPublicationArtifact(a.exports.pdf),
  });
  if (!exportReport.passed) throw Error("SAVED_PLAN_EXPORT_HOLD");
  const storedReport = JSON.parse((await getPublicationArtifact(a.exportReport)).toString());
  if (digest(exportReport) !== digest(storedReport)) throw Error("SAVED_EXPORT_CHECK_CHANGED");
  const serverEvidence: OperationalServerEvidence = {
    candidateHash: candidate.hash,
    policyHash: policy.hash,
    sourceCheckedAt: candidate.sourceCheckDate,
    sourceHash: provenance.hash,
    provenanceArtifactHash: a.provenance.hash,
    rightsArtifactHash: a.rights.hash,
    exportReportArtifactHash: a.exportReport.hash,
    providerSnapshotHash: rights.snapshot.hash,
    authoringRoute: rights.authoringRoute,
    sourceAttribution: "Retained authoring attribution; no independently certified upstream model/run",
    performedChecks: checks.map((c) => c.name),
  };
  const { evidence: includedInPermissions, ...permissionScope } = applicability.record;
  const plan = await saveOperationalReviewPlan(
    candidate,
    {
      permissions: rights.permissions,
      conclusion: rights.conclusion,
      customerLicenceAccepted: false,
      providerPermissionScope: permissionScope,
    },
    {
      authoringRoute: provenance.authoringRoute,
      sourceHash: provenance.hash,
      sourcePath: provenance.path,
      originalItem: original.original,
      actualAuthoringAttribution: intake.authoringAttribution,
      authoringNoteHash: provenance.noteHash,
      adaptation: provenance.transformation,
      upstreamModelAndRunNotRecorded: true,
    },
    exportReport,
    serverEvidence,
  );
  const live =
    await db.execute(sql`select now() as checked_at,current_setting('TimeZone') as database_timezone,
    count(*) filter(where role<>'draft' and created_at>=date_trunc('day',now()))::int as reviews_today,
    count(*) filter(where role='draft' and created_at>=date_trunc('day',now()))::int as authoring_today,
    sum(input_tokens) filter(where role<>'draft' and created_at>=date_trunc('day',now())) as known_input_tokens_today,
    sum(output_tokens) filter(where role<>'draft' and created_at>=date_trunc('day',now())) as known_output_tokens_today,
    count(*) filter(where role<>'draft' and created_at>=date_trunc('day',now()) and
      (input_tokens is null or output_tokens is null))::int as reviews_with_unknown_usage_today
    from valo_publication_ai_attempts`);
  const guards: { case: string; result: string }[] = [];
  let outboundAttempts = 0;
  if (process.env.VALO_PROVE_REVIEW_PLAN_GUARDS === "synthetic-development-only") {
    // Hard-disable this CLI process's SDK transport. Never inject a success,
    // fabricate provider findings, or risk a charge while testing a guard.
    const originalCreate = openai.chat.completions.create;
    Object.defineProperty(openai.chat.completions, "create", {
      configurable: true,
      value: () => {
        outboundAttempts++;
        throw Error("NETWORK_DISABLED_DURING_GUARD_PROOF");
      },
    });
    try {
      await assert.rejects(
        () => executeOperationalReviewPlan(plan, candidate, serverEvidence),
        /INFERENCE_BUDGET_DISABLED/,
      );
      guards.push({ case: "no approved finite-work context", result: "rejected before transport" });
      const badPlan = async (mutator: (p: typeof plan) => void) => {
        const copy = structuredClone(plan);
        mutator(copy);
        const artifact = await putPublicationArtifact(
          Buffer.from(JSON.stringify({ manifest: copy.manifest, entries: copy.entries })),
          "json",
        );
        if (artifact.extension !== "json") throw Error("REVIEW_PLAN_ARTIFACT_TYPE_INVALID");
        copy.artifact = { ...artifact, extension: "json" };
        return copy;
      };
      const stale = await badPlan((p) => {
        p.manifest.expiresAt = new Date(Date.now() - 1).toISOString();
      });
      await assert.rejects(
        () => executeOperationalReviewPlan(stale, candidate, serverEvidence),
        /REVIEW_PLAN_INVALID_OR_STALE/,
      );
      guards.push({ case: "expired plan with actual hash-matching private artifact", result: "rejected" });
      const changed = await badPlan((p) => {
        p.entries[0].request.messages[1]!.content += " tampered";
      });
      await assert.rejects(
        () => executeOperationalReviewPlan(changed, candidate, serverEvidence),
        /REVIEW_PLAN_INVALID_OR_STALE/,
      );
      guards.push({ case: "changed request with old input meter", result: "rejected" });
      const raised = await badPlan((p) => {
        p.entries[0].request.max_completion_tokens = 16384;
        p.entries[0].meter = meterReviewRequest(p.entries[0].request);
      });
      await assert.rejects(
        () => executeOperationalReviewPlan(raised, candidate, serverEvidence),
        /REVIEW_PLAN_REQUEST_CHANGED/,
      );
      guards.push({ case: "increased output budget with recomputed request hash", result: "rejected" });
      await assert.rejects(
        () =>
          executeOperationalReviewPlan(plan, candidate, {
            ...serverEvidence,
            rightsArtifactHash: "0".repeat(64),
          }),
        /REVIEW_PLAN_INVALID_OR_STALE/,
      );
      guards.push({ case: "mismatched rights evidence binding", result: "rejected" });
      assert.equal(outboundAttempts, 0);
      const after = await db.execute(sql`select count(*)::int as total from valo_publication_ai_attempts
        where role<>'draft' and created_at>=date_trunc('day',now())`);
      assert.equal(Number(after.rows[0].total), Number(live.rows[0].reviews_today));
    } finally {
      Object.defineProperty(openai.chat.completions, "create", { configurable: true, value: originalCreate });
    }
  }
  const report = {
    executedAt: new Date().toISOString(),
    candidateId: row.id,
    version: row.version,
    status: row.status,
    manifest: plan.manifest,
    privatePlan: plan.artifact,
    mechanicalChecks: checks,
    exportCheckPassed: exportReport.passed,
    liveReservations: live.rows[0],
    providerCalls: 0,
    reservationsCreated: 0,
    eligiblePublished: false,
    guards,
    sdkTransportInvocationsDuringGuardProof: outboundAttempts,
    dispatchBlocked:
      plan.manifest.status !== "mechanically_planned_not_reserved"
        ? "input_size"
        : "finite_work_not_authorized",
    legacyDailyCountsAreObservationOnly: true,
    r1Accepted: false,
    r2Unlocked: false,
    livePaymentsEnabled: false,
    publicLaunchEnabled: false,
  };
  const directory = resolve(publicationWorkspaceRoot(), "generated-artifacts/valo-completion");
  await mkdir(directory, { recursive: true });
  await writeFile(
    resolve(directory, "operational-review-ready.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      candidateVersion: row.version,
      planHash: plan.artifact.hash,
      requestMeters: plan.manifest.entries.map((e) => ({ role: e.role, meter: e.meter })),
      liveReservations: live.rows[0],
      dispatchBlocked: report.dispatchBlocked,
      providerCalls: 0,
    }),
  );
}
main()
  .catch((error) => {
    console.error(
      error instanceof Error && /^[A-Z_]+$/.test(error.message)
        ? error.message
        : "OPERATIONAL_REVIEW_PLAN_FAILED",
    );
    process.exitCode = 1;
  })
  .finally(() => pool.end());
