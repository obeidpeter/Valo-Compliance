/**
 * Synthetic engineering input only: the documents the tests print through the editor's preview, the
 * Word file and the PDF to show that they say the same (docs/architecture/editor.md, EDT-002). Never
 * imported by product code.
 */
import { compileGuidedContent } from "./guided-runtime-v1";
import { completeGuidedTestData } from "./guided-test-data";
import { GUIDED_V2_PREFIX } from "./guided-v2";
import { synchronizeFinancialBlocks } from "./money";
import type { PrintedDocument } from "./printed-page";

/** A long business name, with hyphens, as EDT-006 asks a file to print correctly. */
export const LONG_NAME =
  "Adekunle-Okonkwo-Babatunde Synthetic Trading and General Merchandise Enterprises Limited";
const formatting = { font: "sans", accent: "forest" } as const;

/** A document typed by hand: every kind of block it can hold, a long name, amounts in naira, a field
 * left empty, a blank line in a list and an empty paragraph. */
export function typedSample(): PrintedDocument {
  return {
    title: `Delivery note for ${LONG_NAME}`,
    content: {
      fields: {
        issuerName: LONG_NAME,
        recipientName: "Synthetic Customer Enterprises",
        documentNumber: "DN-0042",
        issueDate: "2026-11-18",
        dueDate: "",
        notes: "Synthetic notes for the printed page.",
      },
      blocks: [
        {
          id: "section-1",
          type: "paragraph",
          text: "Delivered in full: ₦1,500.00 of synthetic goods.\nSigned on receipt.",
          rows: [],
        },
        { id: "section-2", type: "list", text: "First synthetic item\n\nSecond synthetic item", rows: [] },
        {
          id: "section-3",
          type: "table",
          text: "",
          rows: [
            ["Item", "Quantity", "Amount"],
            ["Synthetic chairs", "4", "₦6,000.00"],
            [LONG_NAME, "1", "₦1,500.00"],
          ],
        },
        { id: "section-4", type: "paragraph", text: "", rows: [] },
        { id: "section-5", type: "paragraph", text: "Thank you for your business.", rows: [] },
      ],
      selectedClauses: [],
      formatting,
    },
  };
}

/** An invoice made from its questions (v1), every answer given, with `items` line items: 40, the
 * most it takes, runs over several pages. */
export function questionsSample(items = 40): PrintedDocument {
  const data = completeGuidedTestData("TPL-01");
  data.tables.items = Array.from({ length: items }, (_, i) => ({
    ...data.tables.items![0]!,
    description: `Synthetic line item ${i + 1} for ${LONG_NAME}`,
  }));
  return { title: "Synthetic invoice", content: compileGuidedContent(data) };
}

/** A document shaped as a v2 form makes one: the template's wording in headings, paragraphs, a list
 * and a table whose first row is its heading, with only a note among its fields. */
export function formShapedSample(): PrintedDocument {
  const id = (n: number) => `${GUIDED_V2_PREFIX}TPL-01:${n}`;
  return {
    title: "Synthetic service invoice",
    content: {
      fields: {
        issuerName: LONG_NAME,
        recipientName: "Synthetic Customer Enterprises",
        documentNumber: "INV-0042",
        issueDate: "2026-11-18",
        dueDate: "2026-12-02",
        notes: "Draft made from the answers the business entered.",
      },
      blocks: [
        { id: id(0), type: "heading", level: 2, text: "Invoice INV-0042", rows: [] },
        {
          id: id(1),
          type: "paragraph",
          text: `From ${LONG_NAME} to Synthetic Customer Enterprises.`,
          rows: [],
        },
        { id: id(2), type: "heading", level: 3, text: "What is billed", rows: [] },
        {
          id: id(3),
          type: "table",
          text: "",
          headerRows: 1,
          rows: [
            ["Description", "Quantity", "Unit price", "Amount"],
            ["Synthetic service", "2", "₦5,000.00", "₦10,000.00"],
          ],
        },
        { id: id(4), type: "list", text: "Pay within 14 days\nQuote the invoice number", rows: [] },
      ],
      selectedClauses: [],
      formatting,
    },
  };
}

/** A copy of a staff-library template: plain paragraphs and a table, as "Make my own copy" makes. */
export function librarySample(): PrintedDocument {
  return {
    title: "Synthetic stock register",
    content: {
      fields: {
        issuerName: "",
        recipientName: "",
        documentNumber: "",
        issueDate: "",
        dueDate: "",
        notes: "",
      },
      blocks: [
        { id: "library-1", type: "paragraph", text: "Record each delivery the day it arrives.", rows: [] },
        {
          id: "library-2",
          type: "table",
          text: "",
          rows: [
            ["Date", "Item", "Quantity"],
            ["", "", ""],
          ],
        },
      ],
      selectedClauses: [],
      formatting: { font: "serif", accent: "charcoal" },
    },
  };
}

/** An invoice typed by hand with its financial details: `lines` line items make its totals tables. */
export function totalsSample(lines = 40): PrintedDocument {
  return {
    title: "Synthetic typed invoice",
    content: synchronizeFinancialBlocks({
      fields: {
        issuerName: LONG_NAME,
        recipientName: "Synthetic Customer Enterprises",
        documentNumber: "INV-0043",
        issueDate: "2026-11-18",
        dueDate: "2026-12-02",
        notes: "Synthetic notes for the printed page.",
      },
      blocks: [{ id: "section-1", type: "paragraph", text: "Synthetic goods, as agreed.", rows: [] }],
      selectedClauses: [],
      formatting,
      financialInput: {
        kind: "invoice",
        lines: Array.from({ length: lines }, (_, i) => ({
          description: `Synthetic line item ${i + 1} for ${LONG_NAME}`,
          quantity: "2",
          unitPriceKobo: "150000",
        })),
        taxAmountKobo: null,
        taxLabel: "",
        discountKobo: null,
        amountDueKobo: null,
      },
    }),
  };
}

/** A sample whose table has `rows` rows below its first, so that it runs over several pages. */
function withLongTable(sample: PrintedDocument, rows: number, marked?: boolean): PrintedDocument {
  const blocks = sample.content.blocks.map((block) => {
    if (block.type !== "table") return block;
    const [first = [], second = []] = block.rows;
    const long = {
      ...block,
      rows: [
        first,
        ...Array.from({ length: rows }, (_, i) => second.map((cell, j) => (j ? cell : `${cell} ${i + 1}`))),
      ],
    };
    if (marked === undefined) return long;
    const { headerRows: _headerRows, ...unmarked } = long;
    return marked ? { ...unmarked, headerRows: 1 as const } : unmarked;
  });
  return { ...sample, content: { ...sample.content, blocks } };
}
/** A delivery note made from its questions (v1), every answer given, with `items` items. */
export function deliveryNoteSample(items = 40): PrintedDocument {
  const data = completeGuidedTestData("TPL-05");
  data.tables.deliveryItems = Array.from({ length: items }, (_, i) => ({
    ...data.tables.deliveryItems![0]!,
    description: `Synthetic delivered item ${i + 1} for ${LONG_NAME}`,
  }));
  return { title: "Synthetic delivery note", content: compileGuidedContent(data) };
}
/**
 * A table of each kind that prints its first row as a heading row, repeated at the top of each page,
 * with `rows` rows below it, and a customer's table that does not (docs/architecture/editor.md, slice
 * 2). Each has its name, the table's id and whether it prints a heading row.
 */
export const headingRowSamples = (rows = 40) =>
  [
    ["made from questions", deliveryNoteSample(rows), "valo-guided-v1:TPL-05:table:deliveryItems", true],
    [
      "the totals of an invoice made from questions",
      questionsSample(rows),
      "valo-guided-v1:TPL-01:calc:financial-items-v1",
      true,
    ],
    ["the totals of an invoice typed by hand", totalsSample(rows), "financial-items-v1", true],
    ["a form's table", withLongTable(formShapedSample(), rows), `${GUIDED_V2_PREFIX}TPL-01:3`, true],
    ["a customer's table marked", withLongTable(typedSample(), rows, true), "section-3", true],
    ["a customer's table not marked", withLongTable(typedSample(), rows, false), "section-3", false],
  ] as const;

/** The samples, each with its name. */
export const printedPageSamples = () =>
  [
    ["typed by hand", typedSample()],
    ["made from questions", questionsSample()],
    ["shaped as a v2 form", formShapedSample()],
    ["a library copy", librarySample()],
  ] as const;
