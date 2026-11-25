import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { strFromU8, unzipSync } from "fflate";
import { printedPage, printedPageWords } from "@workspace/valo-core/printed-page";
import { printedPageSamples } from "@workspace/valo-core/printed-page-samples";
import { closeRenderer, renderDocument } from "./valo-render";

// EDT-002 (docs/architecture/editor.md, slice 1): a document's Word file and its PDF print, word for
// word, the page its editor's preview prints, from one description of it. The preview's own test
// compares the preview with the same description.

/** A text's letters in order, without spaces or colons, which the files lay out differently. */
const letters = (text: string) => text.replace(/[\s:]/g, "");
/** The text of a Word file's document part, in order. */
const wordText = (xml: string) =>
  xml
    .replace(/<w:br\/>|<\/w:p>|<w:tab\/>/g, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

test("a document's Word file and PDF print its page word for word, for each kind of document, as a draft and as a finished file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "valo-printed-page-"));
  try {
    for (const [name, sample] of printedPageSamples())
      for (const mode of ["business_draft", "business_finished"] as const) {
        const page = printedPage(sample, 7, mode);
        const expected = letters(printedPageWords(page).join(" "));
        const docx = unzipSync(await renderDocument(sample, "docx", 7, mode));
        assert.equal(
          letters(wordText(strFromU8(docx["word/document.xml"]!))),
          expected,
          `the Word file of a document ${name}, ${mode}`,
        );
        const path = join(directory, "page.pdf");
        await writeFile(path, await renderDocument(sample, "pdf", 7, mode));
        const text = (await promisify(execFile)("pdftotext", ["-raw", path, "-"], { maxBuffer: 1 << 24 }))
          .stdout;
        // Each page's furniture is left out: the notice above it and its number below, and a list's
        // bullet marks, which the PDF draws as text.
        const notice = letters(page.notice);
        const printed = letters(text.replace(/Valo · \d+ \/ \d+/g, " ").replace(/•/g, " "));
        assert.equal(
          printed.split(notice).join(""),
          expected.split(notice).join(""),
          `the PDF of a document ${name}, ${mode}`,
        );
        // The notice is on every page as well as above the title.
        const pages = text.split("\f").filter((each) => each.trim()).length;
        assert.equal(printed.split(notice).length - 1, pages + 1, `the PDF's notices, ${name}, ${mode}`);
      }
  } finally {
    await rm(directory, { recursive: true, force: true });
    await closeRenderer();
  }
});
