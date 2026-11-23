import assert from "node:assert/strict";
import { test } from "node:test";
import type { BusinessDocument, CanonicalDocument } from "@workspace/api-client-react";
import { compileGuidedContent, emptyGuidedData } from "@workspace/valo-core/guided-runtime";
import { blankContent } from "./api";
import {
  documentContextSubtitle,
  documentKindLabel,
  filterDocuments,
  readHiddenDocumentIds,
  suggestedDocumentTitle,
  writeHiddenDocumentIds,
} from "./document-list-helpers";

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

test("documentContextSubtitle and suggestedDocumentTitle distinguish generic drafts cleanly", () => {
  const guided = emptyGuidedData("TPL-01");
  guided.values.recipientName = "Synthetic Buyer Ltd";
  guided.values.documentNumber = "INV-007";
  const compiled = compileGuidedContent(guided) as CanonicalDocument;

  assert.equal(documentContextSubtitle({ content: compiled }), "Synthetic Buyer Ltd · INV-007");
  assert.equal(suggestedDocumentTitle("Invoice", compiled), "Invoice — Synthetic Buyer Ltd (INV-007)");
  // Customized titles are never overwritten with a suggestion.
  assert.equal(suggestedDocumentTitle("Q4 Retainer for Synthetic Buyer", compiled), null);
});

test("filterDocuments matches title or context subtitle, completeness status, and hidden set", () => {
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

  const completeDoc = doc("1", "Invoice", completeContent);
  const incompleteDoc = doc("2", "Draft Quotation", blankContent("Synthetic Trading"));
  const all = [completeDoc, incompleteDoc];

  assert.deepEqual(
    filterDocuments(all, "", "all").map((d) => d.id),
    ["1", "2"],
  );
  assert.deepEqual(
    filterDocuments(all, "INV-1", "all").map((d) => d.id),
    ["1"],
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
    filterDocuments(all, "", "all", new Set(["2"])).map((d) => d.id),
    ["1"],
  );
  assert.deepEqual(
    filterDocuments(all, "", "hidden", new Set(["2"])).map((d) => d.id),
    ["2"],
  );
});

test("hidden document IDs persist cleanly and tolerate corrupt storage", () => {
  const map = new Map<string, string>();
  const storage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  };
  writeHiddenDocumentIds(new Set(["doc-a", "doc-b"]), storage);
  assert.deepEqual([...readHiddenDocumentIds(storage)].sort(), ["doc-a", "doc-b"]);

  map.set("valo-hidden-docs-v1", "{bad json");
  assert.equal(readHiddenDocumentIds(storage).size, 0);
});
