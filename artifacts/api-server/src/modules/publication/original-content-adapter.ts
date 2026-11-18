import { createHash } from "node:crypto";
import { documentInput } from "../../lib/valo-validation";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export type OriginalSection = {
  id: string;
  title: string;
  body: string;
  sourceHash: string;
  relatedTemplateIds: string[];
};
const industryNames = [
  "retail/wholesale",
  "packaged-food manufacturing",
  "restaurants/hospitality",
  "agriculture",
  "general manufacturing",
  "logistics/transport",
  "construction",
  "real estate",
  "technology/software",
  "e-commerce",
  "beauty/personal care",
  "fashion/textiles",
  "healthcare",
  "education",
  "professional services",
  "media/creative",
  "import/export",
  "energy",
  "financial services",
  "other",
];
const packNames = [
  "retail/wholesale",
  "packaged-food manufacturing",
  "restaurants/hospitality",
  "technology/software",
  "professional services",
  "beauty/personal care",
];
function cleanBody(raw: string, id: string) {
  const body = raw
    .split("\n")
    .filter(
      (line) =>
        !/^Status:|^R[123]\s*·|^(?:Prepared|Created|Draft version|Provenance):/i.test(line.trim()) &&
        !/^(?:\*\*)?(?:Related templates?|Template links|Recommended template IDs|Template IDs|Internal metadata)(?:\*\*)?:/i.test(
          line.trim(),
        ),
    )
    .join("\n")
    .replace(/^\s*---\s*|\s*---\s*$/g, "")
    .trim();
  if (
    /DRAFT —|pending EDP|EDP-\d|docs\/content-candidates|provider-backed editorial|release manifest/i.test(
      body,
    )
  )
    throw Error(`AUTHORING_METADATA_IN_BODY:${id}`);
  return body;
}

/** Only content sections; file headers and editorial/handoff sections stay internal. */
export function originalSections(source: string): OriginalSection[] {
  const headings = [...source.matchAll(/^## ([^\n]+)$/gm)];
  return headings.flatMap((heading, i) => {
    const match = heading[1]!.match(/^([A-Z][A-Z0-9-]*\d{2}) — (.+)$/);
    if (!match) return [];
    const raw = source.slice(heading.index! + heading[0].length, headings[i + 1]?.index ?? source.length);
    return [
      {
        id: match[1]!,
        title: match[2]!,
        body: cleanBody(raw, match[1]!),
        sourceHash: hash(source),
        relatedTemplateIds: [...new Set(raw.match(/TPL-\d{2}/g) ?? [])],
      },
    ];
  });
}
export function industrySections(source: string): OriginalSection[] {
  const headings = [...source.matchAll(/^(#{2,3}) ([^\n]+)$/gm)];
  const sections: OriginalSection[] = [];
  let group = "",
    industries = 0,
    packs = 0;
  headings.forEach((heading, i) => {
    if (heading[1] === "##") {
      group = heading[2]!;
      return;
    }
    const kind = /industry landing pages/i.test(group)
      ? "industry"
      : /deeper[\s-]*pack/i.test(group)
        ? "pack"
        : null;
    if (!kind) return;
    const name = heading[2]!.replace(/ — deeper pack$/, "");
    const index = (kind === "industry" ? industryNames : packNames).indexOf(name);
    if (index < 0) throw Error("INDUSTRY_TAXONOMY_CHANGED");
    if (kind === "industry") industries++;
    else packs++;
    const id = `${kind === "industry" ? "IND" : "PACK"}-C${String(index + 1).padStart(2, "0")}`;
    const raw = source.slice(heading.index! + heading[0].length, headings[i + 1]?.index ?? source.length);
    sections.push({
      id,
      title: heading[2]!,
      body: cleanBody(raw, id),
      sourceHash: hash(source),
      relatedTemplateIds: [...new Set(raw.match(/TPL-\d{2}/g) ?? [])],
    });
  });
  if (
    industries !== 20 ||
    packs !== 6 ||
    new Set(sections.map((x) => `${x.id.startsWith("IND") ? "industry" : "pack"}:${x.title}`)).size !== 26
  )
    throw Error(`INDUSTRY_SOURCE_STRUCTURE_CHANGED:${industries}:${packs}`);
  return sections;
}
/** A4 portrait: wide source tables become editable field/value records, not tiny print. */
export function operationalDocument(section: OriginalSection) {
  if (!/^(?:TPL-\d{2}|GUD-(?:0[1-9]|[12]\d|30))$/.test(section.id))
    throw Error("OPERATIONAL_TEMPLATE_ID_REQUIRED");
  const blocks: { id: string; type: "paragraph" | "table"; text: string; rows: string[][] }[] = [];
  const add = (type: "paragraph" | "table", text: string, rows: string[][] = []) =>
    blocks.push({
      id: `${section.id.toLowerCase()}-${blocks.length + 1}`,
      type,
      text,
      rows,
    });
  for (const part of section.body.split(/\n\s*\n/).filter(Boolean)) {
    if (part.trimStart().startsWith("|")) {
      const rows = part
        .split("\n")
        .filter((line) => line.trim().startsWith("|") && !/^\s*\|[\s:|-]+\|\s*$/.test(line))
        .map((line) =>
          line
            .split("|")
            .slice(1, -1)
            .map((cell) => cell.trim()),
        );
      const header = rows[0];
      if (!header?.length || rows.some((row) => row.length !== header.length))
        throw Error("TABLE_COLUMNS_INCONSISTENT");
      if (header.length <= 4) add("table", "", rows);
      else
        rows.slice(1).forEach((row, i) => {
          add("paragraph", `Record ${i + 1}`);
          add("table", "", [["Field", "Entry"], ...header.map((label, j) => [label, row[j] ?? ""])]);
        });
    } else add("paragraph", part.replace(/^#{1,6}\s*/gm, "").replace(/\*\*/g, ""));
  }
  return documentInput.parse({
    title: section.title,
    content: {
      fields: {
        issuerName: "",
        recipientName: "",
        documentNumber: "",
        issueDate: "",
        dueDate: "",
        notes: "",
      },
      blocks,
      selectedClauses: [],
      formatting: { font: "sans", accent: "forest" },
    },
  });
}
