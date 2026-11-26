import { eq } from "drizzle-orm";
import { mappedGuideIds, readPreparedCandidate, type ReleaseAttestations } from "../publication";
import { verifyReleasedSources } from "../sources";
import { asDevelopmentOwner, type StaffActor } from "../staff";
import { ValoProblem } from "../../platform/valo-problem";

const NOT_OWNER = "Only the designated development owner can check a guide's sources for its release.";
const NOT_AWAITING = "This guide is not awaiting its reviews. Nothing was recorded.";
const CHANGED =
  "This guide changed since you opened it. Open it again before you confirm its sources. Nothing was recorded.";

/** Why a guide's sources do not hold, in the owner's words, by the code the source check gives. */
function sourceHold(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "SOURCE_CURRENT_CAPTURE_REQUIRED")
    return new ValoProblem(
      409,
      "A copy of one of this guide's official sources is no longer the current one, or was not checked within the last day. Wait for the daily source check, then check again. Nothing was recorded.",
    );
  if (code === "SOURCE_PASSAGE_SNAPSHOT_MISMATCH")
    return new ValoProblem(
      409,
      "One of this guide's official sources no longer holds the words the guide quotes. The guide must be prepared again. Nothing was recorded.",
    );
  if (code === "SOURCE_SNAPSHOT_BINDING_REQUIRED")
    return new ValoProblem(
      409,
      "One of this guide's sources has no copy recorded. The guide must be prepared again. Nothing was recorded.",
    );
  return error;
}

/**
 * The development owner's check of a prepared guide's official sources on the reviewed route
 * (docs/architecture/reviewed-route.md, part 2; decision 0018). The owner confirms the exact candidate they
 * read, by its checksum. Each of its sources' copies must still be its watch's current one, checked within
 * the last day, and hold the guide's passages and every quote. Only then is the check recorded; the
 * database records its time and refuses it from anyone but the development owner.
 *
 * The files are read outside any transaction. Nothing here calls a model, admits a review or publishes.
 */
export async function checkReviewedGuideSources(
  actor: StaffActor,
  versionId: string,
  confirm: string,
  now = new Date(),
) {
  // Refused before any file is read.
  await asDevelopmentOwner(actor, async () => undefined, NOT_OWNER);
  const { db, valoContentVersions, valoPreparedCandidates, valoReviewedGuideChecks } =
    await import("@workspace/db");
  const [prepared] = await db
    .select()
    .from(valoPreparedCandidates)
    .where(eq(valoPreparedCandidates.versionId, versionId));
  if (!prepared || !mappedGuideIds.includes(prepared.templateId)) throw new ValoProblem(404, NOT_AWAITING);
  const candidate = await readPreparedCandidate({
    id: prepared.artifactId,
    hash: prepared.artifactHash,
    extension: "json",
  });
  if (
    candidate.versionId !== versionId ||
    candidate.templateId !== prepared.templateId ||
    candidate.candidateHash !== prepared.candidateHash ||
    confirm !== candidate.candidateHash
  )
    throw new ValoProblem(409, CHANGED);
  if (Date.parse(candidate.reviewBy) <= +now)
    throw new ValoProblem(
      409,
      "This guide's review date has passed. It must be prepared again. Nothing was recorded.",
    );
  const captures = (candidate.attestations as ReleaseAttestations).sourceSnapshots ?? {};
  try {
    await verifyReleasedSources(db, candidate.bundle, captures, now);
  } catch (error) {
    throw sourceHold(error);
  }
  return asDevelopmentOwner(
    actor,
    async (tx) => {
      // A version already released or held needs no check of its sources.
      const [saved] = await tx
        .select({ status: valoContentVersions.status })
        .from(valoContentVersions)
        .where(eq(valoContentVersions.id, versionId));
      if (saved && saved.status !== "candidate") throw new ValoProblem(409, NOT_AWAITING);
      const [recorded] = await tx
        .insert(valoReviewedGuideChecks)
        .values({
          artifactId: prepared.artifactId,
          artifactHash: prepared.artifactHash,
          versionId,
          guideId: prepared.templateId,
          version: prepared.version,
          candidateHash: candidate.candidateHash,
          captures,
          checkedBy: actor.identityId,
        })
        .returning({ checkedAt: valoReviewedGuideChecks.checkedAt });
      return {
        versionId,
        guide: prepared.templateId,
        version: prepared.version,
        candidateHash: candidate.candidateHash,
        checkedAt: recorded!.checkedAt.toISOString(),
        sources: Object.keys(captures).length,
      };
    },
    NOT_OWNER,
  );
}
