import assert from "node:assert/strict";
import { test } from "node:test";
import { GUIDED_TEMPLATE_IDS } from "@workspace/valo-core/guided";
import { GUIDED_SPECS_V1 } from "@workspace/valo-core/guided-specs";
import {
  compileGuidedContent,
  emptyGuidedData,
  guidedContentConsistent,
  guidedDataFromBlocks,
  guidedDataIssues,
} from "@workspace/valo-core/guided-runtime";
import { emptyFormData } from "@workspace/valo-core/guided-runtime-v2";
import { GUIDED_SPECS_V2 } from "@workspace/valo-core/guided-specs-v2";
import type { CanonicalDocument } from "@workspace/api-client-react";
import { blankContent } from "./api";
import {
  applyCustomerDetailsToGuided,
  applyIssuerDetailsToGuided,
  extractReusableCustomerDetails,
  extractReusableIssuerDetails,
  formatDocumentPlainText,
  prefillGuidedData,
  savedBusinessName,
  uniqueSavedCustomerNames,
} from "./guided-prefill";

test("prefillGuidedData carries forward only the saved business name across all 12 guided templates", () => {
  const profile = { businessName: "  Synthetic Trading Ltd  " };
  for (const id of GUIDED_TEMPLATE_IDS) {
    const data = prefillGuidedData(id, profile);
    const spec = GUIDED_SPECS_V1[id];
    assert.equal(data.values.issuerName, "Synthetic Trading Ltd", `${id}: issuerName prefilled`);

    // Every other field must remain empty so Valo never assumes addresses, authority, or jurisdiction.
    for (const [fieldId, value] of Object.entries(data.values)) {
      if (fieldId !== "issuerName") {
        assert.equal(value, "", `${id}: ${fieldId} stays empty`);
      }
    }

    // Compiled content stays valid, round-trips cleanly, and still requires the remaining facts.
    const compiled = compileGuidedContent(data);
    assert.equal(compiled.fields.issuerName, "Synthetic Trading Ltd", `${id}: header issuerName synced`);
    assert.equal(guidedContentConsistent(compiled), true, `${id}: compiled content consistent`);
    assert.deepEqual(guidedDataFromBlocks(compiled.blocks), data, `${id}: blocks round-trip`);

    const issues = guidedDataIssues(spec, data);
    assert.equal(issues.issuerName, undefined, `${id}: prefilled issuerName satisfies validation`);
    assert.ok(Object.keys(issues).length > 0, `${id}: other required fields still stay incomplete`);
  }
});

test("prefillGuidedData and savedBusinessName ignore missing, blank, marker, or oversized profile names", () => {
  for (const profile of [
    null,
    undefined,
    { businessName: "" },
    { businessName: "   " },
    { businessName: "unknown" },
    { businessName: "UNANSWERED" },
    { businessName: "not_applicable" },
    { businessName: "not supplied" },
    { businessName: "[Business Name]" },
    { businessName: "A".repeat(161) },
  ]) {
    assert.equal(savedBusinessName(profile), "");
    assert.deepEqual(prefillGuidedData("TPL-01", profile), emptyGuidedData("TPL-01"));
    assert.deepEqual(prefillGuidedData("TPL-13", profile), emptyGuidedData("TPL-13"));
  }
});

test("blankContent optionally carries forward the saved business name without changing the empty default", () => {
  assert.equal(blankContent().fields.issuerName, "");
  assert.equal(
    blankContent(savedBusinessName({ businessName: "Synthetic Studio" })).fields.issuerName,
    "Synthetic Studio",
  );
});

test("extractReusableIssuerDetails and applyIssuerDetailsToGuided copy only validated issuer fields", () => {
  const source = emptyGuidedData("TPL-01");
  source.values.issuerName = "Synthetic Trading Ltd";
  source.values.issuerAddress = "14 Synthetic Way, Ikeja, Lagos";
  source.values.paymentInstructions = "Bank transfer to Synthetic Bank, 0000000000";
  source.values.recipientName = "Should Not Be Copied Ltd";
  source.values.documentNumber = "INV-999";

  const details = extractReusableIssuerDetails({ content: compileGuidedContent(source) });
  assert.deepEqual(details, {
    issuerName: "Synthetic Trading Ltd",
    issuerAddress: "14 Synthetic Way, Ikeja, Lagos",
    paymentInstructions: "Bank transfer to Synthetic Bank, 0000000000",
  });

  // Applying invoice issuer details onto a receipt copies name & address, skips invoice-only paymentInstructions.
  const target = emptyGuidedData("TPL-03");
  const applied = applyIssuerDetailsToGuided(target, details);
  assert.equal(applied.data.values.issuerName, "Synthetic Trading Ltd");
  assert.equal(applied.data.values.issuerAddress, "14 Synthetic Way, Ikeja, Lagos");
  assert.equal(applied.data.values.recipientName, "");
  assert.equal(applied.data.values.documentNumber, "");
  assert.equal(applied.appliedLabels.length, 2);
});

test("extractReusableCustomerDetails, applyCustomerDetailsToGuided, and formatDocumentPlainText work cleanly", () => {
  const source = emptyGuidedData("TPL-01");
  source.values.issuerName = "Synthetic Trading Ltd";
  source.values.recipientName = "Synthetic Customer Enterprises";
  source.values.recipientAddress = "9 Sample Crescent, Yaba, Lagos";
  source.values.documentNumber = "INV-007";
  const compiled = compileGuidedContent(source);

  const customer = extractReusableCustomerDetails({ content: compiled });
  assert.deepEqual(customer, {
    recipientName: "Synthetic Customer Enterprises",
    recipientAddress: "9 Sample Crescent, Yaba, Lagos",
  });

  const target = emptyGuidedData("TPL-03");
  const applied = applyCustomerDetailsToGuided(target, customer);
  assert.equal(applied.data.values.recipientName, "Synthetic Customer Enterprises");
  assert.equal(applied.data.values.recipientAddress, "9 Sample Crescent, Yaba, Lagos");
  assert.equal(applied.data.values.issuerName, "");

  // "Copy text" is the page the files print (docs/architecture/editor.md): an invoice still missing
  // answers starts with the draft notice.
  const plain = formatDocumentPlainText("Invoice — Synthetic Customer Enterprises", compiled, 1);
  assert.match(plain, /^INCOMPLETE DRAFT/);
  assert.match(plain, /Synthetic Customer Enterprises/);

  const second = emptyGuidedData("TPL-02");
  second.values.recipientName = "synthetic customer enterprises";
  const third = emptyGuidedData("TPL-01");
  third.values.recipientName = "Beta Logistics Ltd";
  assert.deepEqual(
    uniqueSavedCustomerNames([
      { content: compiled },
      { content: compileGuidedContent(second) as CanonicalDocument },
      { content: compileGuidedContent(third) as CanonicalDocument },
    ]),
    ["Synthetic Customer Enterprises", "Beta Logistics Ltd"],
  );
});

test("an invoice started from its form gives its saved sender and customer details for reuse, and takes them as its own answers", () => {
  const answers = emptyFormData(GUIDED_SPECS_V2["TPL-01"]!);
  answers.values = {
    ...answers.values,
    issuerName: "Synthetic Trading Ltd",
    issuerAddress: "14 Synthetic Way, Ikeja, Lagos",
    paymentInstructions: "Bank transfer to Synthetic Bank, 0000000000",
    recipientName: "Synthetic Customer Enterprises",
    recipientAddress: "9 Sample Crescent, Yaba, Lagos",
    documentNumber: "INV-999",
  };
  const source = { content: { ...blankContent(), formAnswers: answers } as CanonicalDocument };
  const issuer = extractReusableIssuerDetails(source);
  assert.deepEqual(issuer, {
    issuerName: "Synthetic Trading Ltd",
    issuerAddress: "14 Synthetic Way, Ikeja, Lagos",
    paymentInstructions: "Bank transfer to Synthetic Bank, 0000000000",
  });
  const customer = extractReusableCustomerDetails(source);
  assert.deepEqual(customer, {
    recipientName: "Synthetic Customer Enterprises",
    recipientAddress: "9 Sample Crescent, Yaba, Lagos",
  });
  // Another form document takes them as answers to its own questions, and stays a v2 form.
  const target = emptyFormData(GUIDED_SPECS_V2["TPL-01"]!);
  const filled = applyCustomerDetailsToGuided(applyIssuerDetailsToGuided(target, issuer).data, customer);
  assert.equal(filled.data.schemaVersion, 2);
  assert.equal(filled.data.values.issuerAddress, "14 Synthetic Way, Ikeja, Lagos");
  assert.equal(filled.data.values.recipientName, "Synthetic Customer Enterprises");
  assert.equal(filled.data.values.documentNumber, "");
  assert.equal(filled.appliedLabels.length, 2);
  // A questions-only document takes a form document's details just the same.
  const v1 = applyIssuerDetailsToGuided(emptyGuidedData("TPL-01"), issuer);
  assert.equal(v1.data.schemaVersion, 1);
  assert.equal(v1.appliedLabels.length, 3);
});
