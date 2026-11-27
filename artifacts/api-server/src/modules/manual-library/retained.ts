import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { baselineTemplates } from "@workspace/valo-core";
import {
  operationalDocument,
  publicationWorkspaceRoot,
  readGuidanceIntake,
  readPracticalGuideIntake,
  readTemplateIntake,
  retainedIndustryDrafts,
  type OriginalSection,
} from "../publication";
import { practicalDraftPath, retainedContentSections } from "../../lib/retained-content-sections";
import { renderDocument } from "../../lib/valo-render";
import {
  guideSection,
  guidanceRecordFromSection,
  type ProposedGuidanceRecord,
} from "./retained-guidance-record";

/**
 * The 108 drafts kept in the repository, as the staff library files them (plan: content and speed,
 * approved by the owner on 23 November 2026): the 40 baseline templates, the 12 practical guides, the
 * 20 industry introductions, the 6 deeper industry packs and the 30 regulatory guides. Filing a draft
 * makes it a private library draft for an editor to preview and publish; it publishes nothing.
 *
 * Each draft's text is the customer text the reviewed route already cuts from the same pinned file,
 * and a regulatory guide's is exactly that text, as the owner's source check requires. Editorial
 * notes stay out of the text: status lines, related-template suggestions, template connections and
 * source leads. A regulatory guide's record is filed beside its text, from its own editorial lines
 * (`retained-guidance-record.ts`).
 */
export type RetainedKind =
  | "template"
  | "premium_template"
  | "practical_guide"
  | "industry_introduction"
  | "industry_pack"
  | "regulatory_article";
export type RetainedDraft = {
  /** The draft's ID in the repository: TPL-01, GUIDE-C05, IND-C01, PACK-C01 or GUD-01. */
  retainedId: string;
  kind: RetainedKind;
  title: string;
  /** The industry an introduction or pack belongs to, by its address name. */
  industry: string | null;
  body: string;
  /** A template's section, from which its Word file is made when the draft is filed. */
  template?: OriginalSection;
  /** A regulatory guide's record, from its draft's editorial lines (docs/architecture/guidance-record.md). */
  record?: ProposedGuidanceRecord;
};

/** The library item a retained draft is filed under, the same on every run, so filing twice files it
 * once. A name-based UUID (version 5 layout) of the draft's repository ID. */
export function retainedItemId(retainedId: string) {
  const hash = createHash("sha256").update(`valo-retained-draft:${retainedId}`).digest();
  hash[6] = (hash[6]! & 0x0f) | 0x50;
  hash[8] = (hash[8]! & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const capitalised = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** A template's text as the library shows it in the preview: its own words, without Markdown marks.
 * A table keeps one line a row, its cells separated by a bar, and loses the line under its heading. */
export function templateText(body: string) {
  return body
    .split("\n")
    .flatMap((line) => {
      if (/^\s*\|[\s:|-]+\|\s*$/.test(line)) return [];
      if (/^\s*\|/.test(line))
        return [
          line
            .trim()
            .replace(/^\||\|$/g, "")
            .split("|")
            .map((cell) => cell.trim())
            .join(" | "),
        ];
      return [line.replace(/^#{1,6}\s+/, "").trimEnd()];
    })
    .join("\n")
    .replace(/\*\*/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** A premium template's public description, at most 600 characters: what it is and the parts it
 * covers, by its own headings. Only the buyer gets the file. */
export function premiumDescription(title: string, body: string) {
  const opening = `A blank ${title.toLowerCase()} template to complete with your own details, as a Word file.`;
  const headings = [
    ...new Set(
      [...body.matchAll(/^#{2,4}\s+(.+)$/gm)]
        .map((m) =>
          m[1]!
            .replace(/\*\*/g, "")
            .replace(/^(?:\d+|[A-Z])[.)]\s+/, "")
            .replace(/[:.]\s*$/, "")
            .trim(),
        )
        .filter(Boolean),
    ),
  ];
  const described = (parts: string[]) =>
    `${opening} It covers: ${parts.join("; ")}${parts.length < headings.length ? "; and more." : "."}`;
  const parts: string[] = [];
  for (const heading of headings) {
    if (described([...parts, heading]).length > 600) break;
    parts.push(heading);
  }
  return parts.length ? described(parts) : opening;
}

/** A practical guide's text, cut as the reviewed route cuts the four it prepares
 * (`readPracticalGuideIntake`): without its status line, and with a related-template or
 * related-document suggestion reduced to the next step it names, if any. */
export function practicalText(sourceText: string) {
  const [heading, ...lines] = sourceText.split("\n");
  if (!/^## GUIDE-C\d{2} — .+$/.test(heading ?? "")) throw Error("PRACTICAL_GUIDE_SECTION_MISSING");
  return lines
    .filter((line) => !line.startsWith("Status:"))
    .map((line) =>
      /^Suggested related (?:templates?|documents?)\b/.test(line)
        ? line.includes("Next step: ")
          ? line.slice(line.indexOf("Next step: "))
          : ""
        : line,
    )
    .join("\n")
    .trim();
}

/** A deeper pack's text as a customer reads it: a template it names by ID is named by its title. */
function withoutTemplateIds(text: string) {
  return baselineTemplates.reduce(
    (out, template) => out.replaceAll(`${template.id} ${template.title}`, `the ${template.title} template`),
    text,
  );
}

export async function retainedDrafts(): Promise<RetainedDraft[]> {
  const drafts: RetainedDraft[] = [];
  for (const template of baselineTemplates) {
    const { section } = await readTemplateIntake(template.id);
    const premium = template.access === "premium";
    drafts.push({
      retainedId: template.id,
      kind: premium ? "premium_template" : "template",
      title: template.title,
      industry: null,
      body: premium ? premiumDescription(template.title, section.body) : templateText(section.body),
      template: section,
    });
  }
  // The practical guides' file, its provenance note and the first guide's pinned section are checked
  // as the reviewed route checks them; a changed file stops here.
  await readPracticalGuideIntake("GUIDE-C01");
  const practical = await readFile(resolve(publicationWorkspaceRoot(), practicalDraftPath), "utf8");
  for (const { section, sourceText } of retainedContentSections(practicalDraftPath, practical)) {
    const [, id, title] = /^(GUIDE-C\d{2}) — (.+)$/.exec(section.heading) ?? [];
    if (!id || !title) throw Error("PRACTICAL_GUIDE_SECTION_MISSING");
    drafts.push({
      retainedId: id,
      kind: "practical_guide",
      title,
      industry: null,
      body: practicalText(sourceText),
    });
  }
  let introductions = 0,
    packs = 0;
  for (const { industry, draft } of await retainedIndustryDrafts()) {
    const name = capitalised(industry.title);
    if (draft.kind === "introduction")
      drafts.push({
        retainedId: `IND-C${String(++introductions).padStart(2, "0")}`,
        kind: "industry_introduction",
        title: `${name}: where to start`,
        industry: industry.slug,
        body: draft.paragraphs.join("\n\n"),
      });
    else
      drafts.push({
        retainedId: `PACK-C${String(++packs).padStart(2, "0")}`,
        kind: "industry_pack",
        title: `${name}: five practical steps`,
        industry: industry.slug,
        body: [
          withoutTemplateIds(draft.purpose),
          draft.steps
            .map((step, i) => `${i + 1}. ${step.heading} ${withoutTemplateIds(step.text)}`)
            .join("\n"),
        ].join("\n\n"),
      });
  }
  for (let i = 1; i <= 30; i++) {
    const id = `GUD-${String(i).padStart(2, "0")}`;
    const { section, provenance } = await readGuidanceIntake(id);
    drafts.push({
      retainedId: id,
      kind: "regulatory_article",
      title: section.title,
      industry: null,
      body: section.body,
      record: guidanceRecordFromSection(id, guideSection(provenance.sourceText, id, section.title)),
    });
  }
  return drafts;
}

/** A template's Word file: the reviewed route's blank master, made from the same section. */
export async function retainedTemplateFile(section: OriginalSection) {
  return renderDocument(operationalDocument(section), "docx", 1, "template_sample");
}
