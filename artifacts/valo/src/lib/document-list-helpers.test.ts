import assert from "node:assert/strict";
import { test } from "node:test";
import type { BusinessDocument, CanonicalDocument } from "@workspace/api-client-react";
import { compileGuidedContent, emptyGuidedData } from "@workspace/valo-core/guided-runtime";
import { blankContent } from "./api";
import { documentKindLabel, filterDocuments } from "./document-list-helpers";

function doc(id: string, title: string, content: CanonicalDocument): BusinessDocument {
  return {
    id,
    title,
    revision: 1,
    revisionId: "00000000-0000-4000-8000-000000000001",
    contentHash: "a".repeat(64),
    content,
    updatedAt: "2026-11-23T08:00:00.000Z",
    createdAt: "2026-11-23T08:00:00.000Z",
  };
}

test("documentKindLabel identifies guided templates and blank freeform documents", () => {
  const guided = compileGuidedContent(emptyGuidedData("TPL-01")) as CanonicalDocument;
  assert.equal(documentKindLabel({ content: guided }), "Invoice");
  assert.equal(documentKindLabel({ content: blankContent() }), "Freeform");
});

test("filterDocuments filters by title query and completeness status", () => {
  const completeContent = blankContent("Synthetic Trading");
  completeContent.fields = {
    issuerName: "Synthetic Trading",
    recipientName: "Synthetic Buyer",
    documentNumber: "INV-1",
    issueDate: "2026-11-20",
    dueDate: "2026-12-01",
    notes: "Thank you.",
  };
  completeContent.blocks = [{ id: "b1", type: "paragraph", text: "Completed body text.", rows: [] }];

  const completeDoc = doc("1", "November Invoice", completeContent);
  const incompleteDoc = doc("2", "Draft Quotation", blankContent("Synthetic Trading"));
  const all = [completeDoc, incompleteDoc];

  assert.deepEqual(
    filterDocuments(all, "", "all").map((d) => d.id),
    ["1", "2"],
  );
  assert.deepEqual(
    filterDocuments(all, "", "incomplete").map((d) => d.id),
    ["2"],
  );
  assert.deepEqual(
    filterDocuments(all, "", "complete").map((d) => d.id),
    ["1"],
  );
  assert.deepEqual(
    filterDocuments(all, "invoice", "complete").map((d) => d.id),
    ["1"],
  );
  assert.deepEqual(
    filterDocuments(all, "invoice", "incomplete").map((d) => d.id),
    [],
  );
});
