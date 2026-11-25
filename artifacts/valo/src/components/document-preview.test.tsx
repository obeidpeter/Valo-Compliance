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
import { finishedFileState } from "@/lib/api";
import { formatDocumentPlainText } from "@/lib/guided-prefill";
import { DocPreview } from "./document-preview";

// EDT-002 (docs/architecture/editor.md, slice 1): the editor's preview and "Copy text" say what the
// document's files say, from the same printed page.
const decoded = (html: string) =>
  html
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
