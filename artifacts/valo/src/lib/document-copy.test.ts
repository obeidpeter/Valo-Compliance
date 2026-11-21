import { test } from "node:test";
import assert from "node:assert/strict";
import type { CanonicalDocument } from "@workspace/api-client-react";
import { GUIDED_TEMPLATE_IDS } from "@workspace/valo-core/guided";
import {
  compileGuidedContent,
  emptyGuidedData,
  guidedContentConsistent,
  guidedDataFromBlocks,
} from "@workspace/valo-core/guided-runtime";
import { GUIDED_SPECS_V1 } from "@workspace/valo-core/guided-specs";
import { blankContent } from "./api";
import { anotherLike } from "./document-copy";

/** A document of this kind with every question answered by a synthetic value of the right shape. */
function answered(id: (typeof GUIDED_TEMPLATE_IDS)[number]) {
  const spec = GUIDED_SPECS_V1[id],
    data = emptyGuidedData(id);
  for (const field of spec.fields)
    data.values[field.id] =
      field.type === "date"
        ? "2026-11-18"
        : field.type === "select"
          ? (field.options?.[0]?.value ?? "")
          : field.type === "acknowledgement"
            ? "yes"
            : field.type === "money_kobo" || field.type === "integer" || field.type === "quantity"
              ? "150000"
              : `Synthetic ${field.id}`;
  return { spec, data, content: compileGuidedContent(data) as CanonicalDocument };
}

// EDT-005's acceptance: "never invent legal names, addresses or signatures".
test("a document made like another keeps every answer except its reference and its dates, which are left blank, and invents nothing", () => {
  for (const id of GUIDED_TEMPLATE_IDS) {
    const { spec, data, content } = answered(id);
    const copy = anotherLike(content);
    assert.ok(copy, id);
    // The copy is a document the server accepts as made from its own answers.
    assert.equal(guidedContentConsistent(copy), true, id);
    const answers = guidedDataFromBlocks(copy.blocks)!;
    let blank = 0;
    for (const field of spec.fields) {
      const fresh = field.type === "date" || field.id === "documentNumber";
      assert.equal(answers.values[field.id], fresh ? "" : data.values[field.id], `${id} ${field.id}`);
      if (fresh) blank += 1;
    }
    assert.ok(blank >= 1, `${id} leaves something to be given afresh`);
    assert.deepEqual(answers.tables, data.tables, id);
    // The details shown outside the questions follow the answers: the reference and dates are blank.
    assert.equal(copy.fields.documentNumber, "", id);
    assert.equal(copy.fields.issueDate, "", id);
    assert.equal(copy.fields.dueDate, "", id);
    assert.equal(copy.fields.notes, content.fields.notes, id);
    assert.deepEqual(copy.formatting, content.formatting, id);
  }
});

test("a blank document's copy keeps its text, its amounts and who it is from and to, with its reference and dates left blank", () => {
  const content = blankContent();
  content.fields = {
    issuerName: "Synthetic Trading",
    recipientName: "Synthetic Customer",
    documentNumber: "S-1",
    issueDate: "2026-11-18",
    dueDate: "2026-12-02",
    notes: "Synthetic note.",
  };
  content.blocks = [{ id: "b1", type: "paragraph", text: "Synthetic text.", rows: [] }];
  content.formatting = { font: "sans", accent: "charcoal" };
  const copy = anotherLike(content);
  assert.deepEqual(copy, {
    ...content,
    fields: { ...content.fields, documentNumber: "", issueDate: "", dueDate: "" },
  });
  // The saved document is not touched.
  assert.equal(content.fields.documentNumber, "S-1");
});

test("no copy is offered of a document whose saved questions cannot be read", () => {
  const { content } = answered("TPL-01");
  const altered = structuredClone(content);
  altered.blocks = altered.blocks.filter((block) => !block.id.endsWith(":field:issuerName"));
  assert.equal(anotherLike(altered), null);
});
