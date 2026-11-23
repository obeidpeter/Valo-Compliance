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
import { blankContent } from "./api";
import {
  applyCustomerDetailsToGuided,
  applyIssuerDetailsToGuided,
  extractReusableCustomerDetails,
  extractReusableIssuerDetails,
  formatDocumentPlainText,
  prefillGuidedData,
  savedBusinessName,
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

  const plain = formatDocumentPlainText("Invoice — Synthetic Customer Enterprises", compiled);
  assert.match(plain, /\(DRAFT\)/);
  assert.match(plain, /Synthetic Customer Enterprises/);
});
