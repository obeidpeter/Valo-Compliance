import { formatDay } from "./format";

/**
 * The staff and owner screens' words for a regulatory guide's record (docs/architecture/guidance-record.md,
 * CMP-001): whom it applies to, what to do and keep, and its related templates. A guide is published only
 * with whom it applies to. The record a guide is filed with comes from its draft's editorial lines, which
 * are written for staff, so a Content editor puts them in customer words before the owner signs. The
 * words are the owner's to confirm.
 */
export const recordLegend = "What the guide records";
export const recordHint =
  "A regulatory guide is published only with whom it applies to. The owner signs these with its text.";
export const draftLinesNote =
  "A guide filed from its draft brings the draft's editorial lines here, which are written for staff. Put them in customer words before the owner signs.";
export const appliesToLabel = "Who it applies to";
export const appliesToHelp = "Whom the guide concerns, and when. Up to 800 characters.";
export const actionEvidenceLabel = "What to do and keep";
export const actionEvidenceHelp =
  "The steps a business takes, and the records that show them. Up to 800 characters.";
export const relatedTemplatesLabel = "Related templates";
export const relatedTemplatesHelp =
  "Up to 6 registered template numbers, separated by commas, such as TPL-16, TPL-17.";
export const editorMissingScope =
  "Before the owner can sign this version, say whom it applies to, then save it again.";
export const ownerMissingScope =
  "This version does not say whom it applies to. A Content editor saves a new version that says it before you can sign.";

/** The template numbers typed in the editor, as the draft sends them: upper case, each once. */
export function templateNumbers(text: string) {
  return [
    ...new Set(
      text
        .split(/[\s,;]+/)
        .map((number) => number.trim().toUpperCase())
        .filter(Boolean),
    ),
  ];
}

/** A related template on the owner's panel: its number, and its registered title where it has one. */
export function relatedTemplateLine(template: { number: string; title: string | null }) {
  return template.title ? `${template.number} ${template.title}` : template.number;
}

/** The retained drafts panel: guides whose drafts say whom they apply to, not filed with their latest
 * version yet. */
export function recordWaiting(count: number, formatted: string) {
  return `${formatted} filed regulatory ${count === 1 ? "guide does" : "guides do"} not yet say whom ${
    count === 1 ? "it applies" : "they apply"
  } to, while ${count === 1 ? "its draft does" : "their drafts do"}. Filing saves the record each draft's editorial lines give with a new draft version, keeping the text of the latest one. The lines are written for staff: put them in customer words before the owner signs.`;
}
export const fileRecordButton = "File the proposed records";
export function recordFiled(count: number, formatted: string) {
  return `Filed the record of ${formatted} regulatory ${count === 1 ? "guide" : "guides"} as a new draft version. Each is private until the owner signs it.`;
}
export const recordStates = {
  filed: "Who it applies to: filed with the latest version",
  proposed: "Who it applies to: in its draft, not filed yet",
  unwritten: "Who it applies to: not in its draft. A Content editor writes it before the owner can sign.",
} as const;

/**
 * The guide's page (docs/architecture/guidance-record.md, slice 2): its record as the owner signed it,
 * in place of the fixed "What it covers", and each source with the body that issued it and the day its
 * text took effect, where the source check the guide was released on kept them.
 */
export const pageHeadings = {
  appliesTo: "Who this is for",
  actionEvidence: "What to do and keep",
  relatedTemplates: "Related templates",
} as const;
export const relatedTemplatesHint = "Templates you can use with this guide.";
export function sourceLine(source: { issuingBody?: string | undefined; effectiveFrom?: string | undefined }) {
  const parts = [
    source.issuingBody && `Issued by ${source.issuingBody}`,
    source.effectiveFrom && `in effect from ${formatDay(source.effectiveFrom)}`,
  ].filter(Boolean);
  if (!parts.length) return null;
  const line = parts.join(", ");
  return line.charAt(0).toUpperCase() + line.slice(1);
}
