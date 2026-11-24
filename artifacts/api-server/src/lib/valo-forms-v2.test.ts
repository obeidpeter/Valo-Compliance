import test from "node:test";
import assert from "node:assert/strict";
import { FormTextError, formTextSlots, formTextSpans, parseFormText } from "@workspace/valo-core/form-text";
import type { GuidedSpecV2 } from "@workspace/valo-core/guided-v2";
import {
  compileForm,
  emptyFormData,
  formAnswerIssues,
  formFit,
} from "@workspace/valo-core/guided-runtime-v2";
import { formatKobo } from "@workspace/valo-core/money";

// Forms v2, slice 2 (docs/architecture/forms-v2.md): the form-text grammar and the engine that fills
// it. The text and the form below are synthetic: no template's wording is used or released here.
const source = `# Synthetic service record

## 1. Parties

This record is between [Supplier legal name]{=supplierName} and [Customer legal name]{=customerName}.

## 2. Term

{?termType=fixed}
The record runs until [end date]{=endDate}.
{/?}
{?termType=open}
The record runs until either side ends it.
{/?}
{?termType=}
[Choose a fixed or an open term.]
{/?}

## 3. Deliverables

| Deliverable | Agreed timing |
| --- | --- |
| {*deliverables} [ ]{=deliverables.item} | [ ]{=deliverables.timing} |

## 4. Fee

The fee is [amount]{=calc.fee}, {?taxIncluded=yes}tax included{/?}{?taxIncluded=no}before any tax{/?}{?taxIncluded=}[say whether tax is included]{/?}.

- Synthetic first point.
- Synthetic second point for [Customer legal name]{=customerName}.

Signed: [ ]{=signature}
`;
const spec: GuidedSpecV2 = {
  schemaVersion: 2,
  templateId: "TPL-13",
  title: "Synthetic service record",
  fields: [
    { id: "supplierName", label: "Supplier", type: "text", required: true, tokens: ["supplierName"] },
    {
      id: "customerName",
      label: "Customer",
      type: "text",
      required: true,
      tokens: ["customerName"],
      example: "Synthetic Example Buyer Ltd",
    },
    {
      id: "termType",
      label: "Term",
      type: "select",
      required: true,
      clause: true,
      options: [
        { value: "fixed", label: "Fixed" },
        { value: "open", label: "Open" },
      ],
    },
    {
      id: "endDate",
      label: "End date",
      type: "date",
      required: true,
      when: { field: "termType", equals: "fixed" },
      tokens: ["endDate"],
    },
    { id: "fee", label: "Fee in whole kobo", type: "money_kobo", required: true },
    {
      id: "taxIncluded",
      label: "Tax included",
      type: "select",
      required: true,
      clause: true,
      options: [
        { value: "yes", label: "Yes" },
        { value: "no", label: "No" },
      ],
    },
  ],
  tables: [
    {
      id: "deliverables",
      label: "Deliverables",
      minRows: 1,
      maxRows: 20,
      columns: [
        { id: "item", label: "Deliverable", type: "text", required: true },
        { id: "timing", label: "Agreed timing", type: "text", required: false },
      ],
    },
  ],
  blanks: ["signature"],
  calculated: {
    "calc.fee": (data) =>
      /^(0|[1-9]\d{0,23})$/.test(data.values.fee ?? "") ? formatKobo(data.values.fee!) : null,
  },
};
const text = parseFormText(source);

test("form text reads headings, paragraphs, lists, tables, slots, spans and repeating rows", () => {
  assert.equal(text.title, "Synthetic service record");
  assert.deepEqual(
    formTextSlots(text).map((s) => [s.name, s.placeholder, s.row]),
    [
      ["supplierName", "[Supplier legal name]", null],
      ["customerName", "[Customer legal name]", null],
      ["endDate", "[end date]", null],
      ["deliverables.item", "[ ]", "deliverables"],
      ["deliverables.timing", "[ ]", "deliverables"],
      ["calc.fee", "[amount]", null],
      ["customerName", "[Customer legal name]", null],
      ["signature", "[ ]", null],
    ],
  );
  assert.deepEqual(
    formTextSpans(text).map((s) => `${s.question}=${s.option}`),
    ["termType=fixed", "termType=open", "termType=", "taxIncluded=yes", "taxIncluded=no", "taxIncluded="],
  );
  assert.deepEqual(
    text.nodes.map((n) => n.kind),
    [
      "heading",
      "paragraph",
      "heading",
      "span",
      "span",
      "span",
      "heading",
      "table",
      "heading",
      "paragraph",
      "list",
      "paragraph",
    ],
  );
});

test("form text refuses anything but plain words and its own marks, naming the line", () => {
  const refused: [string, RegExp][] = [
    ["No title here.", /starts with its title/],
    ["# Title\n\nA {stray} brace.", /braces are used only/],
    ["# Title\n\nA <b>tag</b>.", /no markup/],
    ["# Title\n\nA [link](https://example.invalid).", /no links/],
    ["# Title\n\nAn ![image](x.png).", /no images/],
    ["# Title\n\n**Bold** words.", /no emphasis/],
    ["# Title\n\nSome `code`.", /no code/],
    ["# Title\n\n[ ]{=Bad-Name}", /not a slot name/],
    ["# Title\n\n{?a=b}x{?c=d}y{/?}{/?}", /do not nest/],
    ["# Title\n\n{?a=b}never closed", /not closed on its line/],
    ["# Title\n\n{?a=b}\nNever closed.", /not closed/],
    ["# Title\n\n{/?}", /was not opened/],
    ["# Title\n\n{?a=b}\n{?c=d}\nx\n{/?}\n{/?}", /do not nest/],
    ["# Title\n\n| A | B |\n| C | D |", /separator row/],
    ["# Title\n\n| A | B |\n| --- | --- |\n| only one |", /as many cells/],
    ["# Title\n\n# Second title", /one title/],
    ["# Title\n\n#### Too deep", /## or ###/],
    ["# Title\n\nA control \u0007 character.", /control characters/],
    ["# A [slot]{=x} title", /plain words/],
  ];
  for (const [bad, reason] of refused)
    assert.throws(
      () => parseFormText(bad),
      (error: unknown) => error instanceof FormTextError && reason.test(error.message),
      bad,
    );
});

test("a form fits a text only when every question, slot, choice and size fits", () => {
  assert.deepEqual(formFit(spec, text), []);
  const without = (change: Partial<GuidedSpecV2>) => formFit({ ...spec, ...change }, text);
  const field = (id: string) => spec.fields.find((f) => f.id === id)!;
  const others = (id: string) => spec.fields.filter((f) => f.id !== id);
  // A question that fills a slot the text does not have.
  assert.ok(
    without({ fields: [...others("supplierName"), { ...field("supplierName"), tokens: ["missing"] }] }).some(
      (p) => p.includes('"supplierName" fills "missing"'),
    ),
  );
  // A slot nothing fills is never left out silently (EDT-001).
  assert.ok(
    without({ fields: others("supplierName") }).some((p) =>
      p.includes('"supplierName" is filled by nothing'),
    ),
  );
  assert.ok(without({ blanks: [] }).some((p) => p.includes('"signature" is filled by nothing')));
  // A choice: every option keeps a passage or is declared to keep none, and something prints while
  // it is unanswered.
  assert.ok(
    without({
      fields: [
        ...others("termType"),
        {
          ...field("termType"),
          options: [...field("termType").options!, { value: "rolling", label: "Rolling" }],
        },
      ],
    }).some((p) => p.includes('"termType=rolling" keeps no passage')),
  );
  assert.deepEqual(
    formFit(
      {
        ...spec,
        fields: [
          ...others("termType"),
          {
            ...field("termType"),
            options: [...field("termType").options!, { value: "rolling", label: "Rolling" }],
          },
        ],
        keepsNothing: [{ question: "termType", option: "rolling" }],
      },
      text,
    ),
    [],
  );
  assert.ok(
    formFit(
      spec,
      parseFormText(source.replace("{?termType=}\n[Choose a fixed or an open term.]\n{/?}\n", "")),
    ).some((p) => p.includes('"termType" prints nothing while it is unanswered')),
  );
  // A passage for an option that is not listed, and for a question that is not a choice.
  assert.ok(
    formFit(spec, parseFormText(source + "\n{?termType=weekly}x{/?}\n")).some((p) =>
      p.includes('"termType=weekly", which is not one of its options'),
    ),
  );
  assert.ok(
    without({
      fields: [...others("taxIncluded"), { ...field("taxIncluded"), clause: undefined as never }],
    }).some((p) => p.includes('"taxIncluded", which is not a choice')),
  );
  // Rows, calculations and confirmations.
  assert.ok(without({ tables: [] }).some((p) => p.includes('"deliverables", which is not one of the form')));
  assert.ok(
    formFit(spec, parseFormText(source + "\nOutside: [ ]{=deliverables.item}\n")).some((p) =>
      p.includes('"deliverables.item" is outside a row'),
    ),
  );
  assert.ok(without({ calculated: {} }).some((p) => p.includes('"calc.fee" is not worked out')));
  assert.ok(
    without({
      fields: [
        ...spec.fields,
        { id: "agree", label: "Agree", type: "acknowledgement", required: true, tokens: ["supplierName"] },
      ],
    }).some((p) => p.includes('"agree" is a confirmation')),
  );
  // The largest document must fit the contract: here, a paragraph with three long answers.
  const long = parseFormText("# T\n\n[a]{=a} [b]{=b} [c]{=c}\n");
  const longSpec: GuidedSpecV2 = {
    ...spec,
    fields: ["a", "b", "c"].map((id) => ({
      id,
      label: id,
      type: "long_text",
      required: false,
      tokens: [id],
    })),
    tables: [],
    blanks: [],
    calculated: {},
  };
  assert.ok(formFit(longSpec, long).some((p) => p.includes("longer than a block holds")));
});

test("compiling prints the text's own words, fills each slot with its answer and keeps only the chosen passages", () => {
  // Nothing answered: every slot prints its placeholder and is listed, blanks apart, and each choice
  // prints its unanswered passage.
  const empty = compileForm(spec, text, emptyFormData(spec));
  assert.equal(empty.title, "Synthetic service record");
  assert.deepEqual(empty.unfilled, [
    "supplierName",
    "customerName",
    "deliverables.item",
    "deliverables.timing",
    "calc.fee",
  ]);
  assert.deepEqual(empty.selectedClauses, []);
  const printed = (r: ReturnType<typeof compileForm>) =>
    r.blocks
      .map((b) => (b.type === "table" ? b.rows.map((row) => row.join(" | ")).join("\n") : b.text))
      .join("\n");
  assert.match(printed(empty), /\[Choose a fixed or an open term\.\]/);
  assert.match(printed(empty), /\[say whether tax is included\]/);
  assert.doesNotMatch(printed(empty), /runs until/);
  // The words printed are the text's own: with the placeholders taken out, every word of the
  // document is a word of the text, and the example is never printed.
  const words = (s: string) => s.match(/[A-Za-z]+/g) ?? [];
  const textWords = new Set(words(source.replace(/\{[^}]*\}/g, "")));
  for (const word of words(printed(empty))) assert.ok(textWords.has(word), word);
  assert.doesNotMatch(printed(empty), /Synthetic Example Buyer/);
  // Answered.
  const data = emptyFormData(spec);
  data.values = {
    ...data.values,
    supplierName: "Synthetic Supplier Ltd",
    customerName: "Synthetic Customer Ltd",
    termType: "fixed",
    endDate: "2027-03-31",
    fee: "1250000",
    taxIncluded: "no",
  };
  data.tables.deliverables = [
    { item: "Synthetic design files", timing: "Within 30 days" },
    { item: "Synthetic handover", timing: "" },
  ];
  const full = compileForm(spec, text, data);
  assert.deepEqual(full.selectedClauses, ["termType=fixed", "taxIncluded=no"]);
  assert.deepEqual(full.unfilled, ["deliverables.timing"]);
  const out = printed(full);
  assert.match(out, /This record is between Synthetic Supplier Ltd and Synthetic Customer Ltd\./);
  assert.match(out, /The record runs until 31 Mar 2027\./);
  assert.doesNotMatch(out, /either side ends it|Choose a fixed/);
  assert.match(out, /The fee is ₦12,500\.00, before any tax\./);
  assert.match(out, /Synthetic second point for Synthetic Customer Ltd\./);
  assert.match(out, /Signed: \[ \]/);
  const table = full.blocks.find((b) => b.type === "table")!;
  assert.deepEqual(table.rows, [
    ["Deliverable", "Agreed timing"],
    ["Synthetic design files", "Within 30 days"],
    ["Synthetic handover", "[ ]"],
  ]);
  assert.deepEqual(
    full.blocks.filter((b) => b.type === "heading").map((b) => [b.text, b.type === "heading" ? b.level : 0]),
    [
      ["1. Parties", 2],
      ["2. Term", 2],
      ["3. Deliverables", 2],
      ["4. Fee", 2],
    ],
  );
  assert.ok(full.blocks.every((b, i) => b.id === `valo-guided-v2:TPL-13:${i + 1}`));
  // An answer not valid yet fills nothing: its placeholder stays and it is listed.
  const draft = compileForm(spec, text, { ...data, values: { ...data.values, endDate: "2027-02-30" } });
  assert.match(printed(draft), /The record runs until \[end date\]\./);
  assert.ok(draft.unfilled.includes("endDate"));
  // A blank is never filled, whatever is answered.
  const signing = compileForm(
    { ...spec, fields: [...spec.fields, { id: "signer", label: "Signer", type: "text", required: false }] },
    text,
    { ...data, values: { ...data.values, signer: "Synthetic Signer" } },
  );
  assert.doesNotMatch(printed(signing), /Synthetic Signer/);
});

test("a save is refused for answers the form does not take, and keeps answers that are not valid yet as a draft", () => {
  const data = emptyFormData(spec);
  assert.deepEqual(formAnswerIssues(spec, data).refused, []);
  const refused = (change: (d: typeof data) => void) => {
    const copy = structuredClone(data);
    change(copy);
    return formAnswerIssues(spec, copy).refused;
  };
  assert.match(refused((d) => (d.values.unknownQuestion = "x")).join(), /not a question of this form/);
  assert.match(refused((d) => (d.values.termType = "weekly")).join(), /Choose a listed option/);
  assert.match(refused((d) => (d.values.supplierName = "x".repeat(401))).join(), /Shorten this answer/);
  assert.match(refused((d) => (d.tables.other = [])).join(), /not a table of this form/);
  assert.match(
    refused(
      (d) => (d.tables.deliverables = Array.from({ length: 21 }, () => ({ item: "x", timing: "" }))),
    ).join(),
    /at most 20 rows/,
  );
  assert.match(
    refused((d) => (d.tables.deliverables = [{ item: "x", timing: "", extra: "y" }])).join(),
    /not a column/,
  );
  assert.match(refused((d) => (d.templateId = "TPL-14")).join(), /another form/);
  // Not valid yet: kept as a draft answer, named by its question.
  const drafts = formAnswerIssues(spec, {
    ...data,
    values: { ...data.values, termType: "fixed", endDate: "2027-02-30", fee: "12.50" },
  });
  assert.deepEqual(drafts.refused, []);
  assert.match(drafts.drafts.endDate!, /real date/);
  assert.match(drafts.drafts.fee!, /whole kobo/);
  assert.match(drafts.drafts.supplierName!, /required/);
});
