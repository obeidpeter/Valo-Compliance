/**
 * The record a retained regulatory guide is filed with (docs/architecture/guidance-record.md, CMP-001),
 * taken word for word from its own editorial lines in its pinned draft file, where its file's form has
 * them:
 * - GUD-01 to GUD-10: "Applicability", and "Action / evidence" up to its "Related content";
 * - GUD-11 to GUD-18: the "Metadata" line's scope and required facts, and the templates its "Related
 *   template(s)" names;
 * - GUD-19 to GUD-26: the claim map's "Applicability" or "Scope" sentence, which two of the eight have;
 * - GUD-27 to GUD-30: the "Audience condition" and the templates "Related templates" names.
 * A field a draft does not say is left out. The lines are written for staff, so a Content editor puts
 * them in customer words before the owner signs; nothing here is published.
 */
export type ProposedGuidanceRecord = {
  appliesTo: string | null;
  actionEvidence: string | null;
  relatedTemplates: string[];
};

/** A guide's whole section of its draft file, from its heading to the next guide's. */
export function guideSection(sourceText: string, id: string, title: string) {
  const parts = sourceText.split(`## ${id} — ${title}`);
  if (parts.length !== 2) throw Error("GUIDANCE_HEADING_NOT_UNIQUE");
  return parts[1]!.split(/^## GUD-\d{2} — /m)[0]!;
}

/** A line's text, without Markdown's emphasis marks, which are not words. */
export const recordWords = (text: string) => text.replaceAll("**", "").replace(/\s+/g, " ").trim();
const line = (section: string, label: RegExp) => {
  const found = section.split("\n").find((row) => label.test(row));
  return found === undefined ? null : found.replace(label, "");
};
const templateNumbers = (text: string | null) => [...new Set(text?.match(/\bTPL-\d{2}\b/g) ?? [])];
const none: ProposedGuidanceRecord = { appliesTo: null, actionEvidence: null, relatedTemplates: [] };

export function guidanceRecordFromSection(id: string, section: string): ProposedGuidanceRecord {
  const number = Number(id.slice(4));
  if (number <= 10) {
    const applicability = line(section, /^- \*\*Applicability:\*\* /);
    const action = line(section, /^- \*\*Action \/ evidence:\*\* /);
    return {
      appliesTo: applicability === null ? null : recordWords(applicability),
      actionEvidence: action === null ? null : recordWords(action.split(/ Related content:/)[0]!),
      relatedTemplates: [],
    };
  }
  if (number <= 18) {
    const metadata = line(section, /^\*\*Metadata:\*\* /);
    if (metadata === null) return none;
    // The scope and required facts run up to the related templates, which the line names last but for
    // a note on how its paragraphs are counted, or a gate.
    const [scope, related = null] = metadata.split(/ (?=(?:Suggested related|Related) templates?=)/);
    return {
      appliesTo: recordWords(scope!),
      actionEvidence: null,
      relatedTemplates: templateNumbers(related),
    };
  }
  if (number <= 26) {
    const map = line(section, /^\*\*Internal claim map:\*\* /);
    const sentence = map === null ? null : /(?:^|\. )(?:Applicability|Scope): ([^.]+\.)/.exec(map);
    return sentence ? { ...none, appliesTo: recordWords(sentence[1]!) } : none;
  }
  const audience = line(section, /^- Audience condition: /);
  return {
    appliesTo: audience === null ? null : recordWords(audience),
    actionEvidence: null,
    relatedTemplates: templateNumbers(line(section, /^- Related templates: /)),
  };
}
