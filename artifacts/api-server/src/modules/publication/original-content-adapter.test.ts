import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { originalSections, operationalDocument, industrySections } from "./original-content-adapter";
import { publicationWorkspaceRoot } from "./operational-policy";
const source = (name: string) =>
  readFile(resolve(publicationWorkspaceRoot(), `docs/content-candidates/${name}-candidates.md`), "utf8");
test("seven exact baseline forms have editable bounded canonical layouts, not authoring metadata", async () => {
  const sections = originalSections(await source("operational-template"));
  assert.deepEqual(
    sections.map((x) => x.id),
    ["TPL-06", "TPL-07", "TPL-09", "TPL-24", "TPL-34", "TPL-35", "TPL-38"],
  );
  for (const section of sections) {
    const document = operationalDocument(section);
    assert.ok(document.content.blocks.length > 10);
    assert.equal(document.content.fields.issuerName, "");
    assert.ok(
      !JSON.stringify(document).match(/EDP|handoff checklist|Current status: DRAFT|R1 ·|candidate-1/),
    );
    assert.ok(document.content.blocks.every((b) => b.rows.every((row) => row.length <= 4)));
    assert.ok(JSON.stringify(document).includes("["));
  }
});
test("twelve guides retain original prose and remove draft status lines", async () => {
  const guides = originalSections(await source("practical-guide"));
  assert.equal(guides.length, 12);
  for (const guide of guides) {
    assert.ok(guide.body.length > 500);
    assert.ok(!guide.body.includes("Status: DRAFT"));
  }
});
test("twenty exact industry pages and six packs retain the independently supplied mappings", async () => {
  const entries = industrySections(await source("industry-content"));
  assert.equal(entries.length, 26);
  assert.equal(
    entries
      .filter((e) => e.id.startsWith("IND"))
      .reduce((total, e) => total + e.relatedTemplateIds.length, 0),
    139,
  );
  assert.equal(
    entries
      .filter((e) => e.id.startsWith("PACK"))
      .reduce((total, e) => total + e.relatedTemplateIds.length, 0),
    57,
  );
  assert.equal(entries[0]!.title, "retail/wholesale");
  assert.equal(entries[19]!.title, "other");
  for (const entry of entries) assert.ok(entry.body.length > 250);
});
test("handoff sections and embedded engineering metadata cannot enter a document", () => {
  const sections = originalSections(
    "header\n## TPL-07 — Inventory register\nR1 · Free\n\nBusiness: [ ]\n## Editorial and export handoff checklist\nNever publish this engineering note",
  );
  assert.equal(sections.length, 1);
  assert.ok(!sections[0]!.body.includes("engineering"));
  assert.throws(
    () => originalSections("## TPL-07 — Inventory register\nrelease manifest pending"),
    /AUTHORING_METADATA/,
  );
});
test("wide tables preserve each original field and blank without inventing records", () => {
  const section = {
    id: "TPL-07",
    title: "Inventory register",
    sourceHash: "test",
    relatedTemplateIds: [],
    body: "| One | Two | Three | Four | Five |\n|---|---|---|---|---|\n| [ ] | [ ] | [ ] | [ ] | [ ] |",
  };
  const document = operationalDocument(section);
  const table = document.content.blocks.find((b) => b.type === "table")!;
  assert.deepEqual(
    table.rows.slice(1),
    ["One", "Two", "Three", "Four", "Five"].map((h) => [h, "[ ]"]),
  );
  assert.throws(
    () => operationalDocument({ ...section, body: "| A | B |\n|---|---|\n| one |" }),
    /COLUMNS_INCONSISTENT/,
  );
});
