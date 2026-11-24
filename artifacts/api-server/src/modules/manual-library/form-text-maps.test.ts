import test from "node:test";
import assert from "node:assert/strict";
import { parseFormText } from "@workspace/valo-core/form-text";
import type { GuidedTemplateId } from "@workspace/valo-core/guided";
import {
  compileForm,
  emptyFormData,
  formAnswerIssues,
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
/** Every combination of answers to the form's choices and confirmations, each also unanswered. */
function choiceCombinations(spec: GuidedSpecV2) {
  let combinations: Record<string, string>[] = [{}];
  for (const choice of spec.fields.filter((f) => f.clause || f.type === "acknowledgement"))
    combinations = combinations.flatMap((values) =>
      ["", ...(choice.clause ? (choice.options ?? []).map((o) => o.value) : ["yes"])].map((option) => ({
        ...values,
        [choice.id]: option,
      })),
    );
  return combinations;
}

test("every map turns its retained draft into form text that the v2 form fits exactly", async () => {
  assert.deepEqual(mapped, ["TPL-01", "TPL-02", "TPL-03", "TPL-04", "TPL-05"]);
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
    // Calculations left empty too: they print their placeholders. A choice that also fills a slot,
    // such as a delivery's status, is an answer there, so its slot is left empty like any other.
    const empty: GuidedSpecV2 = {
      ...spec,
      fields: spec.fields.map((f) => (f.clause && f.tokens ? { ...f, tokens: [] } : f)),
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
    // v1's tables are asked as v1 asks them: each column kept unchanged or dropped with its reason, and
    // fewer rows only where a reason is given.
    for (const table of v1.tables) {
      const asked = spec.tables.find((t) => t.id === table.id)!;
      for (const column of table.columns) {
        const kept = asked.columns.find((c) => c.id === column.id);
        if (kept) assert.equal(kept, column, `${table.id}.${column.id}`);
        else
          assert.ok(
            changes.dropped.some((d) => d.id === `${table.id}.${column.id}` && d.why),
            `${table.id}.${column.id}`,
          );
      }
      if (asked.maxRows !== table.maxRows)
        assert.ok(
          changes.rows.some((r) => r.table === table.id && r.maxRows === asked.maxRows && r.why),
          table.id,
        );
    }
    // A table the form does not change is v1's own, by reference.
    const changed = new Set([
      ...changes.dropped.filter((d) => d.id.includes(".")).map((d) => d.id.split(".")[0]!),
      ...changes.rows.map((r) => r.table),
    ]);
    if (!changed.size) assert.equal(spec.tables, v1.tables);
    for (const table of v1.tables)
      if (!changed.has(table.id))
        assert.equal(
          spec.tables.find((t) => t.id === table.id),
          table,
          table.id,
        );
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

test("a quotation's answers fill its own wording: items, discount and tax rows, the tax basis, the quoted total and the arrangements given", async () => {
  const spec = GUIDED_SPECS_V2["TPL-02"]!;
  const text = parseFormText((await proposedFormText("TPL-02"))!);
  const data = emptyFormData(spec);
  data.values = {
    ...data.values,
    issuerName: "Synthetic Builders Ltd",
    issuerAddress: "2 Synthetic Close\nYaba",
    recipientName: "Synthetic Client Ltd",
    documentNumber: "SYN-QUO-001",
    issueDate: "2026-11-02",
    validUntil: "2026-11-30",
    scope: "Synthetic shop fit-out",
    taxMode: "supplied",
    taxLabel: "Synthetic levy",
    taxAmountKobo: "1000",
    taxBasis: "Synthetic basis",
    discountMode: "supplied",
    discountKobo: "50000",
    acceptance: "Synthetic two-week delivery",
    paymentArrangement: "Synthetic deposit then balance",
  };
  data.tables.items = [
    {
      description: "Synthetic shelving",
      quantity: "2",
      unit: "each",
      otherUnit: "",
      unitPriceKobo: "150000",
    },
  ];
  const out = compileForm(spec, text, data);
  const shown = out.blocks.map((b) =>
    b.type === "table" ? b.rows.map((r) => r.join(" | ")).join("\n") : b.text,
  );
  assert.equal(out.title, "QUOTATION");
  assert.deepEqual(shown, [
    "Synthetic Builders Ltd\n2 Synthetic Close\nYaba",
    "Prepared for: Synthetic Client Ltd",
    "Quotation reference: SYN-QUO-001\nIssue date: 2 Nov 2026\nCurrency: NGN\nValid until: 30 Nov 2026",
    "Your request",
    "Synthetic shop fit-out",
    "Included in this quotation",
    "Description | Quantity | Unit | Unit price | Line amount\nSynthetic shelving | 2 | Each | ₦1,500.00 | ₦3,000.00",
    "Price summary | Amount\nSubtotal | ₦3,000.00\nAgreed discount | −₦500.00\nSynthetic levy | ₦10.00\nQuoted total | ₦2,510.00",
    "Synthetic basis",
    "Scope and arrangements",
    "Proposed delivery or completion: Synthetic two-week delivery",
    "Proposed payment arrangement, if supplied: Synthetic deposit then balance",
    "Next step",
    "Please contact Synthetic Builders Ltd quoting SYN-QUO-001 to confirm your requirements or discuss changes. The price and scope above should be checked again if the requested work changes.",
    "This quotation describes the issuer's proposed offer. It does not record payment, delivery or customer acceptance. Any later acceptance or agreement should be recorded accurately and linked to the version concerned.",
  ]);
  assert.deepEqual(out.unfilled, []);
  assert.deepEqual(out.selectedClauses, ["taxMode=supplied", "discountMode=supplied"]);
  // v1's date order holds: a quotation valid only until before its issue date is a draft answer,
  // which fills no slot, so its optional line is left out until it is corrected.
  const earlier = { ...data, values: { ...data.values, validUntil: "2026-11-01" } };
  assert.match(formAnswerIssues(spec, earlier).drafts.validUntil!, /precedes the issue date/);
  assert.ok(!compileForm(spec, text, earlier).blocks.some((b) => b.text.includes("Valid until")));
  // The new questions are optional: without them, their lines are left out.
  const plain = compileForm(spec, text, { ...data, values: { ...data.values, paymentArrangement: "" } });
  assert.ok(!plain.blocks.some((b) => b.text.startsWith("Proposed payment arrangement")));
});

test("a receipt's answers fill its own wording, and it states the payment was received only once the business confirms it", async () => {
  const spec = GUIDED_SPECS_V2["TPL-03"]!;
  const text = parseFormText((await proposedFormText("TPL-03"))!);
  const data = emptyFormData(spec);
  data.values = {
    ...data.values,
    issuerName: "Synthetic Supplies Ltd",
    issuerAddress: "1 Synthetic Road, Ikeja",
    recipientName: "Synthetic Payer Ltd",
    documentNumber: "SYN-REC-001",
    issueDate: "2026-11-03",
    paymentDate: "2026-11-02",
    receivedKobo: "265002",
    paymentMethod: "transfer",
    paymentReference: "SYN-TRF-9",
    purpose: "Payment for invoice SYN-INV-001",
    relatedReference: "SYN-INV-001",
    recordedBy: "Synthetic cashier",
  };
  const shown = (values: Record<string, string>) =>
    compileForm(spec, text, { ...data, values: { ...data.values, ...values } }).blocks.map((b) =>
      b.type === "table" ? b.rows.map((r) => r.join(" | ")).join("\n") : b.text,
    );
  const unconfirmed = shown({});
  assert.deepEqual(unconfirmed, [
    "Synthetic Supplies Ltd\n1 Synthetic Road, Ikeja",
    "Receipt reference: SYN-REC-001\nDate issued: 3 Nov 2026",
    "Received from: Synthetic Payer Ltd",
    "Payment acknowledged by issuer | Detail\nAmount received | ₦2,650.02\nDate received | 2 Nov 2026\nPayment method, if recorded | Bank transfer\nPayment reference, if recorded | SYN-TRF-9",
    "Payment for: Payment for invoice SYN-INV-001\nRelated invoice or order, if any: SYN-INV-001",
    "Recorded by: Synthetic cashier",
    "Issuer acknowledgement: Receipt acknowledgement not yet recorded \u2014 not evidence of payment.",
    "Prepared from information supplied by the issuer. Valo has not independently verified this payment. This customer business receipt is separate from a receipt issued for a purchase from Valo.",
  ]);
  const confirmed = shown({ acknowledgement: "yes" });
  assert.equal(
    confirmed[6],
    "Issuer acknowledgement: The issuer confirms that the payment described above was received according to their records.",
  );
  assert.deepEqual(
    compileForm(spec, text, { ...data, values: { ...data.values, acknowledgement: "yes" } }).unfilled,
    [],
  );
});

test("a purchase order's answers fill its own wording: the buyer's contact, the order lines and total, the delivery arrangement and the order control", async () => {
  const spec = GUIDED_SPECS_V2["TPL-04"]!;
  const text = parseFormText((await proposedFormText("TPL-04"))!);
  const data = emptyFormData(spec);
  data.values = {
    ...data.values,
    issuerName: "Synthetic Retail Ltd",
    purchasingContact: "Synthetic buyer, 0800 000 0000",
    issuerAddress: "3 Synthetic Avenue, Surulere",
    recipientName: "Synthetic Wholesale Ltd",
    documentNumber: "SYN-PO-001",
    issueDate: "2026-11-02",
    deliveryLocation: "Synthetic warehouse",
    deliveryDate: "2026-11-10",
    taxMode: "none",
    discountMode: "none",
    paymentTerms: "Synthetic 30 days after delivery",
    authority: "Synthetic purchasing manager",
    supplierResponse: "Not recorded",
  };
  data.tables.items = [
    { description: "Synthetic cartons", quantity: "10", unit: "each", otherUnit: "", unitPriceKobo: "20000" },
  ];
  const out = compileForm(spec, text, data);
  const shown = out.blocks.map((b) =>
    b.type === "table" ? b.rows.map((r) => r.join(" | ")).join("\n") : b.text,
  );
  assert.equal(out.title, "PURCHASE ORDER");
  assert.deepEqual(shown, [
    "Buyer: Synthetic Retail Ltd\nPurchasing contact: Synthetic buyer, 0800 000 0000\n3 Synthetic Avenue, Surulere",
    "Supplier: Synthetic Wholesale Ltd",
    "Purchase order reference: SYN-PO-001\nOrder date: 2 Nov 2026\nCurrency: NGN",
    "Requested supply",
    "Description and specification | Quantity | Unit | Unit price | Line amount\nSynthetic cartons | 10 | Each | ₦200.00 | ₦2,000.00",
    "Order amount summary | Amount\nSubtotal | ₦2,000.00\nOrder total | ₦2,000.00",
    "Delivery or service arrangement",
    "Deliver to / service location or arrangement: Synthetic warehouse",
    "Requested or confirmed date, correctly labelled: 10 Nov 2026",
    "Agreed or proposed payment arrangement, correctly labelled: Synthetic 30 days after delivery",
    "Order control",
    "Authorised by: Synthetic purchasing manager",
    "Supplier response: Not recorded",
    "Please use SYN-PO-001 in correspondence and related delivery or billing documents. Contact Synthetic buyer, 0800 000 0000 to clarify any difference before proceeding on changed instructions.",
    "This document records the buyer's stated purchase instruction. Supplier acceptance, delivery and payment are separate events and are not inferred from its preparation.",
  ]);
  assert.deepEqual(out.unfilled, []);
  // Without a purchasing contact, the lines that name one are left out.
  const noContact = compileForm(spec, text, { ...data, values: { ...data.values, purchasingContact: "" } });
  assert.ok(
    noContact.blocks.every((b) => !b.text.includes("Purchasing contact") && !b.text.includes("Contact ")),
  );
});

test("a delivery note's answers fill its own wording: its status keeps the dispatch or receipt line, one row for each item, and a part delivery's difference", async () => {
  const spec = GUIDED_SPECS_V2["TPL-05"]!;
  const text = parseFormText((await proposedFormText("TPL-05"))!);
  const data = emptyFormData(spec);
  data.values = {
    ...data.values,
    issuerName: "Synthetic Supplies Ltd",
    issuerAddress: "1 Synthetic Road, Ikeja",
    recipientName: "Synthetic Buyer Ltd",
    destination: "Synthetic store, Yaba",
    documentNumber: "SYN-DN-001",
    issueDate: "2026-11-04",
    deliveryStatus: "dispatched",
    dispatchDate: "2026-11-05",
    acknowledger: "Synthetic storekeeper",
  };
  data.tables.deliveryItems = [
    { description: "Synthetic cartons", quantity: "10", unit: "each", otherUnit: "" },
  ];
  const shown = (values: Record<string, string>) =>
    compileForm(spec, text, { ...data, values: { ...data.values, ...values } }).blocks.map((b) =>
      b.type === "table" ? b.rows.map((r) => r.join(" | ")).join("\n") : b.text,
    );
  assert.deepEqual(shown({}), [
    "From: Synthetic Supplies Ltd\n1 Synthetic Road, Ikeja",
    "To: Synthetic Buyer Ltd\nDestination: Synthetic store, Yaba",
    "Delivery note reference: SYN-DN-001\nPrepared on: 4 Nov 2026\nMovement status: Dispatched",
    "Dispatch: 5 Nov 2026",
    "Goods",
    "Item and useful reference | Unit | Quantity sent or planned, accurately labelled\nSynthetic cartons | Each | 10",
    "Condition and differences",
    "Handover record",
    "Received by: Synthetic storekeeper",
    "This note reflects the movement and handover facts entered by the issuer. A prepared or dispatched note does not establish completed delivery. Any acknowledgement is limited to what is actually recorded; payment, product fitness and regulatory approval are not established by this document.",
  ]);
  assert.deepEqual(compileForm(spec, text, data).unfilled, []);
  // A received delivery prints its receipt date instead; a part delivery its difference; a planned
  // one neither line, since its status says so.
  assert.ok(
    shown({ deliveryStatus: "received", receivedDate: "2026-11-06" }).includes(
      "Delivery or attempt: 6 Nov 2026",
    ),
  );
  const partial = shown({ deliveryStatus: "partial", partialDetails: "Two cartons short" });
  assert.ok(partial.includes("Difference or issue: Two cartons short"));
  assert.ok(!partial.some((line) => line.startsWith("Dispatch") || line.startsWith("Delivery or attempt")));
  assert.ok(!shown({ deliveryStatus: "planned" }).some((line) => line.startsWith("Dispatch")));
  // The form asks no condition for each item: the column is not one of its table's.
  assert.ok(!spec.tables[0]!.columns.some((c) => c.id === "condition"));
  assert.deepEqual(
    GUIDED_CHANGES_V2["TPL-05"]!.dropped.map((d) => d.id),
    ["deliveryItems.condition"],
  );
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
  // Its wording leaves that payment date out too: a date before the date it must follow is a draft
  // answer, which fills no slot, so the slot keeps its placeholder.
  assert.ok(unfilled.includes("dueDate"));
  assert.ok(
    content.blocks.some((b) => b.text === "Payment date: [Confirmed date and accurate label, if supplied]"),
  );
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
