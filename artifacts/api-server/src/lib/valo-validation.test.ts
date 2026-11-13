import assert from "node:assert/strict";
import { test } from "node:test";
import { documentInput, documentUpdate, nigerianStates, profileInput, ticketInput } from "./valo-validation";
import { syntheticDocument, syntheticProfile } from "./valo-test-fixtures";
test("all 36 states and FCT are allowed without inventing nationwide rules", () => {
  assert.equal(nigerianStates.length, 37);
  assert.equal(new Set(nigerianStates).size, 37);
  for (const state of nigerianStates) {
    assert.equal(profileInput.parse({ expectedRevision: 0, profile: { ...syntheticProfile, state } }).profile.state, state);
  }
});
test("profile unknown, unanswered and false remain distinct; marketing is optional", () => {
  const input = profileInput.parse({ expectedRevision: 0, profile: syntheticProfile });
  assert.equal(input.profile.employees, "unknown");
  assert.equal(input.profile.marketingConsent, false);
  for (const employees of ["unknown", "unanswered", "not_applicable", "0"]) {
    assert.equal(profileInput.parse({ expectedRevision: 0, profile: { ...syntheticProfile, employees } }).profile.employees, employees);
  }
});
test("profile rejects invented state, blank name and fractional revision", () => {
  assert.equal(profileInput.safeParse({ expectedRevision: 0, profile: { ...syntheticProfile, state: "Atlantis" } }).success, false);
  assert.equal(profileInput.safeParse({ expectedRevision: 0, profile: { ...syntheticProfile, businessName: "  " } }).success, false);
  assert.equal(profileInput.safeParse({ expectedRevision: 0.5, profile: syntheticProfile }).success, false);
});
test("incomplete manual drafts persist without invented names or dates", () => {
  assert.deepEqual(documentInput.parse(syntheticDocument), syntheticDocument);
});
test("impossible and reversed dates are rejected", () => {
  for (const [issueDate, dueDate] of [["2026-02-30", ""], ["2026-11-13", "2026-11-12"], ["2026-11-13", "yesterday"]]) {
    assert.equal(documentInput.safeParse({ ...syntheticDocument, content: {
      ...syntheticDocument.content, fields: { ...syntheticDocument.content.fields, issueDate, dueDate },
    } }).success, false);
  }
});
test("arbitrary clauses, HTML nodes, network embeds and duplicate IDs are not accepted", () => {
  const base = syntheticDocument.content;
  assert.equal(documentInput.safeParse({ ...syntheticDocument, content: { ...base, selectedClauses: ["imaginary legal clause"] } }).success, false);
  assert.equal(documentInput.safeParse({ ...syntheticDocument, content: { ...base, blocks: [{ id:"x", type:"html", text:"<script/>", rows:[] }] } }).success, false);
  assert.equal(documentInput.safeParse({ ...syntheticDocument, content: { ...base, blocks: [base.blocks[0], base.blocks[0]] } }).success, false);
  assert.equal(documentInput.safeParse({ ...syntheticDocument, workspaceId: "foreign-workspace" }).success, false);
});
test("updates require a positive integer expected revision", () => {
  for (const expectedRevision of [0, -1, 1.5, NaN]) {
    assert.equal(documentUpdate.safeParse({ ...syntheticDocument, expectedRevision }).success, false);
  }
});
test("service enquiry consent cannot be assumed; support does not require sharing", () => {
  const ticket = { category: "tax", scope: "Synthetic enquiry only", contactEmail: "synthetic@example.test", sharingConsent: false };
  assert.equal(ticketInput.safeParse(ticket).success, false);
  assert.equal(ticketInput.safeParse({ ...ticket, sharingConsent: true }).success, true);
  assert.equal(ticketInput.safeParse({ ...ticket, category: "support" }).success, true);
});
