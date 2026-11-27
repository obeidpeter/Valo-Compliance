import assert from "node:assert/strict";
import { test } from "node:test";
import type { AssessmentItem, PublicItem } from "@workspace/api-client-react";
import { documentsFor, numberGroups, NUMBERS_PER_REQUEST, resultTemplateNumbers } from "./result-documents";

const related = (relatedTemplateIds: string[]) => ({ relatedTemplateIds }) as AssessmentItem;
const released = (id: string, templateNumber?: string): PublicItem => ({
  id,
  slug: id,
  title: `Synthetic ${id}`,
  type: "template",
  summary: "Synthetic test fixture.",
  industry: "All industries",
  ...(templateNumber ? { templateNumber } : {}),
});

// docs/architecture/results.md, slice 1: the page asks the released list for a result's documents by
// their numbers, and lists only those it is given.
test("a result's documents are asked for once each, by template number only, twenty to a request", () => {
  assert.deepEqual(
    resultTemplateNumbers({
      items: [related(["TPL-29", "TPL-01"]), related(["TPL-29", "not-a-number", "TPL-1"]), related([])],
      recommendedTemplateIds: ["TPL-29", "TPL-40"],
    }),
    ["TPL-01", "TPL-29", "TPL-40"],
  );
  assert.deepEqual(resultTemplateNumbers({ items: [], recommendedTemplateIds: [] }), []);
  assert.deepEqual(numberGroups([]), []);
  assert.deepEqual(numberGroups(["TPL-01", "TPL-29"]), ["TPL-01,TPL-29"]);
  const many = Array.from({ length: 41 }, (_, i) => `TPL-${String(i + 1).padStart(2, "0")}`);
  const groups = numberGroups(many);
  assert.equal(NUMBERS_PER_REQUEST, 20);
  assert.deepEqual(
    groups.map((group) => group.split(",").length),
    [20, 20, 1],
  );
  assert.deepEqual(groups.join(",").split(","), many);
});

test("a requirement lists the released documents with its numbers, in their order and each once, and nothing for a number with none released", () => {
  const list = [
    released("invoice", "TPL-01"),
    released("notice", "TPL-29"),
    released("notice-again", "TPL-29"),
    released("unnumbered"),
  ];
  assert.deepEqual(
    documentsFor(["TPL-29", "TPL-30", "TPL-01", "TPL-29"], list).map((document) => document.id),
    ["notice", "notice-again", "invoice"],
  );
  assert.deepEqual(documentsFor(["TPL-30"], list), []);
  assert.deepEqual(documentsFor([], list), []);
});
