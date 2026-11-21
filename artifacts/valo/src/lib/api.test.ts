import { test } from "node:test";
import assert from "node:assert/strict";
import type { CanonicalDocument } from "@workspace/api-client-react";
import { GUIDED_TEMPLATE_IDS } from "@workspace/valo-core/guided";
import { compileGuidedContent, emptyGuidedData } from "@workspace/valo-core/guided-runtime";
import { GUIDED_SPECS_V1 } from "@workspace/valo-core/guided-specs";
import { blankContent, missingFields } from "./api";
import { askedAs } from "./guided-money";

/** A document of this kind as it is first saved, with these answers given. */
const started = (id: (typeof GUIDED_TEMPLATE_IDS)[number], answers: Record<string, string> = {}) => {
  const data = emptyGuidedData(id);
  return compileGuidedContent({ ...data, values: { ...data.values, ...answers } }) as CanonicalDocument;
};

// EDT-005: "Highlight unresolved fields, inconsistent dates and missing party details."
test("what a new document still needs is listed in the questions' own words, a table's row and column by name, and never by an internal key", () => {
  assert.deepEqual(missingFields(started("TPL-01")), [
    "Issuing business legal name",
    "Issuing business contact/address",
    "Customer legal name",
    "Document reference",
    "Issue date",
    "Confirmed invoice payment date",
    "Goods/work supplied and agreed billing basis",
    "Include a user-supplied tax amount?",
    "Include an agreed discount?",
    "Goods, work and agreed charges, row 1: Description",
    "Goods, work and agreed charges, row 1: Quantity",
    "Goods, work and agreed charges, row 1: Quantity unit",
    "Goods, work and agreed charges, row 1: Unit price in naira, for the chosen quantity unit",
  ]);
  for (const id of GUIDED_TEMPLATE_IDS) {
    const spec = GUIDED_SPECS_V1[id];
    const names = new Set(spec.fields.map(askedAs));
    const lines = missingFields(started(id));
    assert.ok(lines.length > 0, id);
    for (const line of lines) {
      // A table's cell reads "<table>, row <n>: <column>"; anything else is a question as it is asked.
      const cell = /^(.+), row (\d+): (.+)$/.exec(line);
      if (cell) {
        assert.ok(
          spec.tables.some((t) => t.label === cell[1] && t.columns.some((c) => askedAs(c) === cell[3])),
          `${id}: ${line}`,
        );
        assert.ok(Number(cell[2]) >= 1, `${id}: ${line}`);
      } else assert.ok(names.has(line), `${id}: ${line}`);
      // An amount is asked for in naira, in the list as in the form.
      assert.doesNotMatch(line, /kobo/i, `${id}: ${line}`);
    }
  }
});

test("an answer that was given but is wrong keeps what is wrong with it after the question", () => {
  const lines = missingFields(
    started("TPL-01", { issueDate: "2026-02-30", issuerName: "Synthetic Trading" }),
  );
  assert.ok(lines.includes("Issue date: Enter a real date (YYYY-MM-DD)."), lines.join(" | "));
  assert.ok(!lines.some((line) => line.startsWith("Issuing business legal name")), lines.join(" | "));
});

test("an amount that cannot be read is listed with a request for naira, not for kobo", () => {
  const data = emptyGuidedData("TPL-13");
  const content = compileGuidedContent({
    ...data,
    values: { ...data.values, feeKobo: "12.5x" },
  }) as CanonicalDocument;
  const lines = missingFields(content);
  assert.ok(
    lines.includes("Agreed fee in naira: Enter an amount in naira, such as 1500 or 1500.50."),
    lines.join(" | "),
  );
});

test("a blank document needs each of its details and its text, and blanks left in the text are counted", () => {
  assert.deepEqual(missingFields(blankContent()), [
    "Issued by",
    "Addressed to",
    "Reference number",
    "Issue date",
    "Due date",
    "Notes",
    "The document's text",
  ]);
  const content = blankContent();
  content.fields = {
    issuerName: "Synthetic Trading",
    recipientName: "Synthetic Customer",
    documentNumber: "S-1",
    issueDate: "2026-11-18",
    dueDate: "2026-12-02",
    notes: "Synthetic note.",
  };
  content.blocks = [
    { id: "b1", type: "paragraph", text: "Deliver to [Counterparty address] by ____.", rows: [] },
    { id: "b2", type: "paragraph", text: "Signed for {{name}} at [Counterparty address].", rows: [] },
  ];
  assert.deepEqual(missingFields(content), [
    "Blanks still in the text (3): [Counterparty address], ____, {{name}}",
  ]);
});
