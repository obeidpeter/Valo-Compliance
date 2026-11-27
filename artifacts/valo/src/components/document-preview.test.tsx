import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { CanonicalDocument } from "@workspace/api-client-react";
import {
  DRAFT_NOTICE,
  FINISHED_NOTICE,
  NOT_SUPPLIED,
  printedPage,
  printedPageText,
  printedPageWords,
} from "@workspace/valo-core/printed-page";
import {
  headingRowSamples,
  printedPageSamples,
  questionsSample,
  typedSample,
} from "@workspace/valo-core/printed-page-samples";
import { parseFormText } from "@workspace/valo-core/form-text";
import { emptyFormData, formDocumentContent } from "@workspace/valo-core/guided-runtime-v2";
import { GUIDED_SPECS_V2 } from "@workspace/valo-core/guided-specs-v2";
import { finishedFileState } from "@/lib/api";
import { formatDocumentPlainText } from "@/lib/guided-prefill";
import { DocPreview } from "./document-preview";

// EDT-002 (docs/architecture/editor.md, slice 1): the editor's preview and "Copy text" say what the
// document's files say, from the same printed page.
const decoded = (html: string) =>
  html
    // What the preview adds to mark the page (slice 4) is not the page's: the files print none of it.
    .replace(/<p[^>]*data-preview-mark[^>]*>[\s\S]*?<\/p>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&");
/** A text's letters in order, without spaces or colons, which the page and its views lay out
 * differently. */
const letters = (text: string) => text.replace(/[\s:]/g, "");
const pageOf = (sample: { title: string; content: unknown }, revision: number) => {
  const content = sample.content as CanonicalDocument;
  const mode = finishedFileState(content) === "complete" ? "business_finished" : "business_draft";
  return printedPage({ title: sample.title, content }, revision, mode);
};

test("the editor's preview prints the page its Word file and PDF print, word for word, for each kind of document", () => {
  for (const [name, sample] of printedPageSamples()) {
    const shown = renderToStaticMarkup(
      <DocPreview title={sample.title} content={sample.content as CanonicalDocument} revision={7} />,
    );
    assert.equal(
      letters(decoded(shown)),
      letters(printedPageWords(pageOf(sample, 7)).join(" ")),
      `the preview of a document ${name}`,
    );
  }
  // The preview carries the notice its file would: a complete document's finished notice, and the
  // draft notice otherwise. A field left empty reads as in the files, and the line under the title is
  // the file's.
  const typed = renderToStaticMarkup(
    <DocPreview
      title={typedSample().title}
      content={typedSample().content as CanonicalDocument}
      revision={7}
    />,
  );
  assert.ok(decoded(typed).includes(DRAFT_NOTICE));
  assert.ok(decoded(typed).includes(NOT_SUPPLIED));
  assert.ok(decoded(typed).includes("Valo · Saved version 7"));
  assert.doesNotMatch(decoded(typed), /Missing|Empty paragraph|your own document, not reviewed/);
  const invoice = questionsSample(2);
  assert.ok(
    decoded(
      renderToStaticMarkup(
        <DocPreview title={invoice.title} content={invoice.content as CanonicalDocument} revision={3} />,
      ),
    ).includes(FINISHED_NOTICE),
  );
  // A list prints no blank line.
  assert.equal(
    (typed.match(/<li>/g) ?? []).length,
    2,
    "the list's two items, without the blank line between them",
  );
});

test('"Copy text" is the page as plain text: the notice, the title and its version, the details, then the document', () => {
  for (const [name, sample] of printedPageSamples())
    assert.equal(
      formatDocumentPlainText(sample.title, sample.content as CanonicalDocument, 7),
      printedPageText(pageOf(sample, 7)),
      `"Copy text" of a document ${name}`,
    );
  const lines = formatDocumentPlainText(
    typedSample().title,
    typedSample().content as CanonicalDocument,
    7,
  ).split("\n");
  assert.equal(lines[0], DRAFT_NOTICE);
  assert.ok(lines.includes("Due date: [Not supplied]"));
  assert.ok(lines.includes("- First synthetic item"));
  assert.ok(lines.includes("Synthetic chairs | 4 | ₦6,000.00"));
  // A document made from questions lists its answers in its text, and none of the details twice.
  const invoice = questionsSample(1);
  const copied = formatDocumentPlainText(invoice.title, invoice.content as CanonicalDocument, 1);
  assert.doesNotMatch(copied, /^Issued by:/m);
  assert.match(copied, /^Notes: /m);
});

// EDT-006 (docs/architecture/editor.md, slice 2): the preview shows a table's heading row as the files
// print it, as column headings, for each kind of table that has one.
test("the preview prints a table's heading row as its column headings, for each kind of table that has one, and a table without the mark as rows", () => {
  for (const [name, sample, tableId, heading] of headingRowSamples(3)) {
    const page = pageOf(sample, 7);
    const index = page.blocks.findIndex((block) => block.id === tableId);
    const html = renderToStaticMarkup(
      <DocPreview title={sample.title} content={sample.content as CanonicalDocument} revision={7} />,
    );
    const start = html.indexOf(`aria-label="Document table ${index + 1}"`);
    assert.ok(index >= 0 && start >= 0, `the table of ${name}`);
    const shown = html.slice(start, html.indexOf("</table>", start));
    const columns = [...shown.matchAll(/<th scope="col"[^>]*>([^<]*)<\/th>/g)].map((match) =>
      decoded(match[1]!),
    );
    assert.deepEqual(columns, heading ? page.blocks[index]!.rows[0] : [], `the column headings of ${name}`);
    assert.equal(shown.includes("<thead>"), heading, `the heading row of ${name}`);
  }
});

// EDT-003 (docs/architecture/editor.md, slice 4): the preview shows what is fixed and what is the
// customer's: the answers inside a form's wording, the blocks made from questions, and the notice.
const SYNTHETIC_FORM_TEXT = parseFormText(
  [
    "# Synthetic invoice",
    "",
    "From [Seller name]{=issuerName} to [Buyer name]{=recipientName}.",
    "",
    "Address: [Seller contact/address]{=issuerAddress}",
  ].join("\n"),
);
test("the preview marks a form's answers inside its wording, the blocks made from questions and the notice, and nothing in a customer's own text", () => {
  const spec = GUIDED_SPECS_V2["TPL-01"]!;
  const answers = emptyFormData(spec);
  answers.values = {
    ...answers.values,
    issuerName: "Synthetic Supplies Ltd",
    recipientName: "Synthetic Buyer Ltd",
  };
  const { unfilled: _unfilled, ...content } = formDocumentContent(spec, SYNTHETIC_FORM_TEXT, answers);
  const form = renderToStaticMarkup(
    <DocPreview
      title="Synthetic invoice"
      content={content as CanonicalDocument}
      revision={2}
      formText={SYNTHETIC_FORM_TEXT}
    />,
  );
  const marked = [...form.matchAll(/<mark[^>]*data-testid="preview-answer"[^>]*>([^<]*)<\/mark>/g)].map((m) =>
    decoded(m[1]!).trim(),
  );
  assert.deepEqual(marked, ["Synthetic Supplies Ltd", "Synthetic Buyer Ltd"], "only the answers are marked");
  assert.ok(decoded(form).includes("[Seller contact/address]"), "an unanswered slot keeps its placeholder");
  assert.equal(
    letters(decoded(form)),
    letters(printedPageWords(pageOf({ title: "Synthetic invoice", content }, 2)).join(" ")),
    "the marks add no word to the page",
  );
  assert.match(
    form,
    /data-testid="preview-notice-mark"[^>]*>Added by Valo to every page of the file\. It cannot be removed\.</,
  );
  assert.doesNotMatch(form, /From your answers/);
  // Without its wording the preview marks nothing inside it, and prints the same page.
  const unmarked = renderToStaticMarkup(
    <DocPreview title="Synthetic invoice" content={content as CanonicalDocument} revision={2} />,
  );
  assert.doesNotMatch(unmarked, /preview-answer/);
  assert.equal(letters(decoded(unmarked)), letters(decoded(form)));

  // A document made from questions marks the blocks its questions make, once for each run of them.
  const questions = renderToStaticMarkup(
    <DocPreview
      title={questionsSample(3).title}
      content={questionsSample(3).content as CanonicalDocument}
      revision={2}
    />,
  );
  const page = pageOf(questionsSample(3), 2);
  assert.equal(
    (questions.match(/data-testid="preview-from-answers"/g) ?? []).length,
    page.blocks.filter((block) => block.id.startsWith("valo-guided-v1:")).length,
  );
  assert.equal((questions.match(/>From your answers</g) ?? []).length, 1);
  // A document typed by hand is all the customer's own: only the notice is marked.
  const typed = renderToStaticMarkup(
    <DocPreview
      title={typedSample().title}
      content={typedSample().content as CanonicalDocument}
      revision={2}
    />,
  );
  assert.doesNotMatch(typed, /preview-answer|preview-from-answers|From your answers/);
  assert.match(typed, /data-testid="preview-notice-mark"/);
});
