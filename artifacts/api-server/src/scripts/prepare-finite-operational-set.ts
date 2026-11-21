import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { pool } from "@workspace/db";
import { assertDevelopmentRuntime } from "../platform/valo-development-runtime";
import { operationalInferenceTemplateIds } from "../modules/publication";
import { readOperationalInferenceReadiness } from "../modules/ai-lanes";
import { prepareOperationalCandidateRelease } from "../modules/editorial";
import {
  getPublicationArtifact,
  publicationWorkspaceRoot,
  readPreparedCandidate,
  type ReleaseAttestations,
} from "../modules/publication";

/** Original supplied content only; no authoring, model review, publication,
 * inference approval or quota operation. Each item runs its real gates and, when they pass, is
 * kept as a prepared candidate awaiting its two finite reviews (decision 0014). The seed
 * candidate:<artifact id>:<sha256> reuses a prepared candidate's retained provider terms. */
async function main() {
  assertDevelopmentRuntime();
  let [snapshotPath, ...extra] = process.argv.slice(2);
  if (!snapshotPath || extra.length) throw Error("VERIFIED_PERMISSION_SNAPSHOT_REQUIRED");
  let scratch: string | undefined;
  try {
    const seedRef = /^candidate:([a-f0-9-]{36}):([a-f0-9]{64})$/.exec(snapshotPath);
    if (snapshotPath.startsWith("candidate:")) {
      if (!seedRef) throw Error("VERIFIED_PERMISSION_SNAPSHOT_REQUIRED");
      const artifact = { id: seedRef[1]!, hash: seedRef[2]!, extension: "json" as const };
      const prepared = await readPreparedCandidate(artifact);
      const seed = await readOperationalInferenceReadiness({
        candidateVersionId: prepared.versionId,
        candidateArtifact: { ...artifact, templateId: prepared.templateId },
      });
      const rights = JSON.parse(
        (await getPublicationArtifact((seed.row.attestations as ReleaseAttestations).rights)).toString(),
      );
      if (rights.snapshot.hash !== seed.serverEvidence.providerSnapshotHash)
        throw Error("PERMISSION_SNAPSHOT_BINDING_CHANGED");
      const bytes = await getPublicationArtifact(rights.snapshot);
      const directory = join(publicationWorkspaceRoot(), "generated-artifacts/valo-completion");
      await mkdir(directory, { recursive: true, mode: 0o700 });
      scratch = await mkdtemp(join(directory, "finite-permission-"));
      snapshotPath = join(scratch, "terms.json");
      await writeFile(snapshotPath, bytes, { flag: "wx", mode: 0o600 });
    }
    const outcomes: {
      templateId: string;
      state: string;
      candidateVersionId?: string;
      candidateArtifact?: { id: string; hash: string; extension: "json"; templateId: string };
      reason?: string;
    }[] = [];
    for (const templateId of operationalInferenceTemplateIds) {
      try {
        const saved = await prepareOperationalCandidateRelease(templateId, snapshotPath);
        if (saved.candidateArtifact)
          outcomes.push({
            templateId,
            state: "prepared-pending-independent-reviews",
            candidateVersionId: saved.id,
            candidateArtifact: saved.candidateArtifact,
          });
        else
          outcomes.push({
            templateId,
            state: "held",
            candidateVersionId: saved.id,
            reason: saved.providerFailure ?? "OPERATIONAL_PREPARATION_HELD",
          });
      } catch (error) {
        outcomes.push({
          templateId,
          state: "held",
          reason:
            error instanceof Error && /^[A-Z_]{3,100}$/.test(error.message)
              ? error.message
              : "OPERATIONAL_PREPARATION_FAILED",
        });
      }
    }
    // The options finite-inference-run.ts --prepare takes to plan these candidates' reviews.
    const prepareOptions = outcomes.flatMap((o) =>
      o.candidateArtifact ? [`--candidate=${o.candidateArtifact.id}:${o.candidateArtifact.hash}`] : [],
    );
    console.log(
      JSON.stringify({
        outcomes,
        prepareOptions,
        newInferenceCalls: 0,
        approvalRowsWritten: 0,
        publicationAccepted: false,
      }),
    );
  } finally {
    if (scratch) await rm(scratch, { recursive: true, force: true });
  }
}
try {
  await main();
} catch (e) {
  console.error(
    e instanceof Error && /^[A-Z_]{3,100}$/.test(e.message)
      ? e.message
      : "OPERATIONAL_SET_PREPARATION_FAILED",
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
