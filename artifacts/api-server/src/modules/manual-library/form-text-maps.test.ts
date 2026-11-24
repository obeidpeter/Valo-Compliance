import test from "node:test";
import assert from "node:assert/strict";
import { parseFormText, type FormInline, type FormNode } from "@workspace/valo-core/form-text";
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
/** Every combination of answers to the form's choices, confirmations and worked-out choices, each
 * also unanswered. */
function choiceCombinations(spec: GuidedSpecV2) {
  const choices: [string, readonly string[]][] = [
    ...spec.fields
      .filter((f) => f.clause || f.type === "acknowledgement")
      .map((f): [string, readonly string[]] => [
        f.id,
        f.clause ? (f.options ?? []).map((o) => o.value) : ["yes"],
      ]),
    ...Object.entries(spec.derived ?? {}).map(([id, d]): [string, readonly string[]] => [id, d.options]),
  ];
  let combinations: Record<string, string>[] = [{}];
  for (const [id, options] of choices)
    combinations = combinations.flatMap((values) =>
      ["", ...options].map((option) => ({ ...values, [id]: option })),
    );
  return combinations;
}
/** Whether `part` uses no word more often than `whole` has it. */
function fromWords(part: string[], whole: string[]) {
  const left = new Map<string, number>();
  for (const word of whole) left.set(word, (left.get(word) ?? 0) + 1);
  return part.every((word) => {
    const n = left.get(word) ?? 0;
    left.set(word, n - 1);
    return n > 0;
  });
}

test("every map turns its retained draft into form text that the v2 form fits exactly", async () => {
  assert.deepEqual(mapped, [
    "TPL-01",
    "TPL-02",
    "TPL-03",
    "TPL-04",
    "TPL-05",
    "TPL-08",
    "TPL-12",
    "TPL-16",
    "TPL-17",
  ]);
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
    const empty = (choices: Record<string, string>): GuidedSpecV2 => ({
      ...spec,
      fields: spec.fields.map((f) => (f.clause && f.tokens ? { ...f, tokens: [] } : f)),
      calculated: Object.fromEntries(Object.keys(spec.calculated ?? {}).map((name) => [name, () => null])),
      // A worked-out choice takes each of its options in turn.
      ...(spec.derived
        ? {
            derived: Object.fromEntries(
              Object.entries(spec.derived).map(([id, d]) => [id, { ...d, of: () => choices[id] || null }]),
            ),
          }
        : {}),
    });
    // A map that moves the draft's words, each move with its reason, keeps to them without keeping
    // their order; every other map keeps their order too.
    const moves = FORM_TEXT_MAPS[templateId]!.some((change) => change.moves);
    const combinations = choiceCombinations(spec);
    assert.ok(combinations.length > 1, templateId);
    for (const choices of combinations) {
      const data = emptyFormData(spec);
      data.values = { ...data.values, ...choices };
      const out = compileForm(empty(choices), text, data);
      const printed = [...words(out.title), ...printedWords(out.blocks)];
      assert.ok(
        moves ? fromWords(printed, draft) : subsequence(printed, draft),
        `${templateId} ${JSON.stringify(choices)}`,
      );
    }
    // Each change that leaves words out, or keeps them only for an answer, says why.
    for (const change of FORM_TEXT_MAPS[templateId]!) {
      const leavesOut = !subsequence(words(change.from), words(change.to.replace(/\{[^}]*\}/g, "")));
      if (leavesOut || change.to.includes("{?") || change.moves) assert.ok(change.why, change.from);
    }
  }
});

test("no placeholder is left out silently: every bracketed placeholder of the text is a slot, unless it prints only while a choice is unanswered", async () => {
  const literal = /\[[^\]]*\]/;
  for (const templateId of mapped) {
    const text = parseFormText((await proposedFormText(templateId))!);
    const left: string[] = [];
    const inline = (parts: FormInline[], unanswered: boolean) => {
      for (const part of parts) {
        if (part.kind === "text" && !unanswered && literal.test(part.text)) left.push(part.text);
        if (part.kind === "span") inline(part.parts, unanswered || part.span.option === "");
      }
    };
    const walk = (nodes: FormNode[], unanswered: boolean) => {
      for (const node of nodes) {
        if (node.kind === "heading") inline(node.parts, unanswered);
        if (node.kind === "paragraph") for (const line of node.lines) inline(line, unanswered);
        if (node.kind === "list") for (const item of node.items) inline(item, unanswered);
        if (node.kind === "table") {
          for (const cell of node.header) inline(cell, unanswered);
          for (const row of node.rows)
            for (const cell of row.cells) inline(cell, unanswered || row.span?.option === "");
        }
        if (node.kind === "span") walk(node.nodes, unanswered || node.span.option === "");
        if (node.kind === "repeat") walk(node.nodes, unanswered);
      }
    };
    walk(text.nodes, false);
    assert.deepEqual(left, [], templateId);
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
        // A new question serves a slot, or is a choice whose options keep passages.
        assert.ok(field.tokens?.length || field.clause, `${field.id} serves a slot or keeps passages`);
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

test("meeting minutes' answers fill their own wording: the attendees, a heading, discussion and outcome for each topic, the actions, and a confirmation only once recorded", async () => {
  const spec = GUIDED_SPECS_V2["TPL-08"]!;
  const text = parseFormText((await proposedFormText("TPL-08"))!);
  const data = emptyFormData(spec);
  data.values = {
    ...data.values,
    issuerName: "Synthetic Traders",
    meetingTitle: "Synthetic monthly review",
    issueDate: "2026-11-05",
    location: "Synthetic office",
    chair: "Synthetic chair",
    minuteTaker: "Synthetic minute taker",
    recordStatus: "draft",
  };
  data.tables.attendees = [
    { name: "Synthetic chair", role: "Owner" },
    { name: "Synthetic staff member", role: "" },
  ];
  data.tables.decisions = [
    {
      topic: "Synthetic stock",
      discussion: "Synthetic stock levels reviewed",
      outcome: "Synthetic reorder agreed",
    },
  ];
  data.tables.actions = [{ action: "Synthetic reorder", owner: "Synthetic staff member", dueDate: "" }];
  const shown = (values: Record<string, string>) =>
    compileForm(spec, text, { ...data, values: { ...data.values, ...values } }).blocks.map((b) =>
      b.type === "table" ? b.rows.map((r) => r.join(" | ")).join("\n") : b.text,
    );
  const draft = shown({});
  assert.deepEqual(draft.slice(0, 11), [
    "Business/team: Synthetic Traders\nMeeting: Synthetic monthly review",
    "Date: 5 Nov 2026\nLocation or method: Synthetic office\nFacilitator: Synthetic chair\nNote-taker: Synthetic minute taker",
    "Present\nSynthetic chair (Owner)\nSynthetic staff member",
    "Record status: Draft notes",
    "Topics and outcomes",
    "Synthetic stock",
    "Discussion summary: Synthetic stock levels reviewed",
    "Outcome: Synthetic reorder agreed",
    "Action list",
    "Agreed next action | Owner or \u201cunassigned\u201d | Target date or \u201cnot agreed\u201d\nSynthetic reorder | Synthetic staff member | not agreed",
    "Questions and follow-up",
  ]);
  // Draft minutes print no confirmation; confirmed ones print theirs.
  assert.ok(!draft.some((line) => line.startsWith("Confirmed by/date")));
  const confirmed = shown({
    recordStatus: "confirmed",
    confirmation: "Synthetic confirmation at the next meeting",
  });
  assert.ok(confirmed.includes("Confirmed by/date: Synthetic confirmation at the next meeting"));
  assert.deepEqual(compileForm(spec, text, data).unfilled, []);
  // Up to 20 topics, each with its heading, discussion and outcome.
  assert.equal(spec.tables.find((t) => t.id === "decisions")!.maxRows, 20);
});

test("a payment reminder's answers fill its own letter: the balance by the draft's formula, the timing paragraph from its due date and its own date, and a dispute or arrangement only when chosen", async () => {
  const spec = GUIDED_SPECS_V2["TPL-12"]!;
  const text = parseFormText((await proposedFormText("TPL-12"))!);
  const data = emptyFormData(spec);
  data.values = {
    ...data.values,
    issuerName: "Synthetic Supplies Ltd",
    issuerAddress: "accounts@synthetic.example",
    issueDate: "2026-11-20",
    recipientName: "Synthetic Buyer Ltd",
    invoiceReference: "SYN-INV-001",
    invoiceIssueDate: "2026-11-02",
    billingBasis: "synthetic October supplies",
    invoiceDueDate: "2026-11-16",
    balanceDate: "2026-11-19",
    invoiceAmountKobo: "265002",
    paymentsKnown: "listed",
    creditsKobo: "0",
    disputeKind: "none",
    replyContact: "accounts@synthetic.example",
    senderName: "Synthetic accounts officer",
  };
  data.tables.payments = [{ reference: "SYN-TRF-1", amountKobo: "100000" }];
  const shown = (
    values: Record<string, string>,
    payments: Record<string, string>[] = data.tables.payments ?? [],
  ) =>
    compileForm(spec, text, {
      ...data,
      values: { ...data.values, ...values },
      tables: { payments },
    }).blocks.map((b) => b.text);
  const letter = shown({});
  assert.ok(
    letter.includes(
      "As of 19 Nov 2026, our records show an original invoice amount of ₦2,650.02, payments of ₦1,000.00 and confirmed credits or reductions of ₦0.00.",
    ),
  );
  assert.ok(letter.some((p) => p.endsWith("the remaining recorded balance is ₦1,650.02.")));
  assert.ok(
    letter.includes(
      "The agreed payment date recorded for this invoice was 16 Nov 2026. Please let us know the expected payment date, or raise any issue that needs resolving.",
    ),
  );
  assert.deepEqual(compileForm(spec, text, data).unfilled, []);
  // The timing paragraph follows the dates: due on the letter's date, or still ahead.
  assert.ok(
    shown({ invoiceDueDate: "2026-11-20" }).some((p) =>
      p.startsWith("The payment date recorded for this invoice is today, 20 Nov 2026."),
    ),
  );
  assert.ok(
    shown({ invoiceDueDate: "2026-11-30" }).includes(
      "The payment date recorded for this invoice is 30 Nov 2026. This is a reminder ahead of that date.",
    ),
  );
  // A dispute prints its paragraph, with the amount once given; an arrangement its own.
  const disputed = shown({ disputeKind: "dispute", dispute: "the delivery date", disputedKobo: "50000" });
  assert.ok(
    disputed.includes(
      "We understand that the delivery date is still being discussed. The amount currently identified as disputed is ₦500.00. This message does not treat that issue as settled.",
    ),
  );
  assert.ok(
    shown({ disputeKind: "arrangement", dispute: "two monthly payments" }).includes(
      "Our recorded arrangement is two monthly payments. Please let us know if our understanding is incorrect or if you need to discuss it.",
    ),
  );
  // No balance prints while payments are unresolved, when a payment is listed twice, or when nothing is
  // owed: the letter is then not complete.
  const unbalanced = (
    values: Record<string, string>,
    payments: Record<string, string>[] = data.tables.payments ?? [],
  ) =>
    compileForm(spec, text, { ...data, values: { ...data.values, ...values }, tables: { payments } })
      .unfilled;
  assert.ok(unbalanced({ paymentsKnown: "unknown" }).includes("calc.balance"));
  assert.ok(
    unbalanced({}, [
      { reference: "SYN-TRF-1", amountKobo: "100000" },
      { reference: "syn-trf-1", amountKobo: "100000" },
    ]).includes("calc.balance"),
  );
  assert.ok(unbalanced({ creditsKobo: "165002" }).includes("calc.balance"));
});

test("an offer letter's answers fill its own wording: the employer and the candidate, the terms one to a line, the choices made, and the response record left for completion by hand", async () => {
  const spec = GUIDED_SPECS_V2["TPL-17"]!;
  const text = parseFormText((await proposedFormText("TPL-17"))!);
  const data = emptyFormData(spec);
  data.values = {
    ...data.values,
    issuerName: "Synthetic Employer Ltd",
    issuerAddress: "12 Synthetic Way\nIkeja, Lagos",
    recipientName: "Ada Synthetic",
    recipientAddress: "4 Synthetic Close\nYaba, Lagos",
    documentNumber: "SYN-OFF-001",
    issueDate: "2026-11-24",
    role: "Synthetic accounts officer",
    reportsTo: "Synthetic finance manager",
    duties: "Synthetic role description, version 1",
    workplace: "Synthetic head office, Ikeja; no remote work",
    startDate: "2027-01-04",
    termType: "open",
    terminationTerms: "One month's written notice by either party",
    grossPayKobo: "35000000",
    payPeriod: "month",
    payBasis: "Monthly salary paid by bank transfer on the last working day",
    allowances: "Synthetic transport allowance",
    hours: "Monday to Friday, 8am to 5pm, with a one-hour break",
    leaveTerms: "Synthetic leave schedule, version 1",
    benefits: "Synthetic pension scheme, as in the contract's Schedule A",
    probation: "no",
    contractReference: "Synthetic employment contract SYN-EC-001, version 1, with Schedules A and B",
    conditions: "none",
    responseDate: "2026-12-08",
    responseMethod: "Reply by email to the synthetic HR address",
    representative: "Synthetic HR manager, hr@synthetic.example",
    firstDayContact: "Synthetic office manager",
    joiningArrangements: "Arrive at 8am at reception with identification",
    responseStatus: "No response recorded",
  };
  const compiled = (values: Record<string, string> = {}) =>
    compileForm(spec, text, { ...data, values: { ...data.values, ...values } });
  const out = compiled();
  assert.equal(out.title, "OFFER LETTER");
  const shown = out.blocks.map((b) => b.text);
  assert.deepEqual(shown.slice(0, 5), [
    "Synthetic Employer Ltd\n12 Synthetic Way\nIkeja, Lagos\n24 Nov 2026 \u00b7 Reference SYN-OFF-001",
    "Ada Synthetic\n4 Synthetic Close\nYaba, Lagos",
    "Dear Ada Synthetic,",
    "We are pleased to offer you the position of Synthetic accounts officer with Synthetic Employer Ltd, reporting to Synthetic finance manager. The proposed start date is 4 Jan 2027 and the normal work location or remote arrangement is Synthetic head office, Ikeja; no remote work.",
    "The principal duties are set out in Synthetic role description, version 1.",
  ]);
  // The proposed terms print one to a line, each a list of its own.
  const terms = out.blocks.filter((b) => b.type === "list").map((b) => b.text);
  assert.deepEqual(terms, [
    "Employment duration: Indefinite",
    "Gross basic pay and currency: \u20a6350,000.00 per Month",
    "Payment cycle and method: Monthly salary paid by bank transfer on the last working day",
    "Additional allowances or variable pay: Synthetic transport allowance",
    "Working days, hours, breaks and additional-work arrangements: Monday to Friday, 8am to 5pm, with a one-hour break",
    "Annual leave and other leave/pay terms: Synthetic leave schedule, version 1",
    "Pension and other applicable benefits: Synthetic pension scheme, as in the contract's Schedule A",
    "Notice and any initial review period: One month's written notice by either party; no default probation",
  ]);
  assert.ok(shown.includes("We look forward to discussing your questions and the work ahead."));
  assert.equal(
    shown.find((line) => line.startsWith("The specific conditions")),
    "The specific conditions still to be completed: no outstanding conditions. No approval, reference or qualification is assumed to exist simply because this offer is prepared. Any proposed change to the start date or terms will be discussed and recorded.",
  );
  assert.equal(
    shown.find((line) => line.startsWith("Please contact")),
    "Please contact Synthetic HR manager, hr@synthetic.example to ask questions or provide your response by 8 Dec 2026. If you need more time, please let us know. A lack of response is not recorded as acceptance.",
  );
  // The representative's answer signs the letter; the response record is completed by hand.
  assert.deepEqual(shown.slice(-3), [
    "Synthetic HR manager, hr@synthetic.example",
    "Response record \u2014 complete only after a response occurs",
    "Candidate response: No response recorded\nDate and response reference: [ ]\nOutstanding matter: [ ]\nFinal start arrangements confirmed on: [actual date, if confirmed]",
  ]);
  assert.deepEqual(out.selectedClauses, ["termType=open", "probation=no", "conditions=none"]);
  assert.deepEqual(out.unfilled, []);
  // A fixed term prints its end date, an agreed review period a line of its own, listed conditions
  // their details, and the response date only once given.
  const other = compiled({
    termType: "fixed",
    endDate: "2027-12-31",
    probation: "yes",
    probationTerms: "Three-month review period with monthly reviews",
    conditions: "listed",
    conditionDetails: "Synthetic reference check by the employer before the start date",
    responseDate: "",
  });
  const otherShown = other.blocks.map((b) => b.text);
  assert.ok(otherShown.includes("Employment duration: fixed term with stated end 31 Dec 2027"));
  const notice = otherShown.indexOf(
    "Notice and any initial review period: One month's written notice by either party",
  );
  assert.equal(otherShown[notice + 1], "Three-month review period with monthly reviews");
  assert.equal(
    otherShown.find((line) => line.startsWith("The specific conditions")),
    "The specific conditions still to be completed are Synthetic reference check by the employer before the start date. We will communicate the outcome of each condition accurately. No approval, reference or qualification is assumed to exist simply because this offer is prepared. Any proposed change to the start date or terms will be discussed and recorded.",
  );
  assert.ok(
    otherShown.some((line) =>
      line.startsWith(
        "Please contact Synthetic HR manager, hr@synthetic.example to ask questions or provide your response. ",
      ),
    ),
  );
  assert.deepEqual(other.unfilled, []);
  // Unanswered, each choice prints the draft's own words.
  const empty = compileForm(spec, text, emptyFormData(spec)).blocks.map((b) => b.text);
  assert.ok(empty.includes("Employment duration: [Indefinite / fixed term with stated end and basis]"));
  assert.ok(empty.includes("Notice and any initial review period: [Validated terms]; no default probation"));
  assert.ok(empty.includes("[ ]"));
});

test("an employment contract's answers fill its own clauses once each: Schedule A keeps the leave and notice, Schedule B the documents, and the agreement record is left for completion by hand", async () => {
  const spec = GUIDED_SPECS_V2["TPL-16"]!;
  const text = parseFormText((await proposedFormText("TPL-16"))!);
  const data = emptyFormData(spec);
  data.values = {
    ...data.values,
    issuerName: "Synthetic Employer Ltd",
    issuerAddress: "12 Synthetic Way\nIkeja, Lagos",
    recipientName: "Ada Synthetic",
    recipientAddress: "4 Synthetic Close\nYaba, Lagos",
    documentNumber: "SYN-EC-001",
    contractVersion: "1",
    engagementPlace: "Ikeja, Lagos State",
    issueDate: "2026-11-24",
    role: "Synthetic accounts officer",
    reportsTo: "Synthetic finance manager",
    duties: "Synthetic role description, version 1",
    workplace: "Synthetic head office, Ikeja; no remote work",
    startDate: "2027-01-04",
    earlierService: "none confirmed",
    termType: "open",
    probation: "no",
    grossPayKobo: "35000000",
    payPeriod: "month",
    payBasis: "a fixed monthly salary, paid by bank transfer on the last working day",
    allowances: "a transport allowance, paid with the salary",
    hours: "Monday to Friday, 8am to 5pm, with a one-hour break",
    workContact: "the synthetic HR manager",
    leaveTerms: "Synthetic leave schedule, version 1",
    benefits: "the synthetic pension scheme",
    confidentialityTerms: "Synthetic confidentiality and IP schedule, version 1",
    grievanceTerms: "Synthetic disciplinary and grievance procedure, version 2",
    terminationTerms: "One month's written notice by either party",
    policies: "Synthetic employee handbook, version 2",
    termsReviewed: "yes",
  };
  const compiled = (values: Record<string, string> = {}) =>
    compileForm(spec, text, { ...data, values: { ...data.values, ...values } });
  const out = compiled();
  assert.equal(out.title, "EMPLOYMENT CONTRACT");
  const shown = out.blocks.map((b) => b.text);
  assert.deepEqual(shown.slice(0, 3), [
    "Contract reference: SYN-EC-001 \u00b7 Version: 1 \u00b7 Date: 24 Nov 2026",
    "This agreement is between Synthetic Employer Ltd, of 12 Synthetic Way, Ikeja, Lagos,",
    "and Ada Synthetic, of 4 Synthetic Close, Yaba, Lagos. The employer appoints the employee on the terms below and the completed schedules identified in this agreement.",
  ]);
  const starting = (words: string) => shown.find((line) => line.startsWith(words));
  assert.equal(
    starting("Employment starts on"),
    "Employment starts on 4 Jan 2027. Recognised earlier continuous service, if any, is none confirmed. The engagement is indefinite. Any renewal or change will be recorded separately; a blank renewal field is not a promise or automatic extension.",
  );
  assert.equal(
    starting("Gross basic pay"),
    "Gross basic pay is \u20a6350,000.00 per Month, calculated as a fixed monthly salary, paid by bank transfer on the last working day.",
  );
  assert.equal(
    starting("Separately identified"),
    "Separately identified allowances or variable pay are a transport allowance, paid with the salary. The employer will provide a clear record of the amounts paid and any deductions.",
  );
  assert.equal(
    starting("Normal working days"),
    "Normal working days and hours are Monday to Friday, 8am to 5pm, with a one-hour break. Recording or approving extra work must reflect what actually occurred. There is no agreement here to unlimited unpaid overtime.",
  );
  // One contact answers each question the draft gives a contact for.
  assert.equal(shown.join("\n").split("the synthetic HR manager").length - 1, 4);
  // Without a review period or qualifications, neither passage prints.
  assert.ok(!shown.some((line) => /initial review period|Required qualifications/.test(line)));
  assert.deepEqual(
    out.blocks.filter((b) => b.type === "list").map((b) => b.text),
    [
      "Engagement place/date: Ikeja, Lagos State, 24 Nov 2026",
      "Annual leave quantity, unit, qualifying basis and pay; Sick leave/pay and appropriate evidence process; Maternity-related leave/pay, nursing arrangements and applicable protection; Other leave and contractual improvements: Synthetic leave schedule, version 1",
      "Employer notice; employee notice; payment-in-lieu basis: One month's written notice by either party",
    ],
  );
  const scheduleB = shown.indexOf("Schedule B \u2014 associated documents");
  assert.equal(shown[scheduleB + 1], "Synthetic employee handbook, version 2");
  assert.deepEqual(shown.slice(-2), [
    "Employer representative name and authority: [ ]\nEmployee name: Ada Synthetic\nActual agreement/signature record and dates, only when completed by the parties: [ ]\nCopy provided to employee on: [actual date]",
    "No signature or agreement is created by generating this document.",
  ]);
  assert.deepEqual(out.selectedClauses, ["termType=open", "probation=no"]);
  assert.deepEqual(out.unfilled, []);
  // A fixed term, an agreed review period, qualifications and special conditions print when given.
  const other = compiled({
    termType: "fixed",
    endDate: "2027-12-31",
    probation: "yes",
    probationTerms: "three months, reviewed monthly",
    qualifications: "a synthetic accounting certificate, held",
    specialConditions: "Synthetic condition",
    contractVersion: "",
  });
  const otherShown = other.blocks.map((b) => b.text);
  assert.equal(otherShown[0], "Contract reference: SYN-EC-001 \u00b7 Date: 24 Nov 2026");
  assert.ok(otherShown.some((line) => line.includes("The engagement is fixed term ending on 31 Dec 2027.")));
  assert.ok(
    otherShown.includes(
      "The agreed initial review period is three months, reviewed monthly. Any proposed extension will be discussed and documented before implementation; no extension or termination is assumed merely because a review was not recorded.",
    ),
  );
  assert.ok(
    otherShown.includes(
      "Required qualifications or permissions for the role are a synthetic accounting certificate, held; no missing qualification is represented as held.",
    ),
  );
  assert.equal(
    other.blocks.filter((b) => b.type === "list").at(-1)!.text,
    "Special conditions individually agreed and separately checked: Synthetic condition",
  );
  assert.deepEqual(other.unfilled, []);
  // Unanswered, the review period prints the draft's own direction.
  const empty = compileForm(spec, text, emptyFormData(spec)).blocks.map((b) => b.text);
  assert.ok(
    empty.some((line) =>
      line.startsWith("[Include only a separately validated, expressly agreed probation clause:"),
    ),
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
