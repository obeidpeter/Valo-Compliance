import assert from "node:assert/strict";
import { test } from "node:test";
import type { CanonicalDocument } from "@workspace/api-client-react";
import {
  compileGuidedContent,
  emptyGuidedData,
  guidedContentConsistent,
  guidedDataFromBlocks,
} from "@workspace/valo-core/guided-runtime";
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
