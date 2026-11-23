import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { baselineTemplates, coveragePlan, digest, sha256 } from "@workspace/valo-core";
import {
  industryDraftPath,
  originalProvenanceNote,
  retainedContentSections,
} from "../../lib/retained-content-sections";
import { assertDevelopmentRuntime } from "../../platform/valo-development-runtime";
import { publicationWorkspaceRoot } from "./operational-policy";

const original = {
  path: industryDraftPath,
  sha256: "53614ecc84b755c403017c7e2fb68d07c558a7c3783206c203b050f6fbac9897",
};
type Industry = ReturnType<typeof coveragePlan>["industries"][number];
type RetainedSection = ReturnType<typeof retainedContentSections>[number];
const templates = new Map<string, string>(baselineTemplates.map(({ id, title }) => [id, title]));

function annotation(line: string | undefined, name: string) {
  const prefix = `**${name}:** `;
  if (!line?.startsWith(prefix) || !line.slice(prefix.length).trim())
    throw Error("INDUSTRY_DRAFT_STRUCTURE_CHANGED");
  return line.slice(prefix.length);
}

function readDraft({ section, sourceText }: RetainedSection) {
  const lines = sourceText
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .filter((line) => line.trim());
  const sourceLeads = annotation(lines.at(-1), "Candidate source leads");
  const proposedTemplates = [...new Set(sourceText.match(/\bTPL-\d+\b/g) ?? [])].map((id) => {
    const title = templates.get(id);
    if (!title) throw Error("INDUSTRY_TEMPLATE_UNKNOWN");
    return { id, title };
  });
  if (section.category === "industry-landing") {
    if (lines.length !== 4 || lines.slice(0, 2).some((line) => line.startsWith("**")))
      throw Error("INDUSTRY_DRAFT_STRUCTURE_CHANGED");
    return {
      draft: { kind: "introduction" as const, paragraphs: lines.slice(0, 2) },
      editorialNotes: {
        proposedTemplates,
        templateConnections: annotation(lines[2], "Template connections"),
        sourceLeads,
        questions: null,
      },
    };
  }
  if (section.category !== "industry-deeper-pack" || lines.length !== 8)
    throw Error("INDUSTRY_DRAFT_STRUCTURE_CHANGED");
  const steps = lines.slice(1, 6).map((line, index) => {
    const match = /^(\d+)\. \*\*(.+?)\*\* (.+)$/.exec(line);
    if (!match || Number(match[1]) !== index + 1) throw Error("INDUSTRY_DRAFT_STEP_CHANGED");
    return { heading: match[2]!, text: match[3]! };
  });
  return {
    draft: { kind: "deeper-pack" as const, purpose: annotation(lines[0], "Purpose"), steps },
    editorialNotes: {
      proposedTemplates,
      templateConnections: null,
      sourceLeads,
      questions: annotation(lines[6], "Questions to resolve"),
    },
  };
}

function prepareRecord(industry: Industry, retained: RetainedSection) {
  const { draft, editorialNotes } = readDraft(retained);
  const candidate = {
    source: retained.section,
    original,
    provenanceNote: originalProvenanceNote,
    industry: {
      id: industry.id,
      slug: industry.slug,
      title: industry.title,
      intendedPage: `/industries/${industry.slug}`,
    },
    draft,
    editorialNotes: { ...editorialNotes, enhancedEvidenceRequired: industry.enhancedEvidenceRequired },
  };
  const candidateSha256 = digest(candidate);
  const evidence = industry.enhancedEvidenceRequired
    ? "Identify sector-specific evidence needed for this activity and record unresolved licensing, safety, privacy or financial claims."
    : "Identify activity-specific evidence needed for any legal, tax, safety or licensing claim.";
  const response =
    "Return the candidate hash, your assessment, exact passages that need changes and the evidence or revision each needs.";
  return {
    candidate,
    candidateSha256,
    reviewBriefs: [
      {
        role: "factual" as const,
        candidateSha256,
        instructions: [
          "Check the operational steps and assumptions against the actual activity described. Verify each proposed template connection.",
          "Identify factual or regulatory assertions. For each regulatory assertion, locate the operative authority, jurisdiction and effective date. Treat the source leads as research questions.",
          evidence,
          response,
        ],
      },
      {
        role: "challenge" as const,
        candidateSha256,
        instructions: [
          "Assess the draft independently using this candidate. Test a small business or mixed activity for which its assumptions could fail.",
          "Flag implied approvals, exemptions, unsafe advice, privacy risks and claims of template availability. Identify any scope that should be narrowed.",
          evidence,
          response,
        ],
      },
    ],
  };
}

/** The 26 retained industry drafts, read from the pinned file: each industry's introduction, and the
 * deeper pack of the six industries that have one, each split into its customer text (`draft`) and
 * the editorial notes that stay internal. */
export async function retainedIndustryDrafts() {
  assertDevelopmentRuntime();
  const root = publicationWorkspaceRoot();
  const [text, provenance] = await Promise.all(
    [original, originalProvenanceNote].map((ref) => readFile(resolve(root, ref.path), "utf8")),
  );
  if (
    !text ||
    !provenance ||
    sha256(text) !== original.sha256 ||
    sha256(provenance) !== originalProvenanceNote.sha256
  )
    throw Error("INDUSTRY_ORIGINAL_CHANGED");
  const sections = retainedContentSections(original.path, text);
  const byHeading = new Map(sections.map((retained) => [retained.section.heading, retained]));
  const drafts = coveragePlan().industries.flatMap((industry) => {
    const headings = industry.deeperPackTarget
      ? [industry.title, `${industry.title} — deeper pack`]
      : [industry.title];
    return headings.map((heading) => {
      const retained = byHeading.get(heading);
      if (!retained) throw Error("INDUSTRY_DRAFT_ROSTER_CHANGED");
      byHeading.delete(heading);
      return { industry, retained, ...readDraft(retained) };
    });
  });
  if (byHeading.size || sections.length !== drafts.length) throw Error("INDUSTRY_DRAFT_ROSTER_CHANGED");
  return drafts;
}

export async function prepareIndustryReviewPacket() {
  const records = (await retainedIndustryDrafts()).map(({ industry, retained }) =>
    prepareRecord(industry, retained),
  );
  return {
    schemaVersion: 1,
    kind: "industry-editorial-review-intake" as const,
    status: "awaiting-independent-reviews" as const,
    researchIndex: { path: original.path, heading: "Source leads for subsequent review" },
    records,
  };
}
