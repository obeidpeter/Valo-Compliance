import test from "node:test";
import assert from "node:assert/strict";
import { parseFormText } from "@workspace/valo-core/form-text";
import type { GuidedTemplateId } from "@workspace/valo-core/guided";
import {
  compileForm,
  emptyFormData,
  formDocumentContent,
  formFit,
} from "@workspace/valo-core/guided-runtime-v2";
import { GUIDED_DOCUMENT_NOTE } from "@workspace/valo-core/guided-runtime";
import { documentInput } from "../../lib/valo-validation";
import { controlledHtml } from "../../lib/valo-render";
import { serializeRevision } from "../documents";
import { GUIDED_SPECS_V1 } from "@workspace/valo-core/guided-specs";
import { GUIDED_CHANGES_V2, GUIDED_SPECS_V2 } from "@workspace/valo-core/guided-specs-v2";
import type { GuidedSpecV2 } from "@workspace/valo-core/guided-v2";
import { readTemplateIntake } from "../publication";
import { FORM_TEXT_MAPS, annotateDraft, proposedFormText } from "./form-text-maps";

// Forms v2, slice 4 (docs/architecture/forms-v2.md): the annotation maps that turn a retained draft
// into proposed form text, and the v2 forms that fill it. The answers below are synthetic.
const mapped = Object.keys(FORM_TEXT_MAPS) as GuidedTemplateId[];
const words = (text: string) => text.match(/[\p{L}\p{N}]+/gu) ?? [];
const printedWords = (blocks: ReturnType<typeof compileForm>["blocks"]) =>
  blocks.flatMap((b) => (b.type === "table" ? b.rows.flat().flatMap(words) : words(b.text)));
/** Whether `part` is `whole` with words left out, and nothing else. */
function subsequence(part: string[], whole: string[]) {
  let at = 0;
  for (const word of part) {
    while (at < whole.length && whole[at] !== word) at++;
    if (at++ >= whole.length) return false;
  }
  return true;
}
/** Every combination of answers to the form's choices, each also unanswered. */
function choiceCombinations(spec: GuidedSpecV2) {
  let combinations: Record<string, string>[] = [{}];
  for (const choice of spec.fields.filter((f) => f.clause))
    combinations = combinations.flatMap((values) =>
      ["", ...(choice.options ?? []).map((o) => o.value)].map((option) => ({
        ...values,
        [choice.id]: option,
      })),
    );
  return combinations;
}

test("every map turns its retained draft into form text that the v2 form fits exactly", async () => {
  assert.deepEqual(mapped, ["TPL-01"]);
  for (const templateId of mapped) {
    const spec = GUIDED_SPECS_V2[templateId];
    assert.ok(spec, templateId);
    const text = parseFormText((await proposedFormText(templateId))!);
    assert.deepEqual(formFit(spec, text), [], templateId);
    // The same map applied twice is refused: each change names text found exactly once.
    const { section } = await readTemplateIntake(templateId);
    assert.throws(
      () =>
        annotateDraft(annotateDraft(section.body, FORM_TEXT_MAPS[templateId]!), FORM_TEXT_MAPS[templateId]!),
      /FORM_TEXT_MAP_DOES_NOT_MATCH_THE_DRAFT/,
    );
  }
  assert.equal(await proposedFormText("TPL-06"), null);
});

test("form text adds no words: with its slots left empty, every combination of choices prints only the draft's words, in its order", async () => {
  for (const templateId of mapped) {
    const spec = GUIDED_SPECS_V2[templateId]!;
    const { section } = await readTemplateIntake(templateId);
    const draft = words(section.body);
    const text = parseFormText((await proposedFormText(templateId))!);
    // Calculations left empty too: they print their placeholders.
    const empty: GuidedSpecV2 = {
      ...spec,
      calculated: Object.fromEntries(Object.keys(spec.calculated ?? {}).map((name) => [name, () => null])),
    };
    const combinations = choiceCombinations(spec);
    assert.ok(combinations.length > 1, templateId);
    for (const choices of combinations) {
      const data = emptyFormData(spec);
      data.values = { ...data.values, ...choices };
      const out = compileForm(empty, text, data);
      assert.ok(
        subsequence([...words(out.title), ...printedWords(out.blocks)], draft),
        `${templateId} ${JSON.stringify(choices)}`,
      );
    }
    // Each change that leaves words out, or keeps them only for an answer, says why.
    for (const change of FORM_TEXT_MAPS[templateId]!) {
      const leavesOut = !subsequence(words(change.from), words(change.to.replace(/\{[^}]*\}/g, "")));
      if (leavesOut || change.to.includes("{?")) assert.ok(change.why, change.from);
    }
  }
});

test("a v2 form asks v1's questions unchanged, and lists each question it adds or leaves out with its reason", () => {
  for (const [templateId, spec] of Object.entries(GUIDED_SPECS_V2) as [GuidedTemplateId, GuidedSpecV2][]) {
    const v1 = GUIDED_SPECS_V1[templateId];
    const changes = GUIDED_CHANGES_V2[templateId]!;
    for (const field of spec.fields) {
      const original = v1.fields.find((f) => f.id === field.id);
      if (!original) {
        assert.ok(
          changes.added.some((a) => a.id === field.id && a.why),
          field.id,
        );
        assert.ok(field.tokens?.length, `${field.id} serves a slot`);
        continue;
      }
      const { tokens: _tokens, clause: _clause, example: _example, ...asked } = field;
      assert.deepEqual(asked, original, field.id);
    }
    for (const field of v1.fields)
      assert.ok(
        spec.fields.some((f) => f.id === field.id) || changes.dropped.some((d) => d.id === field.id && d.why),
        field.id,
      );
    assert.equal(spec.tables, v1.tables);
    assert.equal(spec.dateOrder, v1.dateOrder);
  }
});

test("an invoice's answers fill its own wording: items, discount and tax rows, totals and optional lines", async () => {
  const spec = GUIDED_SPECS_V2["TPL-01"]!;
  const text = parseFormText((await proposedFormText("TPL-01"))!);
  const data = emptyFormData(spec);
  data.values = {
    ...data.values,
    issuerName: "Synthetic Supplies Ltd",
    issuerAddress: "1 Synthetic Road\nIkeja",
    recipientName: "Synthetic Buyer Ltd",
    documentNumber: "SYN-INV-001",
    issueDate: "2026-11-02",
    dueDate: "2026-11-30",
    billingBasis: "Synthetic October supplies",
    taxMode: "none",
    discountMode: "supplied",
    discountKobo: "50000",
  };
  data.tables.items = [
    { description: "Synthetic paper", quantity: "2", unit: "each", otherUnit: "", unitPriceKobo: "150000" },
    {
      description: "Synthetic ink",
      quantity: "1.5",
      unit: "other",
      otherUnit: "boxes",
      unitPriceKobo: "10001",
    },
  ];
  const out = compileForm(spec, text, data);
  const shown = out.blocks.map((b) =>
    b.type === "table" ? b.rows.map((r) => r.join(" | ")).join("\n") : b.text,
  );
  assert.equal(out.title, "INVOICE");
  assert.deepEqual(shown, [
    "Synthetic Supplies Ltd\n1 Synthetic Road\nIkeja",
    "Bill to: Synthetic Buyer Ltd",
    "Invoice reference | Issue date | Currency\nSYN-INV-001 | 2 Nov 2026 | NGN",
    "Payment date: 30 Nov 2026",
    "Description | Quantity | Unit | Unit price | Line amount\nSynthetic paper | 2 | Each | ₦1,500.00 | ₦3,000.00\nSynthetic ink | 1.5 | boxes | ₦100.01 | ₦150.02",
    "Amount summary | Amount\nSubtotal | ₦3,150.02\nAgreed discount | −₦500.00\nInvoice total | ₦2,650.02",
    "Transaction notes\nSynthetic October supplies",
    "Please contact Synthetic Supplies Ltd with the invoice reference if any detail needs clarification.",
    "This invoice is prepared from information supplied by the issuer. It is not a receipt or independently verified evidence that payment has been received. No government tax-invoice status is claimed by this template.",
  ]);
  assert.deepEqual(out.unfilled, []);
  assert.deepEqual(out.selectedClauses, ["taxMode=none", "discountMode=supplied"]);
  // A supplied tax amount prints its own row and joins the total; a discount above the subtotal
  // leaves the total unworked, as v1 refuses it.
  const taxed = compileForm(spec, text, {
    ...data,
    values: {
      ...data.values,
      taxMode: "supplied",
      taxLabel: "Synthetic levy",
      taxAmountKobo: "1000",
      taxBasis: "Synthetic basis",
    },
  });
  assert.match(
    taxed.blocks[5]!.rows.map((r) => r.join(" | ")).join("\n"),
    /Synthetic levy \| ₦10\.00\nInvoice total \| ₦2,660\.02/,
  );
  assert.deepEqual(
    taxed.blocks.slice(6, 8).map((b) => b.text),
    ["Transaction notes\nSynthetic October supplies", "Synthetic basis"],
  );
  const over = compileForm(spec, text, { ...data, values: { ...data.values, discountKobo: "999999999" } });
  assert.ok(over.unfilled.includes("calc.total"));
});

test("an invoice form document is saved as its answers make it, hashed as V2, and its file prints the template's wording with only its note among its fields", async () => {
  const spec = GUIDED_SPECS_V2["TPL-01"]!;
  const text = parseFormText((await proposedFormText("TPL-01"))!);
  const data = emptyFormData(spec);
  data.values = {
    ...data.values,
    issuerName: "Synthetic Supplies Ltd",
    recipientName: "Synthetic Buyer Ltd",
    documentNumber: "SYN-INV-004",
    issueDate: "2026-11-30",
    dueDate: "2026-11-02",
    billingBasis: "Synthetic supplies",
    taxMode: "none",
    discountMode: "none",
  };
  const { unfilled, ...content } = formDocumentContent(spec, text, data);
  // The document's own fields come from the answers as v1 takes them: a payment date before the
  // issue date is left out.
  assert.deepEqual(content.fields, {
    issuerName: "Synthetic Supplies Ltd",
    recipientName: "Synthetic Buyer Ltd",
    documentNumber: "SYN-INV-004",
    issueDate: "2026-11-30",
    dueDate: "",
    notes: GUIDED_DOCUMENT_NOTE,
  });
  assert.deepEqual(content.formAnswers, data);
  assert.deepEqual(content.selectedClauses, ["taxMode=none", "discountMode=none"]);
  assert.ok(unfilled.includes("items.description"));
  const tables = content.blocks.filter((b) => b.type === "table");
  assert.ok(tables.length === 3 && tables.every((t) => t.headerRows === 1));
  // The contract and its checks take it, and it is hashed as V2, so no V1 hash changes.
  const input = documentInput.parse({ title: "Invoice", content });
  assert.match(serializeRevision(input), /^valo-document-revision-v2\n/);
  // Its file prints the template's own wording with its header rows, and of the document's fields
  // only its note: the names and dates are in the wording.
  const html = controlledHtml({ title: "Invoice", content }, 1);
  assert.match(
    html,
    /<thead><tr><th>Invoice reference<\/th><th>Issue date<\/th><th>Currency<\/th><\/tr><\/thead>/,
  );
  assert.match(html, /Bill to: Synthetic Buyer Ltd/);
  assert.equal((html.match(/class="field"/g) ?? []).length, 1);
});
