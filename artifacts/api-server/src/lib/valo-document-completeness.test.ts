import { test } from "node:test";
import assert from "node:assert/strict";
import { documentComplete, documentGaps } from "@workspace/valo-core/document-completeness";
import { parseFormText } from "@workspace/valo-core/form-text";
import { GUIDED_TEMPLATE_IDS, type GuidedField } from "@workspace/valo-core/guided";
import { compileGuidedContent, emptyGuidedData } from "@workspace/valo-core/guided-runtime";
import { emptyFormData, formDocumentContent } from "@workspace/valo-core/guided-runtime-v2";
import { GUIDED_SPECS_V1 } from "@workspace/valo-core/guided-specs";
import { GUIDED_SPECS_V2 } from "@workspace/valo-core/guided-specs-v2";
import type { GuidedDataV2 } from "@workspace/valo-core/guided-v2";
import { proposedFormText } from "../modules/manual-library/form-text-maps";

/** A valid answer to a question, of its type: a listed option that is a real fact, not "unknown". */
const valid = (field: GuidedField) =>
  field.type === "date"
    ? "2026-11-24"
    : field.type === "integer" || field.type === "quantity"
      ? "2"
      : field.type === "money_kobo"
        ? "150000"
        : field.type === "select"
          ? field.options!.find((option) => !/^(unknown|unanswered|not_applicable)$/i.test(option.value))!
              .value
          : field.type === "acknowledgement"
            ? "yes"
            : "Synthetic answer";

/** Every question of a form answered validly, and each table given its rows. */
function answered<
  T extends { values: Record<string, string>; tables: Record<string, Record<string, string>[]> },
>(
  data: T,
  spec: {
    fields: readonly GuidedField[];
    tables: readonly { id: string; minRows: number; columns: readonly GuidedField[] }[];
  },
): T {
  return {
    ...data,
    values: Object.fromEntries(spec.fields.map((field) => [field.id, valid(field)])),
    tables: Object.fromEntries(
      spec.tables.map((table) => [
        table.id,
        Array.from({ length: Math.max(table.minRows, 1) }, () =>
          Object.fromEntries(table.columns.map((column) => [column.id, valid(column)])),
        ),
      ]),
    ),
  };
}

/** A payment reminder's balance prints only while something is still owed: here ₦5,000 less a payment
 * of ₦1,000, and no credit. Its letter is incomplete otherwise, which the answers above would make it. */
const owing = (data: GuidedDataV2): GuidedDataV2 =>
  data.templateId !== "TPL-12"
    ? data
    : {
        ...data,
        values: { ...data.values, invoiceAmountKobo: "500000", creditsKobo: "0", disputedKobo: "0" },
        tables: { ...data.tables, payments: [{ reference: "SYN-PAY-1", amountKobo: "100000" }] },
      };

// EDT-005: "final export blocks mandatory omissions or requires a deliberately watermarked incomplete
// draft; never invent legal names, addresses or signatures."
test("a form document is complete once every answer it shows is valid and no slot is left unfilled, and a blank left for completion by hand, such as a signature, is not an omission", async () => {
  for (const id of GUIDED_TEMPLATE_IDS) {
    const spec = GUIDED_SPECS_V2[id]!;
    const text = parseFormText((await proposedFormText(id))!);
    const made = (data: GuidedDataV2) => {
      const { unfilled: _unfilled, ...content } = formDocumentContent(spec, text, data);
      return content;
    };
    // Nothing answered: the questions say what is missing, and its slots are theirs.
    const empty = documentGaps(made(emptyFormData(spec)), text);
    assert.equal(empty.kind, "form", id);
    assert.ok(empty.kind === "form" && Object.keys(empty.issues).length > 0, id);
    assert.deepEqual(empty.kind === "form" && empty.blanks, [], id);
    assert.equal(documentComplete(empty), false, id);

    // Every answer given: complete, with the form text. Without it, the blanks left for completion by
    // hand would be counted from the text, as the editor counts them while the form text loads.
    const full = made(owing(answered(emptyFormData(spec), spec)));
    const gaps = documentGaps(full, text);
    assert.deepEqual(gaps, { kind: "form", templateId: id, issues: {}, blanks: [] }, id);
    assert.equal(documentComplete(gaps), true, id);
    if (spec.blanks.length > 0) {
      const counted = documentGaps(full);
      assert.ok(counted.kind === "form" && counted.blanks.length > 0, id);
      assert.equal(documentComplete(counted), false, id);
    }
  }
});

test("a document made from questions is complete once its questions report no issue and no blank is left in its text", () => {
  for (const id of GUIDED_TEMPLATE_IDS) {
    const spec = GUIDED_SPECS_V1[id];
    const empty = documentGaps(compileGuidedContent(emptyGuidedData(id)));
    assert.equal(empty.kind, "questions", id);
    assert.equal(documentComplete(empty), false, id);
    const gaps = documentGaps(compileGuidedContent(answered(emptyGuidedData(id), spec)));
    assert.deepEqual(gaps, { kind: "questions", templateId: id, issues: {}, blanks: [] }, id);
    assert.equal(documentComplete(gaps), true, id);
  }
});

test("a document typed by hand is never complete in this sense: what it lacks is listed, its empty fields, its text and the blanks in it", () => {
  const typed = (text: string, fields: Partial<Record<string, string>> = {}) => ({
    fields: {
      issuerName: "Synthetic Trading Ltd",
      recipientName: "Synthetic Customer Ltd",
      documentNumber: "SYN-1",
      issueDate: "2026-11-24",
      dueDate: "2026-12-24",
      notes: "Synthetic note.",
      ...fields,
    },
    blocks: [{ id: "b1", type: "paragraph" as const, text, rows: [] }],
    selectedClauses: [],
    formatting: { font: "serif" as const, accent: "forest" as const },
  });
  const whole = documentGaps(typed("Thank you for your order."));
  assert.deepEqual(whole, { kind: "typed", fields: [], text: false, blanks: [] });
  assert.equal(documentComplete(whole), false);
  assert.deepEqual(documentGaps(typed("Dear [Customer name], ____", { dueDate: "", notes: " " })), {
    kind: "typed",
    fields: ["dueDate", "notes"],
    text: false,
    blanks: ["[Customer name]", "____"],
  });
  assert.deepEqual(documentGaps(typed("  ")), { kind: "typed", fields: [], text: true, blanks: [] });
});

test("a document whose questions cannot be read is unreadable, and never complete", () => {
  const invoice = compileGuidedContent(emptyGuidedData("TPL-01"));
  // A form document's answers for a form this site does not have, and v1 questions under v2 answers.
  for (const content of [
    { ...invoice, blocks: [], formAnswers: { templateId: "TPL-99" } },
    { ...invoice, formAnswers: { templateId: "TPL-01" } },
  ]) {
    const gaps = documentGaps(content);
    assert.deepEqual(gaps, { kind: "unreadable" });
    assert.equal(documentComplete(gaps), false);
  }
});
