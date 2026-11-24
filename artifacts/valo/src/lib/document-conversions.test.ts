import assert from "node:assert/strict";
import { test } from "node:test";
import type { CanonicalDocument } from "@workspace/api-client-react";
import {
  compileGuidedContent,
  emptyGuidedData,
  guidedContentConsistent,
  guidedDataFromBlocks,
} from "@workspace/valo-core/guided-runtime";
import { emptyFormData } from "@workspace/valo-core/guided-runtime-v2";
import { GUIDED_SPECS_V2 } from "@workspace/valo-core/guided-specs-v2";
import { availableConversions, convertGuidedDocument } from "./document-conversions";

test("Quotation converts cleanly into an Invoice with items copied and dates/ref blank", () => {
  const quote = emptyGuidedData("TPL-02");
  quote.values.issuerName = "Synthetic Studio Ltd";
  quote.values.issuerAddress = "10 Synthetic Rd, Lagos";
  quote.values.recipientName = "Synthetic Buyer Ltd";
  quote.values.recipientAddress = "5 Sample Ave, Ikeja";
  quote.values.documentNumber = "QUO-01";
  quote.values.issueDate = "2026-11-18";
  quote.values.scope = "Brand design package";
  quote.values.taxMode = "none";
  quote.values.discountMode = "none";
  quote.tables.items = [
    { description: "Logo suite", quantity: "1", unit: "each", otherUnit: "", unitPriceKobo: "5000000" },
  ];
  const quoteDoc = compileGuidedContent(quote) as CanonicalDocument;

  const options = availableConversions(quoteDoc);
  assert.deepEqual(
    options.map((o) => o.targetId),
    ["TPL-01"],
  );

  const converted = convertGuidedDocument(quoteDoc, "TPL-01");
  assert.ok(converted);
  assert.equal(converted!.title, "Invoice — Synthetic Buyer Ltd");
  assert.equal(guidedContentConsistent(converted!.content), true);

  const invoice = guidedDataFromBlocks(converted!.content.blocks)!;
  assert.equal(invoice.templateId, "TPL-01");
  assert.equal(invoice.values.issuerName, "Synthetic Studio Ltd");
  assert.equal(invoice.values.recipientName, "Synthetic Buyer Ltd");
  assert.equal(invoice.values.billingBasis, "Brand design package");
  assert.equal(invoice.values.documentNumber, "");
  assert.equal(invoice.values.issueDate, "");
  assert.equal(invoice.values.dueDate, "");
  assert.equal(invoice.tables.items?.length, 1);
  assert.equal(invoice.tables.items?.[0]?.unitPriceKobo, "5000000");
});

test("Invoice converts cleanly into a Receipt while keeping payment confirmation and amount blank", () => {
  const invoice = emptyGuidedData("TPL-01");
  invoice.values.issuerName = "Synthetic Trading Ltd";
  invoice.values.issuerAddress = "14 Synthetic Way, Lagos";
  invoice.values.recipientName = "Synthetic Payer Ltd";
  invoice.values.documentNumber = "INV-2026-07";
  invoice.values.billingBasis = "Supply of cartons";
  const invoiceDoc = compileGuidedContent(invoice) as CanonicalDocument;

  const options = availableConversions(invoiceDoc);
  assert.deepEqual(
    options.map((o) => o.targetId),
    ["TPL-03"],
  );

  const converted = convertGuidedDocument(invoiceDoc, "TPL-03");
  assert.ok(converted);
  assert.equal(converted!.title, "Receipt — Synthetic Payer Ltd");
  assert.equal(guidedContentConsistent(converted!.content), true);

  const receipt = guidedDataFromBlocks(converted!.content.blocks)!;
  assert.equal(receipt.templateId, "TPL-03");
  assert.equal(receipt.values.issuerName, "Synthetic Trading Ltd");
  assert.equal(receipt.values.recipientName, "Synthetic Payer Ltd");
  assert.equal(receipt.values.purpose, "Payment for invoice INV-2026-07: Supply of cartons");
  assert.equal(receipt.values.paymentDate, "");
  assert.equal(receipt.values.receivedKobo, "");
  assert.equal(receipt.values.paymentMethod, "");
  assert.equal(receipt.values.acknowledgement, "");
});

test("an invoice started from its form converts into a Receipt exactly as one started from its questions", () => {
  const given = {
    issuerName: "Synthetic Trading Ltd",
    issuerAddress: "14 Synthetic Way, Lagos",
    recipientName: "Synthetic Payer Ltd",
    documentNumber: "INV-2026-07",
    billingBasis: "Supply of cartons",
  };
  const v1 = emptyGuidedData("TPL-01");
  v1.values = { ...v1.values, ...given };
  const questionsOnly = compileGuidedContent(v1) as CanonicalDocument;
  const answers = emptyFormData(GUIDED_SPECS_V2["TPL-01"]!);
  answers.values = { ...answers.values, ...given };
  // A form document's blocks are its template's wording as the answers fill it; its note and its
  // formatting are its own, here the same as the questions-only invoice's.
  const fromForm = {
    ...questionsOnly,
    blocks: [{ id: "valo-guided-v2:TPL-01:block:0", type: "paragraph", text: "Synthetic wording", rows: [] }],
    selectedClauses: ["taxMode=none"],
    formAnswers: answers,
  } as CanonicalDocument;
  assert.deepEqual(availableConversions(fromForm), availableConversions(questionsOnly));
  const converted = convertGuidedDocument(fromForm, "TPL-03")!;
  assert.deepEqual(converted, convertGuidedDocument(questionsOnly, "TPL-03"));
  // None of the invoice's own parts is carried into the receipt.
  assert.ok(!("formAnswers" in converted.content));
  assert.deepEqual(converted.content.selectedClauses, []);
  assert.ok(converted.content.blocks.every((block) => !block.id.startsWith("valo-guided-v2:")));
  // Answers of a form this site does not have offer no conversion.
  assert.deepEqual(
    availableConversions({
      ...fromForm,
      formAnswers: { ...answers, templateId: "TPL-99" },
    } as CanonicalDocument),
    [],
  );
});
