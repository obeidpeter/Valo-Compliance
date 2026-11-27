import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { DocumentBlock } from "@workspace/api-client-react";
import { BlockEditor, withHeadingRow } from "./document-editor-blocks";

// EDT-006 (docs/architecture/editor.md, slice 2): a customer's own table can print its first row as a
// heading row, which the files repeat at the top of each page.
const table: DocumentBlock = {
  id: "section-3",
  type: "table",
  text: "",
  rows: [
    ["Item", "Amount"],
    ["Synthetic chairs", "₦6,000.00"],
  ],
};
const shown = (block: DocumentBlock) =>
  renderToStaticMarkup(
    <BlockEditor
      block={block}
      index={2}
      count={3}
      onChange={() => {}}
      onMove={() => {}}
      onDelete={() => {}}
    />,
  );

test("a table's first row is marked as its heading with the block editor's choice, and the mark comes off again", () => {
  const marked = withHeadingRow(table, true);
  assert.deepEqual(marked, { ...table, headerRows: 1 });
  assert.deepEqual(withHeadingRow(marked, false), table);
  assert.ok(!("headerRows" in withHeadingRow(marked, false)));
  // The choice reads as checked only while the table is marked, and the editor shows its first row
  // as the heading.
  const checkbox = (html: string) => html.match(/<input type="checkbox"[^>]*>/)?.[0] ?? "";
  assert.match(shown(table), /First row is a heading/);
  assert.doesNotMatch(checkbox(shown(table)), /checked/);
  assert.match(checkbox(shown(marked)), /checked/);
  assert.match(shown(marked), /<tr class="font-medium">/);
  assert.doesNotMatch(shown(table), /<tr class="font-medium">/);
  // A paragraph and a list have no such choice.
  assert.doesNotMatch(
    shown({ id: "section-1", type: "paragraph", text: "Synthetic words.", rows: [] }),
    /First row is a heading/,
  );
});
