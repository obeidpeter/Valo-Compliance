import test from "node:test";
import assert from "node:assert/strict";
import { libraryCopy } from "./library-copy";

// docs/architecture/library-entries.md, slice 3: a free staff-library template is copied into a
// document from its released text, and a text that does not fit a document is not copied at all.
test("a library template's text is copied as paragraphs and tables, and a text too long for a document is not copied", () => {
  const copy = libraryCopy(
    "Synthetic library copy",
    "Synthetic opening paragraph,\nwith a second line.\n\n  Item | Quantity\n Synthetic item | 2  \n\nA line | with a bar\nand a line without one",
  );
  assert.ok(copy);
  assert.equal(copy.title, "Synthetic library copy");
  assert.deepEqual(
    copy.content.blocks.map(({ id, type, text, rows }) => ({ id, type, text, rows })),
    [
      {
        id: "library-1",
        type: "paragraph",
        text: "Synthetic opening paragraph,\nwith a second line.",
        rows: [],
      },
      {
        id: "library-2",
        type: "table",
        text: "",
        rows: [
          ["Item", "Quantity"],
          ["Synthetic item", "2"],
        ],
      },
      // Only a run of lines that all have cells is a table.
      { id: "library-3", type: "paragraph", text: "A line | with a bar\nand a line without one", rows: [] },
    ],
  );
  // A copy is the customer's own document: no form, no clauses, no fields filled in.
  assert.deepEqual(copy.content.selectedClauses, []);
  assert.deepEqual(Object.values(copy.content.fields), ["", "", "", "", "", ""]);

  const paragraphs = (count: number) =>
    Array.from({ length: count }, (_, i) => "Paragraph " + i).join("\n\n");
  assert.equal(libraryCopy("Synthetic", paragraphs(100))?.content.blocks.length, 100);
  for (const [why, body] of <[string, string][]>[
    ["more than 100 blocks", paragraphs(101)],
    ["a paragraph over 8,000 characters", "x".repeat(8001)],
    ["a table over 100 rows", Array.from({ length: 101 }, (_, i) => `Row ${i} | value`).join("\n")],
    ["a row over 10 cells", Array.from({ length: 11 }, (_, i) => "cell " + i).join(" | ")],
    ["no text", " \n\n \n"],
  ])
    assert.equal(libraryCopy("Synthetic", body), null, why);
  assert.equal(libraryCopy("Synthetic", "x".repeat(8000))?.content.blocks[0]?.text.length, 8000);
});
