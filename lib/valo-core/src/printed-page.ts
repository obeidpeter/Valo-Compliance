/**
 * What a document's file prints around its blocks, and what it prints them as: the notice, the line
 * under the title, the fields with their names, and the blocks. The renderers in the API draw this
 * (docs/architecture/editor.md), and so can the web app's preview, without loading a renderer.
 */
import {
  DOCUMENT_FIELD_LABELS,
  GUIDED_PREFIX,
  guidedRenderableBlocks,
  printedCalendarDate,
} from "./guided-runtime-v1";
import { GUIDED_V2_PREFIX } from "./guided-v2";

/** Printed at the top of a released guide's file and on every page of it. A guide is released in
 * development only, so the notice says so, as the template notice does. */
export const GUIDANCE_NOTICE =
  "GENERAL GUIDANCE — DEVELOPMENT RELEASE. General information, not legal advice and not a decision about your business. Check the official sources before you act.";
export const PRACTICAL_GUIDE_NOTICE =
  "PRACTICAL BUSINESS GUIDE — DEVELOPMENT RELEASE. The worked example is fictional. Check the details of your own transaction.";
/** Notice for an unpublished layout sample. */
export const GUIDANCE_DRAFT_NOTICE =
  "UNPUBLISHED DRAFT GUIDE — LAYOUT SAMPLE. This draft has not been reviewed or released. Do not rely on it.";
/** A guide's document ends with named parts ("What it covers: …"). Their blocks' ids start with this,
 * and a guide's file prints each part's name in bold. */
export const GUIDE_PART_PREFIX = "guide-";

/** Printed at the top of a customer's own document and on every page of it. The file may be read by
 * someone the customer sends it to, so it speaks of "the business". It still says what the notice
 * before it said: an incomplete draft (EDT-005), details nobody verified, and not proof of payment
 * or a government tax invoice (PAY-009), an official approval or legal advice. */
export const DRAFT_NOTICE =
  "INCOMPLETE DRAFT — details as the business entered them. Not proof of payment, a government tax invoice, an official approval or legal advice.";
/** Printed where the draft notice is, on a finished file: one made only of a complete version
 * (docs/architecture/finished-file.md). It keeps what the draft notice says of the details and of what
 * the file is not (EDP-008), and drops only the claim that it is an incomplete draft. The words are a
 * proposal for the owner. */
export const FINISHED_NOTICE =
  "Prepared with Valo from the details the business entered. Not proof of payment, a government tax invoice, an official approval or legal advice.";
export const TEMPLATE_NOTICE =
  "BLANK DEVELOPMENT TEMPLATE — complete with your own business information. Not regulatory guidance or verified business facts.";
export const PURCHASE_NOTICE =
  "VALO DEVELOPMENT PURCHASE RECEIPT — server-verified test transaction record only. Not proof of delivery, bank outcome, a government tax invoice or official approval.";
export type RenderMode =
  | "business_draft"
  | "business_finished"
  | "template_sample"
  | "purchase_receipt"
  | "guidance"
  | "guidance_draft"
  | "practical_guide";
export const guide = (mode: RenderMode) =>
  mode === "guidance" || mode === "guidance_draft" || mode === "practical_guide";
/** A customer's own document, as a marked draft or as a finished file. */
export const customer = (mode: RenderMode) => mode === "business_draft" || mode === "business_finished";
/** A named part's name and the rest of its text, or nothing when the block is not one. */
export function guidePart(mode: RenderMode, block: { id: string; type: string; text: string }) {
  if (!guide(mode) || block.type !== "paragraph" || !block.id.startsWith(GUIDE_PART_PREFIX)) return null;
  const end = block.text.indexOf(":");
  return end > 0 && end <= 40
    ? { name: block.text.slice(0, end + 1), rest: block.text.slice(end + 1) }
    : null;
}
export const noticeFor = (mode: RenderMode) =>
  mode === "purchase_receipt"
    ? PURCHASE_NOTICE
    : mode === "template_sample"
      ? TEMPLATE_NOTICE
      : mode === "practical_guide"
        ? PRACTICAL_GUIDE_NOTICE
        : mode === "guidance"
          ? GUIDANCE_NOTICE
          : mode === "guidance_draft"
            ? GUIDANCE_DRAFT_NOTICE
            : mode === "business_finished"
              ? FINISHED_NOTICE
              : DRAFT_NOTICE;
type Fields = Record<keyof typeof DOCUMENT_FIELD_LABELS, string>;
/** The line under a document's title. A customer's own document says "version", as the site does. A
 * template sample and a purchase receipt are left as they were: their words belong with the
 * templates' own review and with the purchases screen's. A guide names its own version. */
export const savedLine = (mode: RenderMode, revision: number) =>
  guide(mode)
    ? `Valo · Guide version ${revision}`
    : customer(mode)
      ? `Valo · Saved version ${revision}`
      : `Valo · Saved revision ${revision}`;
/**
 * A document's own fields as its file prints them, each with its name. A document made from
 * questions prints its note alone: its other fields are answers, printed with their questions.
 *
 * A customer's own document names each field as the editor does and prints a date with the month
 * as a word. A template sample and a purchase receipt are left as they were. A guide is something
 * to read, with no business details to fill in, so it prints none of them.
 */
export function printedFields(
  fields: Fields,
  guided: boolean,
  mode: RenderMode,
): (readonly [string, string])[] {
  if (guide(mode)) return [];
  if (!customer(mode)) return guided ? [["Notes", fields.notes]] : Object.entries(fields);
  const names = guided
    ? (["notes"] as const)
    : (["issuerName", "recipientName", "documentNumber", "issueDate", "dueDate", "notes"] as const);
  return names.map((name) => [
    DOCUMENT_FIELD_LABELS[name],
    name === "issueDate" || name === "dueDate" ? printedCalendarDate(fields[name]) : fields[name],
  ]);
}
/**
 * A block as a file prints it: the contract's paragraph, list and table, and, for a form that fills a
 * template's own wording (forms v2), a heading of level 2 or 3 and a table whose first row is its
 * header, repeated on each page. A document without these prints exactly as before.
 */
export type PrintedBlock = {
  id: string;
  type: "paragraph" | "list" | "table" | "heading";
  text: string;
  rows: string[][];
  level?: 2 | 3 | undefined;
  headerRows?: 0 | 1 | undefined;
};
/** The tables a document's amounts make (money.ts), on a typed document with its financial details:
 * the items with their totals, and the summary. Their first row names their columns. */
const TOTALS_TABLES = new Set(["financial-items-v1", "financial-summary-v1"]);
/** The tables made from a form's questions (v1): its own tables, and the totals its answers make. */
const QUESTION_TABLE = new RegExp(`^${GUIDED_PREFIX}[^:]+:(table|calc):`);
/**
 * Whether a table prints its first row as a heading row, repeated at the top of each page (EDT-006).
 * A form's table (v2) and a customer's own table say so (`headerRows: 1`). A table made from questions
 * and the totals tables say nothing, but their first row is always their column names, so the page
 * reads the heading from the table's kind: no saved document changes.
 */
export function printsHeadingRow(
  block: { id: string; type: string; headerRows?: 0 | 1 | undefined },
  content: { financialInput?: unknown },
) {
  if (block.type !== "table") return false;
  if (block.headerRows === 1) return true;
  if (block.id.startsWith(GUIDED_PREFIX)) return QUESTION_TABLE.test(block.id);
  return content.financialInput !== undefined && TOTALS_TABLES.has(block.id);
}
/** A document made from a form, v1's questions or v2's filled wording, prints only its note among its
 * fields: the names and dates are in its own text. */
export const madeFromForm = (blocks: readonly { id: string }[]) =>
  blocks.some((b) => b.id.startsWith(GUIDED_PREFIX) || b.id.startsWith(GUIDED_V2_PREFIX));
export const usesFormLayout = (blocks: readonly PrintedBlock[]) =>
  blocks.some((b) => b.type === "heading" || Boolean(b.headerRows));

/** The document a page is printed from, as the renderers parse it. */
export type PrintedDocument = { title: string; content: Parameters<typeof guidedRenderableBlocks>[0] };
/** What a field left empty prints: in the files, in the preview and in "Copy text". */
export const NOT_SUPPLIED = "[Not supplied]";
/** One of a document's fields as its page prints it, with whether the business supplied it. */
export type PrintedField = { name: string; value: string; supplied: boolean };
/**
 * A document's printed page: the notice, the title, the line under it, the fields with their names
 * and the blocks. The Word file, the PDF, the editor's preview and "Copy text" each draw this, and
 * add no text of their own (docs/architecture/editor.md, EDT-002). A list prints no blank line, and a
 * list with no line left prints nothing. A table that prints its first row as a heading row says so.
 */
export function printedPage(
  document: PrintedDocument,
  revision: number,
  mode: RenderMode = "business_draft",
) {
  const { title, content } = document;
  const blocks = guidedRenderableBlocks(content).flatMap((block): PrintedBlock[] => {
    if (block.type === "table")
      return [printsHeadingRow(block, content) ? { ...block, headerRows: 1 } : block];
    if (block.type !== "list") return [block];
    const lines = block.text.split("\n").filter((line) => line.trim());
    return lines.length ? [{ ...block, text: lines.join("\n") }] : [];
  });
  return {
    notice: noticeFor(mode),
    title,
    savedLine: savedLine(mode, revision),
    fields: printedFields(content.fields, madeFromForm(content.blocks), mode).map(
      ([name, value]): PrintedField => ({
        name,
        value: value || NOT_SUPPLIED,
        supplied: Boolean(value),
      }),
    ),
    blocks,
  };
}
export type PrintedPage = ReturnType<typeof printedPage>;

/**
 * A page's text in reading order, as plain text: the notice, the title and the line under it, each
 * field as "Name: value", then the blocks, a list's items each after "- " and a table's cells joined
 * by " | ". "Copy text" copies this, and the tests compare the preview's and the files' words with it.
 */
export function printedPageText(page: PrintedPage) {
  const lines = [page.notice, "", page.title, page.savedLine, ""];
  for (const field of page.fields) lines.push(`${field.name}: ${field.value}`);
  lines.push("");
  for (const block of page.blocks) {
    if (block.type === "table") for (const row of block.rows) lines.push(row.join(" | "));
    else if (block.type === "list") for (const item of block.text.split("\n")) lines.push(`- ${item}`);
    else lines.push(block.text);
    lines.push("");
  }
  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
/** Every word a page prints, in reading order, with nothing added: what the preview, the Word file
 * and the PDF must each say (the tests compare them with this). */
export function printedPageWords(page: PrintedPage) {
  return [
    page.notice,
    page.title,
    page.savedLine,
    ...page.fields.flatMap((field) => [field.name, field.value]),
    ...page.blocks.flatMap((block) => (block.type === "table" ? block.rows.flat() : [block.text])),
  ]
    .flatMap((text) => text.split(/\s+/))
    .filter(Boolean);
}
