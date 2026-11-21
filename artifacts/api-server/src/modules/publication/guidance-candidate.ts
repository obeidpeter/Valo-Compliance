import { digest, sha256 } from "@workspace/valo-core";
import { guidanceReleaseDocument, type GuideReference } from "./guidance-document";
import { readGuidanceIntake } from "./operational-intake";

/** Where a guide's words came from, as the publisher's provenance check reads it. */
export type GuideProvenance = {
  path: string;
  hash: string;
  sourceText: string;
  note: string;
  noteHash: string;
  authoringRoute: string;
  transformation: string;
  templateId: string;
  version: number;
};

/** What a guide's limits say whichever guide it is. A guide's own exclusions come from its claim map. */
export const GUIDE_LIMITATIONS =
  "Conditional general information, not a compliance determination, comprehensive local coverage or professional review. Use the stated facts, exceptions, source period and official next steps. Development evaluation only; unresolved evidence holds publication.";

/**
 * The canonical guide for one exact R1 guidance ID: its retained words, rebuilt from the intake and
 * checked against the recorded provenance, with the parts a guide shows beside them. `references`
 * are the sources its claim map points to; a guide prepared without one lists none.
 *
 * Building a guide reviews nothing and releases nothing: its claims, sources, rights, reviews and
 * eligibility are separate.
 */
export async function guidanceCandidate(
  id: string,
  version: number,
  now = new Date(),
  recorded?: { original: string; provenance: GuideProvenance },
  references: readonly GuideReference[] = [],
) {
  const intake = await readGuidanceIntake(id, version);
  const provenance = recorded?.provenance ?? intake.provenance,
    original = recorded?.original ?? intake.section.body;
  if (
    provenance.templateId !== id ||
    sha256(provenance.sourceText) !== provenance.hash ||
    sha256(provenance.note) !== provenance.noteHash ||
    original !== intake.section.body ||
    provenance.hash !== intake.sourceHash ||
    provenance.noteHash !== intake.provenance.noteHash
  )
    throw Error("TEMPLATE_PROVENANCE_OR_BODY_MISMATCH");
  const scope: string = intake.catalogue.scope,
    limitations = GUIDE_LIMITATIONS;
  const reviewedAt = now.toISOString(),
    reviewBy = new Date(+now + 90 * 86400000).toISOString();
  const document = guidanceReleaseDocument({
    section: intake.section,
    scope,
    limitations,
    sourcesCheckedAt: reviewedAt,
    references,
  });
  return {
    document,
    scope,
    limitations,
    reviewBy,
    reviewedAt,
    original,
    provenance,
    documentDigest: digest(document),
  };
}
