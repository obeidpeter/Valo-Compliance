import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { printedPage, printedPageWords } from "@workspace/valo-core/printed-page";
import { everyPrintedDocument } from "../test-support/guided-template-documents";
import { renderDocument } from "./valo-render";

// EDT-006 (docs/architecture/editor.md, slice 3): a second program opens each Word file. LibreOffice
// opens every guided template's Word file, made from its questions and from its v2 form, and the
// printed page's synthetic documents, and prints each to PDF. The text it prints is the page's, word
// for word. LibreOffice is not Word: opening a file in Word stays a manual check for the owner.

const run = promisify(execFile);
/** A text's letters in order, without spaces or colons, which the programs lay out differently. */
const letters = (text: string) => text.replace(/[\s:]/g, "");

test(
  "LibreOffice opens every guided template's Word file and prints the page's text word for word, with the notice on every page and a table's heading row on every page it runs onto",
  { timeout: 900_000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "valo-libreoffice-"));
    try {
      const documents = await everyPrintedDocument();
      const files: { name: string; document: (typeof documents)[number][1]; file: string }[] = [];
      for (const [index, [name, document]] of documents.entries()) {
        const file = join(directory, `document-${index}.docx`);
        await writeFile(file, await renderDocument(document, "docx", 7));
        files.push({ name, document, file });
      }
      await run(
        "soffice",
        [
          `-env:UserInstallation=${pathToFileURL(join(directory, "profile")).href}`,
          "--headless",
          "--norestore",
          "--convert-to",
          "pdf",
          "--outdir",
          directory,
          ...files.map(({ file }) => file),
        ],
        { timeout: 840_000, maxBuffer: 1 << 24 },
      );
      for (const { name, document, file } of files) {
        const page = printedPage(document, 7);
        const text = (
          await run("pdftotext", ["-raw", file.replace(/\.docx$/, ".pdf"), "-"], { maxBuffer: 1 << 24 })
        ).stdout;
        // Each page's furniture is left out: the notice in its header and its number in its footer, a
        // list's bullet marks, and a table's heading row where it repeats at the top of a page.
        const notice = letters(page.notice);
        const headings = page.blocks.flatMap((block) =>
          block.type === "table" && block.headerRows === 1 ? [letters(block.rows[0]!.join(" "))] : [],
        );
        const pages = text.split("\f").filter((each) => each.trim());
        let read = "";
        for (const each of pages) {
          const rest = letters(each.replace(/Valo · Page \d+/g, " ").replace(/[●•◦▪]/g, " "))
            .split(notice)
            .join("");
          // Only the heading row of the table the page goes on with, the last one begun.
          const going = headings
            .filter((heading) => read.includes(heading))
            .sort((x, y) => read.lastIndexOf(y) - read.lastIndexOf(x))[0];
          read += going && rest.startsWith(going) ? rest.slice(going.length) : rest;
        }
        assert.equal(
          read,
          letters(printedPageWords(page).join(" ")).split(notice).join(""),
          `the Word file of ${name}, as LibreOffice prints it`,
        );
        // The notice is in the header of every page, as well as above the title.
        assert.equal(letters(text).split(notice).length - 1, pages.length + 1, `the notices of ${name}`);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
