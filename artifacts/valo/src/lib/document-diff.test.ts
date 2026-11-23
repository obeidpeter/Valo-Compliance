import assert from "node:assert/strict";
import { test } from "node:test";
import type { CanonicalDocument } from "@workspace/api-client-react";
import { compileGuidedContent, emptyGuidedData } from "@workspace/valo-core/guided-runtime";
import { blankContent } from "./api";
import { summarizeDocumentDiff } from "./document-diff";

test("summarizeDocumentDiff reports guided field and line-item differences clearly", () => {
  const older = emptyGuidedData("TPL-01");
  older.values.issuerName = "Synthetic Trading Ltd";
  older.values.recipientName = "Old Customer Ltd";
  older.values.dueDate = "2026-12-01";
  older.tables.items = [
    { description: "Item A", quantity: "1", unit: "each", otherUnit: "", unitPriceKobo: "10000" },
  ];

  const current = emptyGuidedData("TPL-01");
  current.values.issuerName = "Synthetic Trading Ltd";
  current.values.recipientName = "New Customer Ltd";
  current.values.dueDate = "2026-12-10";
  current.tables.items = [
    { description: "Item A", quantity: "1", unit: "each", otherUnit: "", unitPriceKobo: "10000" },
    { description: "Item B", quantity: "2", unit: "each", otherUnit: "", unitPriceKobo: "5000" },
  ];

  const diff = summarizeDocumentDiff(
    { title: "Invoice — New Customer Ltd", content: compileGuidedContent(current) as CanonicalDocument },
    { title: "Invoice", content: compileGuidedContent(older) as CanonicalDocument },
  );

  assert.ok(diff.some((entry) => entry.label === "Title" && entry.olderValue === "Invoice"));
  assert.ok(
    diff.some(
      (entry) =>
        entry.label === "Customer legal name" &&
        entry.olderValue === "Old Customer Ltd" &&
        entry.currentValue === "New Customer Ltd",
    ),
  );
  assert.ok(
    diff.some(
      (entry) =>
        entry.label.includes("Goods, work") &&
        entry.olderValue === "1 row" &&
        entry.currentValue === "2 rows",
    ),
  );
});

test("summarizeDocumentDiff compares freeform document fields and body blocks", () => {
  const older = blankContent("Synthetic Trading");
  const current = blankContent("Synthetic Trading");
  current.fields.recipientName = "Synthetic Partner";
  current.blocks = [{ id: "b1", type: "paragraph", text: "Updated paragraph.", rows: [] }];

  const diff = summarizeDocumentDiff({ title: "Memo", content: current }, { title: "Memo", content: older });
  assert.deepEqual(
    diff.map((d) => d.label),
    ["Addressed to", "Body sections"],
  );
});
