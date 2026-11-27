import { disclosure, isPracticalGuideId, type PublicationBundle } from "@workspace/valo-core";
import { printedCalendarDate } from "@workspace/valo-core/guided-runtime";
import { GUIDE_PART_PREFIX } from "../../lib/valo-guide-notices";
import { documentInput } from "../../lib/valo-validation";
import type { OriginalSection } from "./original-content-adapter";

/**
 * A guide as a document: its own words as blocks, then what the guide page shows beside them (what it
 * covers, its limits, its sources, how it was written and checked, and when its sources were
 * checked). The page and both files are made from this one document, so they cannot disagree.
 *
 * Nothing here reads a file, reviews anything or decides that a guide may be published.
 */
export type GuideReference = { title: string; locator: string; url: string };
type Block = { id: string; type: "paragraph" | "list"; text: string; rows: string[][] };

/** The ids of the blocks added after a guide's own words. The page leaves them out of the body. */
export const GUIDE_PART = {
  covers: `${GUIDE_PART_PREFIX}covers`,
  limits: `${GUIDE_PART_PREFIX}limits`,
  sourcesTitle: `${GUIDE_PART_PREFIX}sources-title`,
  sources: `${GUIDE_PART_PREFIX}sources`,
  written: `${GUIDE_PART_PREFIX}written`,
  reviewMeaning: `${GUIDE_PART_PREFIX}review-meaning`,
  sourcesChecked: `${GUIDE_PART_PREFIX}sources-checked`,
} as const;
const GUIDE_PARTS: readonly string[] = Object.values(GUIDE_PART);

/** The names a guide's parts carry in a file, the same as on the guide page. */
export const GUIDE_LABEL = {
  covers: "What it covers",
  limits: "Limits you should know",
  sources: "Sources",
  written: "How it was written and checked",
  sourcesChecked: "Sources checked",
} as const;

/** What a released guide's two reviews are, and are not (EDP-008). */
export const GUIDE_REVIEW_MEANING =
  "A guide is released only after two separate automated AI checks and the source and file checks pass. That is not legal or regulatory verification, and it is not professional certification.";

const guideId = /^GUD-(0[1-9]|[12]\d|30)$/;
// A link as a draft writes it: [words](https://address). A file prints the words, then the address.
const link = /\[([^\]\n]+)\]\((https:\/\/[^\s)]+)\)/g;
const bullet = /^\s*-\s+/;

/** A guide's own words as blocks: a paragraph for each paragraph, a list for each run of bullets, and
 * every link written out as its words followed by its address. Anything else a draft might hold (a
 * heading, a table, emphasis marks, a link that is not https) is refused, not printed as marks. */
export function guideBodyBlocks(id: string, body: string): Block[] {
  if (!guideId.test(id) && !isPracticalGuideId(id)) throw Error("GUIDANCE_ID_REQUIRED");
  const blocks: Block[] = [];
  const blockPrefix = isPracticalGuideId(id) ? `article-${id.slice(-3).toLowerCase()}` : id.toLowerCase();
  const add = (type: Block["type"], text: string) =>
    blocks.push({ id: `${blockPrefix}-${blocks.length + 1}`, type, text, rows: [] });
  for (const part of body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)) {
    const text = part.replace(link, "$1 ($2)");
    if (/^#{1,6}\s|^\s*\||\*|`|\]\(|^\s*\d+\.\s/m.test(text)) throw Error(`GUIDANCE_BODY_MARKUP:${id}`);
    const lines = text.split("\n");
    if (lines.every((line) => bullet.test(line)))
      add("list", lines.map((line) => line.replace(bullet, "").trim()).join("\n"));
    else if (lines.some((line) => bullet.test(line))) throw Error(`GUIDANCE_BODY_MARKUP:${id}`);
    else add("paragraph", lines.map((line) => line.trim()).join(" "));
  }
  if (!blocks.length) throw Error(`GUIDANCE_BODY_EMPTY:${id}`);
  return blocks;
}

const emptyFields = {
  issuerName: "",
  recipientName: "",
  documentNumber: "",
  issueDate: "",
  dueDate: "",
  notes: "",
};

/** A guide's own words alone, as the intake reads them. */
export function guidanceDocument(section: OriginalSection) {
  return documentInput.parse({
    title: section.title,
    content: {
      fields: emptyFields,
      blocks: guideBodyBlocks(section.id, section.body),
      selectedClauses: [],
      formatting: { font: "sans", accent: "forest" },
    },
  });
}

/** The day an instant falls on in Lagos (UTC+01:00, no daylight saving), as a file prints a day. */
function lagosDay(instant: string) {
  const time = Date.parse(instant);
  if (!Number.isFinite(time)) throw Error("GUIDANCE_SOURCE_CHECK_DATE_INVALID");
  return printedCalendarDate(new Date(time + 3_600_000).toISOString().slice(0, 10));
}

/**
 * A guide's source list as a file prints it: one line for each official text, with every place in it
 * the guide points to, then its official address. The page lists each place as its own link; a file
 * that repeated the text's name and address for every place would be hard to read.
 */
export function guideSourceLines(references: readonly GuideReference[]) {
  const texts: { title: string; url: string; places: string[] }[] = [];
  for (const r of references) {
    const known = texts.find((t) => t.title === r.title && t.url === r.url);
    if (!known) texts.push({ title: r.title, url: r.url, places: [r.locator] });
    else if (!known.places.includes(r.locator)) known.places.push(r.locator);
  }
  return texts.map((t) => `${t.title}: ${t.places.join("; ")}. ${t.url}`);
}

/**
 * The whole guide a candidate carries. `sourcesCheckedAt` is the candidate's own source check date,
 * printed as a day in Lagos and as the exact instant the gate compares.
 */
export function guidanceReleaseDocument(input: {
  section: OriginalSection;
  scope: string;
  limitations: string;
  sourcesCheckedAt: string;
  references: readonly GuideReference[];
}) {
  const { section, scope, limitations, sourcesCheckedAt, references } = input;
  if (references.some((r) => new URL(r.url).protocol !== "https:"))
    throw Error("GUIDANCE_REFERENCE_NOT_HTTPS");
  const paragraph = (id: string, text: string): Block => ({ id, type: "paragraph", text, rows: [] });
  return documentInput.parse({
    title: section.title,
    content: {
      fields: emptyFields,
      blocks: [
        ...guideBodyBlocks(section.id, section.body),
        paragraph(GUIDE_PART.covers, `${GUIDE_LABEL.covers}: ${scope}`),
        paragraph(GUIDE_PART.limits, `${GUIDE_LABEL.limits}: ${limitations}`),
        ...(references.length
          ? [
              paragraph(GUIDE_PART.sourcesTitle, `${GUIDE_LABEL.sources}:`),
              {
                id: GUIDE_PART.sources,
                type: "list" as const,
                text: guideSourceLines(references).join("\n"),
                rows: [],
              },
            ]
          : []),
        paragraph(GUIDE_PART.written, `${GUIDE_LABEL.written}: ${disclosure}`),
        paragraph(GUIDE_PART.reviewMeaning, GUIDE_REVIEW_MEANING),
        paragraph(
          GUIDE_PART.sourcesChecked,
          `${isPracticalGuideId(section.id) ? "Draft and evidence checked" : GUIDE_LABEL.sourcesChecked}: ${lagosDay(sourcesCheckedAt)} (${sourcesCheckedAt}).`,
        ),
      ],
      selectedClauses: [],
      formatting: { font: "sans", accent: "forest" },
    },
  });
}

/** A guide's own words out of its whole document: every block that is not one of the added parts. */
export function guideOwnBlocks<T extends { id: string }>(blocks: readonly T[]) {
  return blocks.filter((b) => !GUIDE_PARTS.includes(b.id));
}

/**
 * A claim's locator as a reader sees it. A locator that names words of the text, the only kind the
 * locator check accepts for a passage with no section number in it, is shown as those words.
 */
export const displayLocator = (locator: string) =>
  locator.replace(/^(?:heading|passage|paragraph)\s*:\s*/i, "the words: ");

/**
 * The sources a guide lists: one entry for each place a claim points to, as the guide page lists
 * them. A claim whose source is missing, or is not an https address, is left out here; the gate holds
 * such a candidate on its own.
 */
export function guideReferences(
  bundle: Pick<PublicationBundle, "sources"> & { candidate: Pick<PublicationBundle["candidate"], "claims"> },
): GuideReference[] {
  return bundle.candidate.claims
    .flatMap((claim) => {
      const source = bundle.sources.find((s) => s.id === claim.sourceId);
      if (!source || new URL(source.url).protocol !== "https:") return [];
      return [{ url: source.url, title: source.title, locator: displayLocator(claim.locator) }];
    })
    .filter((s, i, all) => all.findIndex((x) => x.url === s.url && x.locator === s.locator) === i);
}

/**
 * A guide's title and own words as the guide page shows them, read from the document its candidate
 * carries: a paragraph for each block and a bulleted line for each item of a list. Null for a body
 * that is not a guide's document, such as the plain text an older fixture carries.
 */
export function guidePageText(body: string): { title: string; body: string } | null {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return null;
  }
  const parsed = documentInput.safeParse(raw);
  if (!parsed.success || !parsed.data.content.blocks.some((b) => b.id === GUIDE_PART.covers)) return null;
  const own = guideOwnBlocks(parsed.data.content.blocks);
  return {
    title: parsed.data.title,
    body: own
      .map((b) =>
        b.type === "list"
          ? b.text
              .split("\n")
              .map((item) => `• ${item}`)
              .join("\n")
          : b.text,
      )
      .join("\n\n"),
  };
}
