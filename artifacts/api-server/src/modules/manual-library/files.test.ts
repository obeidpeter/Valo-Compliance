import assert from "node:assert/strict";
import { test } from "node:test";
import { strToU8, zipSync } from "fflate";
import { ValoProblem } from "../../platform/valo-problem";
import { fileLimit, readEditorialUpload, wordFromText } from "./files";

/**
 * The staff upload's limits (docs/valo/staff-upload-limits.md; OWASP ASVS 5.0.0 V5.2.1 to V5.2.3 and
 * V1.5.1 in the security baseline). Every file here is made in the test, and none is stored.
 */

const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

const CONTENT_TYPES =
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
const RELS =
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
const documentXml = (text: string, before = "") =>
  `${before}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`;

/** A Word package with the given parts over a standard one. */
function word(parts: Record<string, Uint8Array | string> = {}) {
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(CONTENT_TYPES),
    "_rels/.rels": strToU8(RELS),
    "word/document.xml": strToU8(documentXml("Synthetic text")),
  };
  for (const [name, value] of Object.entries(parts))
    files[name] = typeof value === "string" ? strToU8(value) : value;
  return zipSync(files, { mtime: new Date(2000, 0, 1) });
}

/** A PDF of the given number of empty pages, optionally with a document-level script. */
function pdf(pages: number, { script = false } = {}) {
  const kids = Array.from({ length: pages }, (_, i) => `${i + 3} 0 R`).join(" ");
  const names = script ? ` /Names << /JavaScript << /Names [(synthetic) ${pages + 3} 0 R] >> >>` : "";
  const objects = [
    `<< /Type /Catalog /Pages 2 0 R${names} >>`,
    `<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`,
    ...Array.from({ length: pages }, () => "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>"),
    ...(script ? ["<< /S /JavaScript /JS (void 0) >>"] : []),
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body);
  body +=
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

/** The refusal an upload meets: its status and its sentence. */
async function refusal(format: "docx" | "pdf", text: string) {
  try {
    await readEditorialUpload(format, text);
  } catch (error) {
    assert.ok(error instanceof ValoProblem, String(error));
    return { status: error.status, message: error.message };
  }
  assert.fail("the upload was accepted");
}

const MACROS = "Upload a standard Word document without macros or embedded programs.";
const SELF_CONTAINED = "Upload a self-contained .docx document.";
const PDF_LIMITS = "Upload a PDF with up to 100 pages, without encryption, scripts or embedded files.";

test("a standard Word file is read, and its text kept as written", async () => {
  const upload = await readEditorialUpload(
    "docx",
    base64(wordFromText("Synthetic title", "First line\nSecond line").bytes),
  );
  assert.equal(upload.text, "Synthetic title\nFirst line\nSecond line");
  assert.equal(upload.file.format, "docx");
  // An entity the file does not declare stays as written: no entity is expanded.
  const named = await readEditorialUpload(
    "docx",
    base64(word({ "word/document.xml": documentXml("&secret;") })),
  );
  assert.equal(named.text, "&secret;");
  // A hyperlink to a page outside the file is a link, not a part of it.
  const linked = await readEditorialUpload(
    "docx",
    base64(
      word({
        "word/_rels/document.xml.rels":
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.invalid/" TargetMode="External"/></Relationships>',
      }),
    ),
  );
  assert.equal(linked.text, "Synthetic text");
});

test("the staff upload refuses a file over its limits before it reads it", async () => {
  // Text longer than 2 MB of base64 can be is refused as too large, before it is decoded.
  assert.deepEqual(await refusal("docx", "A".repeat(Math.ceil(fileLimit / 3) * 4 + 4)), {
    status: 413,
    message: "Files must be 2 MB or smaller.",
  });
  // A file one byte over 2 MB, empty, or not written as plain base64.
  for (const text of [
    base64(new Uint8Array(fileLimit + 1)),
    "",
    base64(word()).replace(/^(.{8})/, "$1\n"),
    "not*base64",
  ])
    assert.deepEqual(await refusal("docx", text), {
      status: 422,
      message: "Choose a valid file of up to 2 MB.",
    });
  // A Word package that expands past 12 MB, from a file of a few kilobytes.
  const expanding = word({ "word/media/zeros.bin": new Uint8Array(13 * 1024 * 1024) });
  assert.ok(expanding.length < 64 * 1024, `the package is ${expanding.length} bytes`);
  assert.deepEqual(await refusal("docx", base64(expanding)), { status: 422, message: MACROS });
  // A Word package of more than 300 parts.
  const parts = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`word/part${i}.xml`, "<p/>"]));
  assert.deepEqual(await refusal("docx", base64(word(parts))), { status: 422, message: MACROS });
  // A PDF of more than 100 pages.
  assert.deepEqual(await refusal("pdf", base64(pdf(101))), { status: 422, message: PDF_LIMITS });
});

test("the staff upload refuses a file whose content is not its kind, or that carries a program", async () => {
  assert.deepEqual(await refusal("docx", base64(pdf(1))), {
    status: 422,
    message: "Valo could not read this Word document. Upload a .docx file or paste its text.",
  });
  assert.deepEqual(await refusal("pdf", base64(word())), {
    status: 422,
    message: "Upload a valid PDF document.",
  });
  // A package that is not a Word document: no document, or another kind's content types.
  const notWord = zipSync({ "notes.txt": strToU8("Synthetic notes") });
  assert.deepEqual(await refusal("docx", base64(notWord)), { status: 422, message: SELF_CONTAINED });
  assert.deepEqual(
    await refusal(
      "docx",
      base64(word({ "[Content_Types].xml": CONTENT_TYPES.replace("document.main", "template.main") })),
    ),
    { status: 422, message: SELF_CONTAINED },
  );
  // A macro, an embedded object or a part that climbs out of the package.
  for (const name of [
    "word/vbaProject.bin",
    "word/embeddings/oleObject1.bin",
    "../outside.xml",
    "/rooted.xml",
  ])
    assert.deepEqual(await refusal("docx", base64(word({ [name]: "synthetic" }))), {
      status: 422,
      message: MACROS,
    });
  // A PDF with a script.
  assert.deepEqual(await refusal("pdf", base64(pdf(1, { script: true }))), {
    status: 422,
    message: PDF_LIMITS,
  });
});

test("the staff upload refuses a Word file that declares a document type or an entity, or reaches outside itself", async () => {
  const declared = documentXml(
    "&secret;",
    '<?xml version="1.0"?><!DOCTYPE w:document [<!ENTITY secret SYSTEM "file:///etc/hostname">]>',
  );
  assert.deepEqual(await refusal("docx", base64(word({ "word/document.xml": declared }))), {
    status: 422,
    message: SELF_CONTAINED,
  });
  // An entity declared in the content types instead.
  const types = CONTENT_TYPES.replace("<Types", '<!DOCTYPE Types [<!ENTITY a "synthetic">]><Types');
  assert.deepEqual(await refusal("docx", base64(word({ "[Content_Types].xml": types }))), {
    status: 422,
    message: SELF_CONTAINED,
  });
  // A picture, or any part but a hyperlink, fetched from outside the file.
  const external =
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="https://example.invalid/pixel.png" TargetMode="External"/></Relationships>';
  assert.deepEqual(await refusal("docx", base64(word({ "word/_rels/document.xml.rels": external }))), {
    status: 422,
    message: SELF_CONTAINED,
  });
  // A numeric reference outside Unicode.
  assert.deepEqual(await refusal("docx", base64(word({ "word/document.xml": documentXml("&#x110000;") }))), {
    status: 422,
    message: "The Word document contains invalid text.",
  });
});
