import { guideAmendmentRecords } from "./guidance-amendments";
import { capturedTexts } from "./guidance-captured-texts";

/**
 * What the repository's claim maps and amendment records say of an official source lead
 * (docs/architecture/source-register.md, slice 1): the body that issued its text and the kind of
 * instrument, from the captured text its passages are cut from, and the day its text took effect, from
 * that text or from its amendment record. A fact they do not record is null, for staff to complete.
 */
export function repositorySourceFacts(leadId: string, url: string) {
  const text = capturedTexts.find((entry) => entry.leadId === leadId);
  const record = guideAmendmentRecords.find((entry) => entry.url === url);
  const effective = text?.effectiveFrom ?? record?.commencement.effectiveFrom ?? null;
  return {
    authority: text?.issuingBody ?? null,
    instrument: text?.kind ?? null,
    // The day as the record writes it, at midnight on a Lagos clock.
    effectiveFrom: effective === null ? null : effective.slice(0, 10),
  };
}
