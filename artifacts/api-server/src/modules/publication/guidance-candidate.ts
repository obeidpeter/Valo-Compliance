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

/** What every guide covers, in the words the guide page and its files show under "What it covers". */
export const GUIDE_SCOPE =
  "Nigeria's national rules on this subject. It does not cover rules made by a state, the Federal Capital Territory or a local government.";
/** Every guide's limits, in the words shown under "Limits you should know". */
export const GUIDE_LIMITATIONS =
  "General information, not advice on your own situation. It does not decide whether a rule applies to your business or whether your business complies. A rule can change after the date the sources were checked. Read the official source, and ask a qualified adviser about your own case.";
/** A guide's sources are checked again within this many days, the cadence the source gate applies
 * to every subject a guide covers (sourceTargetAllowed). */
export const GUIDE_REVIEW_DAYS = 30;

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
  const scope = GUIDE_SCOPE,
    limitations = GUIDE_LIMITATIONS;
  const reviewedAt = now.toISOString(),
    reviewBy = new Date(+now + GUIDE_REVIEW_DAYS * 86400000).toISOString();
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
