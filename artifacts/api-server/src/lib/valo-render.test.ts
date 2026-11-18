import test from "node:test";
import assert from "node:assert/strict";
import { unzipSync, strFromU8 } from "fflate";
import { compileGuidedContent } from "@workspace/valo-core/guided-runtime";
import { controlledHtml, renderDocument, DRAFT_NOTICE, PURCHASE_NOTICE } from "./valo-render";
import { syntheticDocument } from "./valo-test-fixtures";
import { completeGuidedTestData } from "./valo-guided-test-fixtures";
import { readerContainsText } from "./valo-reader-checks";

test("reader comparison tolerates extraction spacing, never changed parties, currency or money", () => {
  assert.equal(readerContainsText("Fictional BusinessA", "Fictional Business A"), true);
  assert.equal(readerContainsText("Fictional BusinessB", "Fictional Business A"), false);
  assert.equal(readerContainsText("₦37,000.00", "₦37,001.00"), false);
  assert.equal(readerContainsText("$37,000.00", "₦37,000.00"), false);
  assert.equal(readerContainsText("anything", " "), false);
});

test("controlled HTML treats markup, local-file and metadata addresses as inert text", () => {
  const input = structuredClone(syntheticDocument);
  input.title = '<script>alert("x")</script>';
  input.content.blocks[0]!.text =
    '<img src="http://169.254.169.254/">file:///etc/passwd<script>fetch("https://example.com")</script>';
  const html = controlledHtml(input, 7);
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes("<img"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("default-src 'none'"));
  assert.ok(html.includes("Saved revision 7"));
  assert.ok(html.includes(DRAFT_NOTICE));
});
test("DOCX contains editable OOXML, actual table cells, bullets, draft notice and naira", async () => {
  const input = structuredClone(syntheticDocument);
  input.content.fields.issuerName = "Synthetic ₦ business";
  input.content.blocks.push(
    {
      id: "t",
      type: "table",
      text: "",
      rows: [
        ["Description", "Amount"],
        ["Synthetic item", "₦12,345.67"],
      ],
    },
    { id: "l", type: "list", text: "First action\nSecond action", rows: [] },
  );
  const bytes = await renderDocument(input, "docx", 3);
  assert.equal(bytes.subarray(0, 2).toString(), "PK");
  const parts = unzipSync(bytes);
  const xml = strFromU8(parts["word/document.xml"]!);
  assert.ok(xml.includes("₦12,345.67"));
  assert.ok(xml.includes("<w:tbl>"));
  assert.ok(xml.includes("First action"));
  assert.ok(xml.includes("Saved revision 3"));
  assert.ok(Object.keys(parts).some((name) => name.startsWith("word/header")));
});
test("renderer rejects unknown formatting, arbitrary clause inputs and invalid dates", async () => {
  const invalid = structuredClone(syntheticDocument);
  (invalid.content.formatting as { font: string }).font = "url(http://169.254.169.254)";
  await assert.rejects(() => renderDocument(invalid, "docx", 1));
  const clauses = structuredClone(syntheticDocument);
  (clauses.content.selectedClauses as string[]).push("unreleased-contract-clause");
  await assert.rejects(() => renderDocument(clauses, "docx", 1));
  const dates = structuredClone(syntheticDocument);
  dates.content.fields.issueDate = "2026-02-31";
  await assert.rejects(() => renderDocument(dates, "docx", 1));
});

test("PDFs share one browser, render in isolated contexts and never exceed five at once", async () => {
  const { rendererStatistics, closeRenderer } = await import("./valo-render");
  const { execFile } = await import("node:child_process");
  const { mkdtemp, rm, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { promisify } = await import("node:util");
  await closeRenderer();
  const before = rendererStatistics();
  const inputs = Array.from({ length: 7 }, (_, i) => {
    const input = structuredClone(syntheticDocument);
    input.content.blocks[0]!.text = `Parallel render marker ${i}`;
    return input;
  });
  const files = await Promise.all(inputs.map((input) => renderDocument(input, "pdf", 1)));
  const directory = await mkdtemp(join(tmpdir(), "valo-render-parallel-"));
  try {
    for (const [i, file] of files.entries()) {
      assert.equal(Buffer.from(file).subarray(0, 5).toString(), "%PDF-");
      const path = join(directory, `${i}.pdf`);
      await writeFile(path, file);
      const text = (await promisify(execFile)("pdftotext", ["-raw", path, "-"])).stdout;
      for (let j = 0; j < files.length; j++)
        assert.equal(
          text.includes(`Parallel render marker ${j}`),
          i === j,
          `render ${i} contains marker ${j}`,
        );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  const after = rendererStatistics();
  assert.equal(after.launches - before.launches, 1, "one browser served every render");
  assert.ok(after.peakParallel <= 5, `peak ${after.peakParallel}`);
  await closeRenderer();
});

test("no PDF line is cut in two at a page break", async () => {
  // Chromium prints the part of a line that crosses a page's content edge again at the top of
  // the next page, as a sliver of glyphs a reader extracts as text. With the font's own line
  // height this happened at some breaks (TPL-22 among the operational forms). Each document here
  // starts with one more short paragraph, so its page breaks fall somewhere else in its lines.
  const { closeRenderer } = await import("./valo-render");
  const { execFile } = await import("node:child_process");
  const { mkdtemp, rm, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { promisify } = await import("node:util");
  const contentTop = (25 / 25.4) * 72; // the 25 mm top margin, in points
  const text =
    "Agreed quarterly payments [gross, in naira] apply by typed request; any query goes to the supplying party in writing.";
  const directory = await mkdtemp(join(tmpdir(), "valo-render-breaks-"));
  const cut: string[] = [];
  try {
    for (let extra = 0; extra < 20; extra++) {
      const input = structuredClone(syntheticDocument);
      input.content.blocks = Array.from({ length: 70 + extra }, (_, i) => ({
        id: `section-${i + 1}`,
        type: "paragraph" as const,
        text:
          i < extra
            ? "Short line."
            : [text, `${text} ${text}`, "Signed for the supplying party [typed]."][i % 3]!,
        rows: [],
      }));
      const path = join(directory, `${extra}.pdf`);
      await writeFile(path, await renderDocument(input, "pdf", 1));
      const layout = (
        await promisify(execFile)("pdftotext", ["-bbox-layout", path, "-"], { maxBuffer: 1 << 24 })
      ).stdout;
      for (const [index, page] of layout.split("<page ").slice(1).entries())
        for (const word of page.matchAll(
          /<word xMin="[\d.]+" yMin="([\d.]+)" xMax="[\d.]+" yMax="([\d.]+)">([^<]*)</g,
        ))
          if (Number(word[1]) < contentTop - 0.5 && Number(word[2]) > contentTop - 0.5)
            cut.push(`document ${extra}, page ${index + 1}: "${word[3]}"`);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
    await closeRenderer();
  }
  assert.deepEqual(cut, [], "lines cut at a page break");
});

// PAY-009: "a generated business invoice is never confused with proof of payment or an official
// government tax invoice."
test("every page of a generated invoice and of a purchase receipt says it is not proof of payment or a government tax invoice", async () => {
  const { closeRenderer } = await import("./valo-render");
  const { execFile } = await import("node:child_process");
  const { mkdtemp, rm, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { promisify } = await import("node:util");
  assert.match(
    DRAFT_NOTICE,
    /^INCOMPLETE BUSINESS DRAFT .* Not verified payment proof, a government tax invoice,/,
  );
  assert.match(
    PURCHASE_NOTICE,
    /^VALO DEVELOPMENT PURCHASE RECEIPT .* Not proof of delivery, bank outcome, a government tax invoice/,
  );
  const words = (text: string) => text.replace(/\s+/g, " ").trim();
  // The invoice template (TPL-01) with its 40 line items, the most it takes, so it runs over pages.
  const data = completeGuidedTestData("TPL-01");
  data.tables.items = Array.from({ length: 40 }, (_, i) => ({
    ...data.tables.items![0]!,
    description: `Synthetic line item ${i + 1}, described at length so the invoice runs over several pages`,
  }));
  const invoice = { title: "Synthetic invoice", content: compileGuidedContent(data) };
  const receipt = { title: "Synthetic purchase receipt", content: syntheticDocument.content };
  const directory = await mkdtemp(join(tmpdir(), "valo-render-notices-"));
  try {
    for (const [name, input, mode, notice] of [
      ["invoice", invoice, "business_draft", DRAFT_NOTICE],
      ["receipt", receipt, "purchase_receipt", PURCHASE_NOTICE],
    ] as const) {
      // The DOCX starts with the notice and repeats it in the header every page carries.
      const parts = unzipSync(await renderDocument(input, "docx", 1, mode));
      const headers = Object.keys(parts).filter((part) => /^word\/header\d*\.xml$/.test(part));
      assert.ok(headers.length > 0, `${name} DOCX has a page header`);
      for (const part of ["word/document.xml", ...headers])
        assert.ok(strFromU8(parts[part]!).includes(notice), `${name} DOCX ${part} carries its notice`);
      const path = join(directory, `${name}.pdf`);
      await writeFile(path, await renderDocument(input, "pdf", 1, mode));
      const text = (await promisify(execFile)("pdftotext", ["-layout", path, "-"], { maxBuffer: 1 << 24 }))
        .stdout;
      const pages = text.split("\f").filter((page) => page.trim());
      if (name === "invoice") assert.ok(pages.length >= 2, `the invoice runs over ${pages.length} pages`);
      for (const [index, page] of pages.entries())
        assert.ok(words(page).includes(notice), `${name} PDF page ${index + 1} carries its notice`);
      // Nothing else in the file calls it a tax invoice or proof of payment.
      const rest = words(text).split(notice).join(" ");
      assert.doesNotMatch(rest, /tax invoice|proof of payment|payment proof|paid in full/i, name);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
    await closeRenderer();
  }
});
