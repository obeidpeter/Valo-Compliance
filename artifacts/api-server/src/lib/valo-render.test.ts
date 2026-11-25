import test from "node:test";
import assert from "node:assert/strict";
import { unzipSync, strFromU8 } from "fflate";
import { compileGuidedContent } from "@workspace/valo-core/guided-runtime";
import {
  blocksHtml,
  controlledHtml,
  docxBlocks,
  renderDocument,
  DRAFT_NOTICE,
  PURCHASE_NOTICE,
  RENDER_VERSION,
  type PrintedBlock,
} from "./valo-render";
import { syntheticDocument } from "./valo-test-fixtures";
import { completeGuidedTestData } from "./valo-guided-test-fixtures";
import { readerContainsText } from "./valo-reader-checks";
import { createHash } from "node:crypto";
import { Document, Packer } from "docx";
import { GUIDED_TEMPLATE_IDS } from "@workspace/valo-core/guided";
import { GUIDED_SPECS_V1 } from "@workspace/valo-core/guided-specs";

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
  assert.ok(html.includes("Saved version 7"));
  assert.ok(html.includes(DRAFT_NOTICE));
});

// The words inside a customer's own file are the site's: "version", the editor's names for the
// document's fields, a date with its month as a word. The other two kinds of file are kept exactly
// as they were: their words belong with the templates' own review and with the purchases screen's.
test("a customer's own document prints 'Saved version', its fields by the editor's names and its dates in words, and a template sample and a purchase receipt print as before", async () => {
  const input = structuredClone(syntheticDocument);
  input.content.fields = {
    issuerName: "Synthetic issuer",
    recipientName: "",
    documentNumber: "SYN-1",
    issueDate: "2026-11-21",
    dueDate: "2026-12-05",
    notes: "",
  };
  const lines = (html: string) =>
    [...html.matchAll(/<div class="field"><strong>([^<]*)<\/strong> ([^<]*)<\/div>/g)].map(
      (field) => field[1]! + " " + field[2]!,
    );
  const own = controlledHtml(input, 7);
  assert.deepEqual(lines(own), [
    "Issued by: Synthetic issuer",
    // A detail that was not given is left as a gap, never filled in.
    "Addressed to: [Not supplied]",
    "Reference number: SYN-1",
    "Issue date: 21 Nov 2026",
    "Due date: 5 Dec 2026",
    "Notes: [Not supplied]",
  ]);
  assert.ok(own.includes("<p>Valo · Saved version 7</p>"));
  assert.ok(!own.includes("revision"));
  for (const mode of ["template_sample", "purchase_receipt"] as const) {
    const other = controlledHtml(input, 7, mode);
    assert.deepEqual(
      lines(other),
      [
        "issuerName: Synthetic issuer",
        "recipientName: [Not supplied]",
        "documentNumber: SYN-1",
        "issueDate: 2026-11-21",
        "dueDate: 2026-12-05",
        "notes: [Not supplied]",
      ],
      mode,
    );
    assert.ok(other.includes("<p>Valo · Saved revision 7</p>"), mode);
    assert.ok(!other.includes(DRAFT_NOTICE), mode);
  }
  // The Word file says the same as the page the PDF is printed from.
  const xml = strFromU8(unzipSync(await renderDocument(input, "docx", 7))["word/document.xml"]!);
  const text = xml.replace(/<[^>]+>/g, "");
  for (const part of ["Issued by: Synthetic issuer", "Issue date: 21 Nov 2026", "Valo · Saved version 7"])
    assert.ok(text.includes(part), part);
  assert.ok(!text.includes("issuerName"));
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
  assert.ok(xml.includes("Saved version 3"));
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
  assert.match(DRAFT_NOTICE, /^INCOMPLETE DRAFT .* Not proof of payment, a government tax invoice,/);
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

// SEC-004: "document text cannot fetch cloud metadata, local files, private URLs or execute embedded
// script/macros"; EDT-009: "unsupported content cannot trigger remote network fetches or code execution".
test("document text that tries to fetch a URL, read a local file or run script does none of it in the PDF or DOCX", async () => {
  const { closeRenderer } = await import("./valo-render");
  const { createServer } = await import("node:http");
  const { once } = await import("node:events");
  const { randomUUID } = await import("node:crypto");
  const { execFile } = await import("node:child_process");
  const { mkdtemp, rm, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { promisify } = await import("node:util");
  // A private address the text points at, which records every request it receives.
  const requests: string[] = [];
  const server = createServer((req, res) => {
    requests.push(req.url ?? "");
    res.end("synthetic");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const directory = await mkdtemp(join(tmpdir(), "valo-render-hostile-"));
  const canary = `synthetic-local-file-${randomUUID()}`;
  const local = join(directory, "canary.txt");
  await writeFile(local, canary);
  const hostile = [
    `<img src="${origin}/image">`,
    `<link rel="stylesheet" href="${origin}/style">`,
    `<style>@import url("${origin}/import");body{background:url("${origin}/background")}</style>`,
    `<iframe src="file://${local}"></iframe>`,
    `<object data="file://${local}"></object>`,
    `<script>fetch("${origin}/script")</script>`,
    `<img src="http://169.254.169.254/latest/meta-data/">`,
  ].join(" ");
  const input = structuredClone(syntheticDocument);
  input.title = `Synthetic hostile text <img src="${origin}/title">`;
  input.content.fields.notes = hostile;
  input.content.blocks.push(
    { id: "hostile", type: "paragraph", text: hostile, rows: [] },
    {
      id: "hostile-list",
      type: "list",
      text: `${hostile}\n<script>fetch("${origin}/list")</script>`,
      rows: [],
    },
    {
      id: "hostile-table",
      type: "table",
      text: "",
      rows: [["Synthetic cell", `<img src="${origin}/cell">`]],
    },
  );
  try {
    const pdf = await renderDocument(input, "pdf", 1);
    const docx = await renderDocument(input, "docx", 1);
    // Time for a late request to arrive, had the renderer sent one.
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.deepEqual(requests, [], "no request reached the address in the text");
    const path = join(directory, "hostile.pdf");
    await writeFile(path, pdf);
    const text = (await promisify(execFile)("pdftotext", ["-layout", path, "-"], { maxBuffer: 1 << 24 }))
      .stdout;
    assert.ok(!text.includes(canary), "the local file's content is not in the PDF");
    assert.ok(text.includes("<script>"), "the markup is printed as text");
    const parts = unzipSync(docx);
    const names = Object.keys(parts);
    assert.ok(!names.some((name) => /vbaProject|vbaData|macro/i.test(name)), names.join(", "));
    assert.doesNotMatch(strFromU8(parts["[Content_Types].xml"]!), /macroEnabled|vbaProject/i);
    const xml = strFromU8(parts["word/document.xml"]!);
    assert.ok(!xml.includes(canary), "the local file's content is not in the DOCX");
    assert.ok(xml.includes("&lt;script&gt;"), "the DOCX holds the markup as text");
  } finally {
    server.close();
    await rm(directory, { recursive: true, force: true });
    await closeRenderer();
  }
});

// Forms v2, slice 3 (docs/architecture/forms-v2.md): the renderer prints a heading and a table's
// header row for a form that fills a template's own wording. Each of the twelve v1 forms' HTML is
// pinned here, with the RENDER_VERSION it prints under. A change to how one of them prints changes its
// hash, and must come with a new RENDER_VERSION. Version 6 left them unchanged: their lists have no
// blank line. Version 7 prints the first row of their tables and of their totals as a heading row
// (docs/architecture/editor.md), so the eight with a table changed; the four without one did not.
const PRINTED_V1_HTML: Record<string, string> = {
  "TPL-01": "6af1dcbd5232b133cd92063c3616762f72b1618a08cb2b4dd19a7e02a84504ea",
  "TPL-02": "aa8805cc9eaa5f9c2be7722a3d262bce1f05ef46acc036a0430a66f0d69c3e6d",
  "TPL-03": "628932ddbf8679db605b1b5f4dfe5bcdf954337988805771008604f85afe23e6",
  "TPL-04": "c38bf7b93cdef277a987cf9e573b5a6cae6b1e11d7ea85ecc7372dcbdf09996c",
  "TPL-05": "5360e934c43eaf025f070e97ff868c96c11e502f1eb2e482c780731c470a5338",
  "TPL-08": "f3f1cd497431114e674ef93377c77eb8d468fb1e30bdc3f48ac8737b0d68eacd",
  "TPL-12": "cc0386fada6301119ea45db6f3a2a7679c2143570f882cdd2e8e7db6caf52374",
  "TPL-13": "9518c629af262a25ca3a6b9103e7e41feff266f1781ba37db5f08429a4617b65",
  "TPL-14": "1480394edfc7e3ff5e6d2bb5b3df485c64e41ce0349a85cc75e3d40ae51797c3",
  "TPL-15": "5854a68cc8cf39f87779d6d78d6449030704db8a8892a1f98881346deb68a666",
  "TPL-16": "2c7be59fd584c9849d2e2c8a05bf190228f3eaf32b2f2e5b82fc742e4ccfa114",
  "TPL-17": "7901009a98cc109edd89781463ed9164e48dd2e5d51d4a991b3ba767dc88ef72",
};
test("the twelve question forms' printed HTML is pinned with the render version it prints under", () => {
  for (const id of GUIDED_TEMPLATE_IDS) {
    const html = controlledHtml(
      { title: GUIDED_SPECS_V1[id].title, content: compileGuidedContent(completeGuidedTestData(id)) },
      3,
    );
    assert.equal(createHash("sha256").update(html).digest("hex"), PRINTED_V1_HTML[id], id);
  }
  assert.equal(RENDER_VERSION, "manual-draft-7");
});
test("a form's headings print as headings and its table's header row repeats on each page, in HTML and Word, with every text escaped", async () => {
  const blocks: PrintedBlock[] = [
    { id: "h1", type: "heading", level: 2, text: "1. Parties <script>alert(1)</script>", rows: [] },
    { id: "h2", type: "heading", level: 3, text: "1.1 Who signs", rows: [] },
    { id: "p", type: "paragraph", text: "Synthetic words & more", rows: [] },
    {
      id: "t",
      type: "table",
      text: "",
      headerRows: 1,
      rows: [
        ["Deliverable", "Agreed timing"],
        ["Synthetic <b>files</b>", "30 days"],
      ],
    },
  ];
  const html = blocksHtml(blocks);
  assert.match(html, /<h2>1\. Parties &lt;script&gt;alert\(1\)&lt;\/script&gt;<\/h2>/);
  assert.match(html, /<h3>1\.1 Who signs<\/h3>/);
  assert.match(html, /<p>Synthetic words &amp; more<\/p>/);
  assert.match(
    html,
    /<table><thead><tr><th>Deliverable<\/th><th>Agreed timing<\/th><\/tr><\/thead><tbody><tr><td>Synthetic &lt;b&gt;files&lt;\/b&gt;<\/td><td>30 days<\/td><\/tr><\/tbody><\/table>/,
  );
  assert.doesNotMatch(html, /<script|<b>/);
  // A table without a header row prints as before.
  assert.equal(
    blocksHtml([{ id: "t", type: "table", text: "", rows: [["a", "b"]] }]),
    "<table><tbody><tr><td>a</td><td>b</td></tr></tbody></table>",
  );
  const word = await Packer.toBuffer(new Document({ sections: [{ children: docxBlocks(blocks) }] }));
  const xml = strFromU8(unzipSync(new Uint8Array(word))["word/document.xml"]!);
  assert.match(xml, /<w:pStyle w:val="Heading2"\/>/);
  assert.match(xml, /<w:pStyle w:val="Heading3"\/>/);
  assert.equal((xml.match(/<w:tblHeader\/>/g) ?? []).length, 1);
  assert.match(xml, /1\. Parties &lt;script&gt;/);
});
test("two tables in a row stay two tables in Word, kept apart by an empty paragraph, and a table after a paragraph needs none", async () => {
  // EDT-006 (docs/architecture/editor.md, slice 3): with nothing between them, Word and LibreOffice
  // join two tables into one, as an invoice's items and its totals were.
  const table = (id: string, heading: string): PrintedBlock => ({
    id,
    type: "table",
    text: "",
    headerRows: 1,
    rows: [
      [heading, "Amount"],
      ["Synthetic line", "₦100.00"],
    ],
  });
  const blocks = [
    table("items", "Description"),
    table("totals", "Total"),
    { id: "p", type: "paragraph", text: "Synthetic words", rows: [] },
    table("after", "Item"),
  ] satisfies PrintedBlock[];
  const word = await Packer.toBuffer(new Document({ sections: [{ children: docxBlocks(blocks) }] }));
  const body = strFromU8(unzipSync(new Uint8Array(word))["word/document.xml"]!);
  const between = body.split(/<w:tbl>[\s\S]*?<\/w:tbl>/);
  assert.equal(between.length, 4, "three tables");
  assert.match(
    between[1]!,
    /^<w:p\b[^>]*\/>$|^<w:p\b[^>]*><\/w:p>$|^<w:p\b[^>]*><w:pPr\/><\/w:p>$/,
    "an empty paragraph after the first table",
  );
  assert.match(between[2]!, /Synthetic words/);
  assert.doesNotMatch(
    between[2]!,
    /<w:p\b[^>]*\/>|<w:p\b[^>]*><\/w:p>/,
    "no empty paragraph after a paragraph",
  );
});
