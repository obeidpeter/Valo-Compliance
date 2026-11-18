import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { desc, eq } from "drizzle-orm";
import { db, pool, valoContentVersions } from "@workspace/db";
import { digest, publicationSchema } from "@workspace/valo-core";
import {
  developmentPublicationOnly,
  publicationWorkspaceRoot,
  getPublicationArtifact,
  operationalMechanicalChecks,
  loadChatGPTPermission,
  type ReleaseAttestations,
} from "../modules/publication";
developmentPublicationOnly();
try {
  const [row] = await db
    .select()
    .from(valoContentVersions)
    .where(eq(valoContentVersions.templateId, "TPL-07"))
    .orderBy(desc(valoContentVersions.version))
    .limit(1);
  if (!row) throw Error("ACTUAL_CANDIDATE_MISSING");
  const bundle = publicationSchema.parse(row.bundle),
    a = row.attestations as ReleaseAttestations;
  const provenance = JSON.parse((await getPublicationArtifact(a.provenance)).toString());
  if (provenance.generation) throw Error("CHECKPOINT_EXPECTS_RETAINED_CHATGPT_CANDIDATE");
  const rights = JSON.parse((await getPublicationArtifact(a.rights)).toString());
  const snapshot = JSON.parse((await getPublicationArtifact(rights.snapshot)).toString());
  const applicability = await loadChatGPTPermission(snapshot);
  const checks = operationalMechanicalChecks({
    candidate: bundle.candidate,
    policy: bundle.policy,
    provenance,
    provenanceArtifactHash: a.provenance.hash,
    rights,
    applicability,
    snapshot,
  });
  const report = {
    executedAt: new Date().toISOString(),
    actualPrivateArtifactsReread: true,
    candidate: {
      templateId: row.templateId,
      version: row.version,
      status: row.status,
      hash: row.candidateHash,
    },
    measuredChecks: checks,
    passCount: checks.filter((c) => c.result === "pass").length,
    previousAttestationMatchesReexecutedChecks: digest(bundle.mechanicalChecks) === digest(checks),
    consequence:
      "A fresh candidate/check manifest and independent passing reviews are required; old generic pass attestations cannot release.",
    contentWrites: 0,
    providerCalls: 0,
    quotaChanges: 0,
    publicationClaimed: false,
    sourceBackedEditorialAcceptanceClaimed: false,
  };
  const outputDirectory = resolve(publicationWorkspaceRoot(), "generated-artifacts/valo-commerce");
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(
    resolve(outputDirectory, "mechanical-actual-candidate.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      version: row.version,
      status: row.status,
      passCount: report.passCount,
      checks: checks.length,
      oldAttestationAccepted: report.previousAttestationMatchesReexecutedChecks,
      providerCalls: 0,
    }),
  );
} finally {
  await pool.end();
}
