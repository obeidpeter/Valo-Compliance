import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { strFromU8, unzipSync } from "fflate";
import { printedPage, printedPageWords } from "@workspace/valo-core/printed-page";
import { headingRowSamples, printedPageSamples } from "@workspace/valo-core/printed-page-samples";
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
        // Each page's furniture is left out: the notice above it and its number below, a list's bullet
        // marks, which the PDF draws as text, and a table's heading row where it repeats at the top of
        // a page the table runs onto (slice 2). The page's words hold that row once.
        const notice = letters(page.notice);
        const furniture = (each: string) =>
          letters(each.replace(/Valo · \d+ \/ \d+/g, " ").replace(/•/g, " "));
        const headings = page.blocks.flatMap((block) =>
          block.type === "table" && block.headerRows === 1 ? [letters(block.rows[0]!.join(" "))] : [],
        );
        const pages = text.split("\f").filter((each) => each.trim());
        let read = "";
        for (const each of pages) {
          const rest = furniture(each).split(notice).join("");
          const repeated = headings.find((heading) => read.includes(heading) && rest.startsWith(heading));
          read += repeated ? rest.slice(repeated.length) : rest;
        }
        assert.equal(read, expected.split(notice).join(""), `the PDF of a document ${name}, ${mode}`);
        // The notice is on every page as well as above the title.
        assert.equal(
          furniture(text).split(notice).length - 1,
          pages.length + 1,
          `the PDF's notices, ${name}, ${mode}`,
        );
      }
  } finally {
    await rm(directory, { recursive: true, force: true });
    await closeRenderer();
  }
});

// EDT-006 (docs/architecture/editor.md, slice 2): a table that prints its first row as a heading row
// repeats it at the top of each page the table runs onto, in the PDF, and the Word file marks that
// row, and only that row, to repeat. A customer's table without the mark prints its first row once.
test("a table's heading row prints at the top of every page the table runs onto, and Word marks only that row to repeat, for each kind of table that has one", async () => {
  const directory = await mkdtemp(join(tmpdir(), "valo-heading-rows-"));
  try {
    for (const [name, sample, tableId, heading] of headingRowSamples()) {
      const page = printedPage(sample, 7);
      const table = page.blocks.find((block) => block.id === tableId);
      assert.ok(table?.type === "table" && table.rows.length === 41, `the 40-row table of ${name}`);
      assert.equal(table.headerRows === 1, heading, `the page marks the heading row of ${name}`);

      const xml = strFromU8(unzipSync(await renderDocument(sample, "docx", 7))["word/document.xml"]!);
      const tables = page.blocks.filter((block) => block.type === "table" && block.rows.length);
      const wordTables = xml
        .split("<w:tbl>")
        .slice(1)
        .map((each) => each.slice(0, each.indexOf("</w:tbl>")));
      assert.equal(wordTables.length, tables.length, `the Word tables of ${name}`);
      wordTables.forEach((each, index) => {
        const rows = each.split(/<w:tr[ >]/).slice(1);
        assert.deepEqual(
          rows.map((row) => row.includes("<w:tblHeader/>")),
          rows.map((_, row) => row === 0 && tables[index]!.headerRows === 1),
          `the Word rows marked to repeat in table ${index + 1} of ${name}`,
        );
      });

      const path = join(directory, "page.pdf");
      await writeFile(path, await renderDocument(sample, "pdf", 7));
      const text = (await promisify(execFile)("pdftotext", ["-raw", path, "-"], { maxBuffer: 1 << 24 }))
        .stdout;
      // Each page's text without its furniture: the notice above it and its number below.
      const notice = letters(page.notice);
      const pages = text
        .split("\f")
        .filter((each) => each.trim())
        .map((each) =>
          letters(each.replace(/Valo · \d+ \/ \d+/g, " "))
            .split(notice)
            .join(""),
        );
      const headingRow = letters(table.rows[0]!.join(" "));
      const bodyRows = table.rows.slice(1).map((row) => letters(row.join(" ")));
      const withRows = pages.flatMap((each, index) =>
        bodyRows.some((row) => each.includes(row)) ? [index] : [],
      );
      assert.ok(withRows.length >= 2, `the table of ${name} runs over several pages`);
      withRows.forEach((index, n) => {
        const each = pages[index]!;
        const first = Math.min(...bodyRows.map((row) => each.indexOf(row)).filter((at) => at >= 0));
        if (n === 0)
          assert.ok(each.slice(0, first).endsWith(headingRow), `the first row above the table of ${name}`);
        else
          assert.equal(
            each.slice(0, first),
            heading ? headingRow : "",
            `what page ${index + 1} of ${name} prints above the table's rows`,
          );
      });
      assert.equal(
        pages.join("").split(headingRow).length - 1,
        heading ? withRows.length : 1,
        `how many times the PDF of ${name} prints the first row`,
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
    await closeRenderer();
  }
});
