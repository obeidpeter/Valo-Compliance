import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { db, pool, valoContentVersions } from "@workspace/db";
import { sha256 } from "@workspace/valo-core";
import { getPublicationArtifact } from "../editorial/publication-artifacts";
import { publicationWorkspaceRoot } from "../editorial/operational-policy";
import type { ReleaseAttestations } from "../editorial/publication-publisher";
async function main() {
  if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT)
    throw Error("DEVELOPMENT_ONLY");
  const root = publicationWorkspaceRoot();
  const tests = [];
  for (const name of ["foundation", "api", "database", "customer-db"]) {
    const output = await readFile(
      resolve(root, `generated-artifacts/valo-publication/${name}-tests.log`),
      "utf8",
    );
    tests.push({
      name,
      passed: Number(output.match(/ℹ pass (\d+)/)?.[1]),
      failed: Number(output.match(/ℹ fail (\d+)/)?.[1]),
      skipped: Number(output.match(/ℹ skipped (\d+)/)?.[1]),
      outputHash: sha256(output),
    });
  }
  const versions = await db.select().from(valoContentVersions);
  const providers = [];
  let exportChecks = 0;
  for (const row of versions) {
    const a = row.attestations as ReleaseAttestations;
    for (const ref of [a.exports.docx, a.exports.pdf]) {
      await getPublicationArtifact(ref);
      exportChecks++;
    }
    const reviews = [];
    for (const ref of a.reviews) {
      const r = JSON.parse((await getPublicationArtifact(ref)).toString());
      reviews.push({
        role: r.role,
        providerResponseId: r.providerResponseId,
        model: r.model,
        verdict: r.output.verdict,
        findings: r.output.findings,
        missingEvidence: r.output.missingEvidence,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        latencyMs: r.latencyMs,
        reviewAsOf: r.reviewAsOf ?? null,
      });
    }
    const p = JSON.parse((await getPublicationArtifact(a.provenance)).toString());
    providers.push({
      versionId: row.id,
      version: row.version,
      status: row.status,
      candidateHash: row.candidateHash,
      recordedAuthoringReceipt: p.generation ?? null,
      reviews,
    });
  }
  const report = {
    executedAt: new Date().toISOString(),
    tests,
    actualIndependentReviewCalls: providers.reduce((n, p) => n + p.reviews.length, 0),
    actualAuthoringCalls: providers.filter((p) => p.recordedAuthoringReceipt).length,
    realPrivateExportChecks: exportChecks,
    providers,
    actualPublishedVersions: versions.filter((v) => v.status === "published").length,
    realEligibleDevelopmentReleaseProved: false,
    realWithdrawalDrillProved: false,
    historicalDraftWithdrawalPreservationProved: false,
    deterministicOperationalEligibilityFixture:
      "Passed, synthetic engineering fixture only; not publication evidence",
    policyAuthority: "Existing master and explicit operational refinement; no invented per-item approval",
    commercialLicenceAccepted: false,
    r1Accepted: false,
    r2Unlocked: false,
    publicLaunchEnabled: false,
    livePaymentsEnabled: false,
    unresolved:
      "Inspect each retained version's actual verdicts and the current rights/hold evidence. Counts alone do not prove eligibility, provider permission, withdrawal, sales approval or R1 acceptance; no override or synthetic release may substitute.",
  };
  await writeFile(
    resolve(root, "docs/valo/evidence/operational-publication-checkpoint.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  process.stdout.write(
    JSON.stringify({
      tests,
      actualReviewCalls: report.actualIndependentReviewCalls,
      actualAuthoringCalls: report.actualAuthoringCalls,
      realPrivateExportChecks: exportChecks,
      actualPublishedVersions: report.actualPublishedVersions,
    }) + "\n",
  );
}
try {
  await main();
} catch {
  process.stderr.write("CHECKPOINT_COLLECTION_FAILED\n");
  process.exitCode = 1;
} finally {
  await pool.end();
}
