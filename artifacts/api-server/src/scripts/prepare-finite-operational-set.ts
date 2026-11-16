import { desc } from "drizzle-orm";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { db, pool, valoContentVersions } from "@workspace/db";
import { assertDevelopmentRuntime } from "../lib/valo-development-runtime";
import { operationalInferenceTemplateIds } from "../lib/inference-operational-coverage";
import { readOperationalInferenceReadiness } from "../lib/inference-operational-ready";
import { prepareOperationalCandidateRelease } from "../editorial/operational-preparation";
import { getPublicationArtifact } from "../editorial/publication-artifacts";
import { publicationWorkspaceRoot } from "../editorial/operational-policy";
import type { ReleaseAttestations } from "../editorial/publication-publisher";

/** Original supplied content only; no authoring, model review, publication,
 * inference approval or quota operation. Each item runs its real gates. */
async function main() {
  assertDevelopmentRuntime();
  let [snapshotPath, ...extra] = process.argv.slice(2);
  if (!snapshotPath || extra.length) throw Error("VERIFIED_PERMISSION_SNAPSHOT_REQUIRED");
  const rows = await db.select().from(valoContentVersions).orderBy(desc(valoContentVersions.version));
  let scratch: string | undefined;
  try {
    if (snapshotPath.startsWith("candidate:")) {
      const seed = await readOperationalInferenceReadiness(snapshotPath.slice("candidate:".length));
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
    const outcomes: { templateId: string; state: string; candidateVersionId?: string; reason?: string }[] =
      [];
    for (const templateId of operationalInferenceTemplateIds) {
      const latest = rows.find((r) => r.templateId === templateId);
      if (latest) {
        try {
          await readOperationalInferenceReadiness(latest.id);
          outcomes.push({
            templateId,
            state: "unchanged-ready-for-independent-reviews",
            candidateVersionId: latest.id,
          });
          continue;
        } catch {
          /* Current intake must pass new evidence gates; no old verdict is reused. */
        }
      }
      try {
        const saved = await prepareOperationalCandidateRelease(templateId, snapshotPath);
        outcomes.push({
          templateId,
          state: "saved-held-pending-independent-reviews",
          candidateVersionId: saved.id,
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
    console.log(
      JSON.stringify({ outcomes, newInferenceCalls: 0, approvalRowsWritten: 0, publicationAccepted: false }),
    );
  } finally {
    if (scratch) await rm(scratch, { recursive: true, force: true });
  }
}
main()
  .catch((e) => {
    console.error(
      e instanceof Error && /^[A-Z_]{3,100}$/.test(e.message)
        ? e.message
        : "OPERATIONAL_SET_PREPARATION_FAILED",
    );
    process.exitCode = 1;
  })
  .finally(() => pool.end());
