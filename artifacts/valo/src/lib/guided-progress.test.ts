import assert from "node:assert/strict";
import { test } from "node:test";
import { GUIDED_SPECS_V1 } from "@workspace/valo-core/guided-specs";
import { emptyGuidedData, guidedDataIssues } from "@workspace/valo-core/guided-runtime";
import { computeGuidedProgress } from "./guided-progress";

test("computeGuidedProgress tracks completion percent, nav items, and first missing field selector", () => {
  const spec = GUIDED_SPECS_V1["TPL-01"];
  const data = emptyGuidedData("TPL-01");
  const initialIssues = guidedDataIssues(spec, data);
  const initial = computeGuidedProgress(spec, data, initialIssues);

  assert.ok(initial.requiredTotal > 0);
  assert.equal(initial.requiredDone, 0);
  assert.equal(initial.percent, 0);
  assert.equal(initial.firstIssueTarget?.selector, "#g-issuerName");
  assert.equal(initial.navItems.length, 2); // Document questions + Goods, work and agreed charges table
  assert.equal(initial.navItems[0]?.domId, "guided-sec-answers");
  assert.equal(initial.navItems[1]?.domId, "guided-tbl-items");

  data.values.issuerName = "Synthetic Trading Ltd";
  const nextIssues = guidedDataIssues(spec, data);
  const next = computeGuidedProgress(spec, data, nextIssues);
  assert.equal(next.requiredDone, 1);
  assert.equal(next.firstIssueTarget?.selector, "#g-issuerAddress");
  assert.ok(next.percent > 0 && next.percent < 100);
});

test("computeGuidedProgress jumps to table cells once top-level fields are valid", () => {
  const spec = GUIDED_SPECS_V1["TPL-01"];
  const data = emptyGuidedData("TPL-01");
  data.values.issuerName = "Synthetic Trading Ltd";
  data.values.issuerAddress = "10 Synthetic Rd, Lagos";
  data.values.recipientName = "Synthetic Buyer Ltd";
  data.values.documentNumber = "INV-1";
  data.values.issueDate = "2026-11-18";
  data.values.dueDate = "2026-12-01";
  data.values.billingBasis = "Supply of goods";
  data.values.taxMode = "none";
  data.values.discountMode = "none";
  data.tables.items = [
    { description: "", quantity: "1", unit: "each", otherUnit: "", unitPriceKobo: "5000" },
  ];

  const issues = guidedDataIssues(spec, data);
  const progress = computeGuidedProgress(spec, data, issues);
  assert.equal(progress.firstIssueTarget?.selector, "#gt-items-0-description");
  assert.equal(progress.navItems[0]?.done, true);
  assert.equal(progress.navItems[1]?.done, false);
});
