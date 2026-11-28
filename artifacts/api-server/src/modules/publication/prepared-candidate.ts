import { z } from "zod";
import { isPracticalGuideId, isPreparedRuleId } from "@workspace/valo-core";
import { getPublicationArtifact, type ArtifactRef } from "./publication-artifacts";

/**
 * A candidate prepared for its two reviews but not yet saved (decision 0014). A saved version's
 * bundle can never change, and a held one can never be published, so a candidate is saved as a
 * version only once its reviews have passed, under the ID chosen here and with the reviews in its
 * bundle. Until then it is this private, hash-bound artifact: the bundle (with no reviews), the
 * attestations of its evidence, and where it will be saved.
 */
export const preparedCandidateSchema = z
  .object({
    kind: z.literal("valo-prepared-candidate-v1"),
    versionId: z.string().regex(/^[a-f0-9-]{36}$/),
    // A template's ID, a guide's, or the requirement version of a rule prepared in the repository.
    templateId: z
      .string()
      .refine(
        (id) => /^(?:TPL-\d{2,3}|GUD-\d{2})$/.test(id) || isPracticalGuideId(id) || isPreparedRuleId(id),
      ),
    version: z.number().int().positive(),
    slug: z.string().min(1),
    policyId: z.string().min(1),
    candidateHash: z.string().regex(/^[a-f0-9]{64}$/),
    bundle: z.record(z.string(), z.unknown()),
    attestations: z.record(z.string(), z.unknown()),
    reviewBy: z.string().datetime(),
    preparedAt: z.string().datetime(),
  })
  .strict();
export type PreparedCandidate = z.infer<typeof preparedCandidateSchema>;
export type PreparedCandidateRef = ArtifactRef & { extension: "json"; templateId: string };

export async function savePreparedCandidate(candidate: PreparedCandidate): Promise<PreparedCandidateRef> {
  const parsed = preparedCandidateSchema.parse(candidate);
  // Loaded when a candidate is saved: readers of this module only ever read artifacts.
  const { putPublicationArtifact } = await import("./publication-artifacts");
  const ref = await putPublicationArtifact(Buffer.from(JSON.stringify(parsed)), "json");
  if (ref.extension !== "json") throw Error("PREPARED_CANDIDATE_ARTIFACT_INVALID");
  return { id: ref.id, hash: ref.hash, extension: "json", templateId: parsed.templateId };
}

/** Reads a prepared candidate by its exact artifact; the hash check is the artifact store's. */
export async function readPreparedCandidate(ref: { id: string; hash: string; extension: "json" }) {
  const bytes = await getPublicationArtifact({ id: ref.id, hash: ref.hash, extension: ref.extension });
  return preparedCandidateSchema.parse(JSON.parse(bytes.toString()));
}
