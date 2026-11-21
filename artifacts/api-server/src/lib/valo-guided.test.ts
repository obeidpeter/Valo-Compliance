import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { GUIDED_TEMPLATE_IDS } from "@workspace/valo-core/guided";
import { GUIDED_SPECS_V1 } from "@workspace/valo-core/guided-specs";
import {
  compileGuidedContent,
  emptyGuidedData,
  guidedDataFromBlocks,
  guidedDataIssues,
  guidedContentConsistent,
  guidedRenderableBlocks,
  GUIDED_PREFIX,
} from "@workspace/valo-core/guided-runtime";
import { completeGuidedTestData } from "./valo-guided-test-fixtures";
import { documentInput } from "./valo-validation";
import { serializeRevisionV1 } from "../modules/documents/valo-revision-codec";
import { renderDocument, DRAFT_NOTICE, controlledHtml } from "./valo-render";

test("all twelve bound question models survive parser and frozen-codec JSONB reconstruction", async (t) => {
  assert.equal(GUIDED_TEMPLATE_IDS.length, 12);
  for (const id of GUIDED_TEMPLATE_IDS)
    await t.test(id, () => {
      const data = completeGuidedTestData(id),
        content = compileGuidedContent(data);
      assert.deepEqual(guidedDataIssues(GUIDED_SPECS_V1[id], data), {});
      assert.deepEqual(guidedDataFromBlocks(content.blocks), data);
      assert.equal(guidedContentConsistent(content), true);
      const input = documentInput.parse({ title: `Synthetic ${id}`, content });
      function jsonb(value: unknown): unknown {
        if (Array.isArray(value)) return value.map(jsonb);
        if (value && typeof value === "object")
          return Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, v]) => [k, jsonb(v)]),
          );
        return value;
      }
      assert.equal(serializeRevisionV1(input), serializeRevisionV1(documentInput.parse(jsonb(input))));
      const incomplete = emptyGuidedData(id);
      assert(Object.keys(guidedDataIssues(GUIDED_SPECS_V1[id], incomplete)).length > 0);
      // Raw incomplete answers are a saved draft, not automatically discarded.
      assert(
        documentInput.safeParse({ title: "Synthetic incomplete", content: compileGuidedContent(incomplete) })
          .success,
      );
    });
});

test("all twelve actual DOCX/PDF renders contain supplied answers, not internal question IDs", async (t) => {
  const dir = fileURLToPath(new URL("../../../../generated-artifacts/valo-guided/", import.meta.url));
  await mkdir(dir, { recursive: true });
  for (const id of GUIDED_TEMPLATE_IDS)
    await t.test(id, async () => {
      const content = compileGuidedContent(completeGuidedTestData(id)),
        input = { title: `Synthetic ${id}`, content };
      for (const format of ["docx", "pdf"] as const) {
        const buffer = await renderDocument(input, format, 1);
        const path = `${dir}${id}.${format}`;
        await writeFile(path, buffer);
        const extracted =
          format === "docx"
            ? spawnSync("unzip", ["-p", path, "word/document.xml"], { encoding: "utf8" })
            : spawnSync("pdftotext", ["-layout", path, "-"], { encoding: "utf8" });
        assert.equal(extracted.status, 0, `${id} ${format} must open in the mechanical reader`);
        assert(extracted.stdout.includes("Synthetic issuerName"));
        assert(extracted.stdout.includes("INCOMPLETE BUSINESS DRAFT"));
        assert(!extracted.stdout.includes(GUIDED_PREFIX));
        if (
          ["TPL-01", "TPL-02", "TPL-03", "TPL-04", "TPL-12", "TPL-13", "TPL-14", "TPL-16", "TPL-17"].includes(
            id,
          )
        )
          assert(extracted.stdout.includes("₦"), `${id} ${format} must preserve the naira glyph`);
        assert(buffer.length > 500);
      }
    });
});

test("invalid dates, units and money remain raw draft answers and never become complete", () => {
  const data = completeGuidedTestData("TPL-01");
  data.values.issueDate = "2026-02-30";
  data.values.dueDate = "2025-01-01";
  data.tables.items![0]!.unit = "invented_unit";
  data.tables.items![0]!.unitPriceKobo = "12.50";
  const content = compileGuidedContent(data),
    read = guidedDataFromBlocks(content.blocks)!;
  assert.equal(read.values.issueDate, "2026-02-30");
  assert.equal(read.tables.items![0]!.unitPriceKobo, "12.50");
  const issues = guidedDataIssues(GUIDED_SPECS_V1["TPL-01"], read);
  assert(issues.issueDate);
  assert(issues["items:0:unit"]);
  assert(issues["items:0:unitPriceKobo"]);
  assert(documentInput.safeParse({ title: "Synthetic invalid but saved draft", content }).success);
  assert(controlledHtml({ title: "Synthetic incomplete", content }, 1).includes(DRAFT_NOTICE));
});

test("agreement parties and negotiated terms cannot be omitted from completion", () => {
  for (const id of ["TPL-13", "TPL-14", "TPL-15", "TPL-16", "TPL-17"] as const) {
    const data = completeGuidedTestData(id);
    data.values.issuerName = "";
    data.values.recipientName = "[Legal name]";
    const issues = guidedDataIssues(GUIDED_SPECS_V1[id], data);
    assert(issues.issuerName);
    assert(issues.recipientName);
  }
});

test("hidden probation/end answers are retained but never rendered as selected terms", () => {
  const data = completeGuidedTestData("TPL-16");
  data.values.probation = "no";
  data.values.probationTerms = "PRIVATE-HIDDEN-PROBATION";
  data.values.termType = "open";
  data.values.endDate = "INVALID-HIDDEN-END-DATE";
  const content = compileGuidedContent(data);
  assert.deepEqual(guidedDataIssues(GUIDED_SPECS_V1["TPL-16"], data), {});
  assert.equal(guidedDataFromBlocks(content.blocks)!.values.probationTerms, "PRIVATE-HIDDEN-PROBATION");
  const visible = JSON.stringify(guidedRenderableBlocks(content));
  assert(!visible.includes("PRIVATE-HIDDEN-PROBATION"));
  assert(!visible.includes("INVALID-HIDDEN-END-DATE"));
});

test("unknown allocation is not zero and duplicate payment references prevent completion", () => {
  const data = completeGuidedTestData("TPL-12");
  data.values.paymentsKnown = "unknown";
  assert(guidedDataIssues(GUIDED_SPECS_V1["TPL-12"], data).paymentsKnown);
  data.values.paymentsKnown = "listed";
  data.tables.payments = [
    { reference: "same", amountKobo: "100" },
    { reference: "SAME", amountKobo: "100" },
  ];
  assert(guidedDataIssues(GUIDED_SPECS_V1["TPL-12"], data).calculation);
});

test("arithmetic, required-question deletion and unknown layouts fail server validation", () => {
  const content = compileGuidedContent(completeGuidedTestData("TPL-01"));
  const tampered = structuredClone(content);
  const totals = tampered.blocks.find((b) => b.id.includes(":calc:financial-summary"))!;
  totals.rows[totals.rows.length - 1]![1] = "₦0.01";
  assert(!documentInput.safeParse({ title: "Synthetic tamper", content: tampered }).success);
  const removed = { ...content, blocks: content.blocks.filter((b) => !b.id.endsWith(":field:issuerName")) };
  assert(!documentInput.safeParse({ title: "Synthetic removal", content: removed }).success);
  const unknown = structuredClone(content);
  unknown.blocks[0]!.id = unknown.blocks[0]!.id.replace("TPL-01", "TPL-99");
  assert(!documentInput.safeParse({ title: "Synthetic unsupported", content: unknown }).success);
});

test("forty rows, long names and decimal-safe half-up arithmetic use actual supplied quantities", () => {
  const data = completeGuidedTestData("TPL-01");
  data.values.issuerName = "Synthetic long business name ".repeat(5).slice(0, 155);
  data.tables.items = Array.from({ length: 40 }, (_, i) => ({
    description: `Synthetic item ${i}`,
    quantity: "0.5",
    unit: "kg",
    otherUnit: "",
    unitPriceKobo: "1",
  }));
  const content = compileGuidedContent(data);
  assert.deepEqual(guidedDataIssues(GUIDED_SPECS_V1["TPL-01"], data), {});
  const summary = content.blocks.find((b) => b.id.includes(":calc:financial-summary"))!;
  assert.equal(summary.rows.at(-1)![1], "₦0.40");
  assert(documentInput.safeParse({ title: "Synthetic long table", content }).success);
});

test("recalculation preserves manually positioned sections without retaining tampered totals", () => {
  const data = completeGuidedTestData("TPL-01"),
    content = compileGuidedContent(data);
  const tail = { id: "own-tail", type: "paragraph" as const, text: "Synthetic after totals", rows: [] };
  content.blocks.push(tail);
  data.tables.items![0]!.quantity = "3";
  const next = compileGuidedContent(data, content);
  assert.equal(next.blocks.at(-1)?.id, tail.id);
  assert.equal(guidedContentConsistent(next), true);
  assert(
    next.blocks
      .find((b) => b.id.includes(":calc:financial-summary"))!
      .rows.at(-1)![1]!
      .includes("300.00"),
  );
});

// The questions' definitions name the unit an answer is stored in ("Agreed fee in whole kobo"). A
// document names the question and prints the amount with the naira sign.
test("a document prints each amount in naira under its question's name, and never the unit the answer is stored in", () => {
  const named = (label: string) => label.replace(/,? in whole kobo/, "");
  const naira = /^₦\d{1,3}(,\d{3})*\.\d{2}$/;
  /** What a reader sees: each paragraph's or list's text, and each table's cells. */
  const read = (blocks: ReturnType<typeof guidedRenderableBlocks>) =>
    JSON.stringify(blocks.map((b) => (b.type === "table" ? b.rows : b.text)));
  let amounts = 0;
  for (const id of GUIDED_TEMPLATE_IDS) {
    const spec = GUIDED_SPECS_V1[id],
      printed = guidedRenderableBlocks(compileGuidedContent(completeGuidedTestData(id)));
    for (const field of spec.fields.filter((f) => f.type === "money_kobo")) {
      const block = printed.find((b) => b.id.endsWith(":field:" + field.id));
      if (!block) continue; // Not asked, given the fixture's other answers.
      amounts += 1;
      const [label, value] = block.text.split("\n");
      assert.equal(label, named(field.label), `${id} ${field.id}`);
      assert.notEqual(label, field.label, `${id} ${field.id}`);
      assert.match(value!, naira, `${id} ${field.id}`);
    }
    assert.doesNotMatch(read(printed), /kobo/i, id);
  }
  assert.ok(amounts >= 6, `${amounts} amounts were printed`);

  // A table of the questions' own: its money column is named without the unit, and each amount
  // in it carries the naira sign.
  const reminder = completeGuidedTestData("TPL-12");
  reminder.values.paymentsKnown = "listed";
  reminder.tables.payments = [
    { reference: "SYNTHETIC-1", amountKobo: "150050" },
    { reference: "SYNTHETIC-2", amountKobo: "5" },
  ];
  assert.deepEqual(guidedDataIssues(GUIDED_SPECS_V1["TPL-12"], reminder), {});
  const payments = guidedRenderableBlocks(compileGuidedContent(reminder)).find((b) =>
    b.id.endsWith(":table:payments"),
  )!;
  assert.deepEqual(payments.rows, [
    ["Allocation reference", "Allocated amount"],
    ["SYNTHETIC-1", "₦1,500.50"],
    ["SYNTHETIC-2", "₦0.05"],
  ]);

  // An invoice with one price that is not an amount has no calculated table, so its questions'
  // own table is printed: the column is still named without the unit, and what was typed is shown.
  const data = completeGuidedTestData("TPL-01");
  data.tables.items![0]!.unitPriceKobo = "12.5x";
  const items = guidedRenderableBlocks(compileGuidedContent(data)).find((b) =>
    b.id.endsWith(":table:items"),
  )!;
  assert.ok(items.rows[0]!.includes("Unit price, for the chosen quantity unit"), items.rows[0]!.join(" | "));
  assert.ok(items.rows[1]!.includes("12.5x"));
  assert.doesNotMatch(JSON.stringify(items.rows), /kobo/i);
});
