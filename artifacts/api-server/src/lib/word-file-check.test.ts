import test from "node:test";
import assert from "node:assert/strict";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { typedSample } from "@workspace/valo-core/printed-page-samples";
import { everyPrintedDocument } from "../test-support/guided-template-documents";
import { renderDocument } from "./valo-render";
import { assertWordFileOpens, parseXml, wordFileProblems } from "./word-file-check";

// EDT-006 (docs/architecture/editor.md, slice 3): the export worker reads each Word file as Word
// does before it stores it. Word itself cannot run here; opening a file in it stays a manual check.

test("every guided template's Word file, from its questions and from its v2 form, and the typed document, the library copy and the long tables pass the check Word makes", async () => {
  const documents = await everyPrintedDocument();
  assert.equal(documents.filter(([name]) => name.endsWith("made from its questions")).length, 12);
  assert.equal(documents.filter(([name]) => name.endsWith("made from its v2 form")).length, 12);
  for (const [name, document] of documents)
    for (const mode of ["business_draft", "business_finished"] as const)
      assert.deepEqual(
        wordFileProblems(new Uint8Array(await renderDocument(document, "docx", 7, mode))),
        [],
        `the Word file of ${name}, ${mode}`,
      );
});

test("the check refuses what makes Word refuse a file, and names the part", async () => {
  const good = new Uint8Array(await renderDocument(typedSample(), "docx", 7));
  assert.deepEqual(wordFileProblems(good), []);
  assert.doesNotThrow(() => assertWordFileOpens(good));
  /** The good file with its parts changed. */
  const changed = (change: (parts: Record<string, Uint8Array>) => void) => {
    const parts = unzipSync(good);
    change(parts);
    return zipSync(parts);
  };
  const editXml = (part: string, edit: (xml: string) => string) =>
    changed((parts) => {
      parts[part] = strToU8(edit(strFromU8(parts[part]!)));
    });
  const refused: [string, Uint8Array, RegExp][] = [
    ["not a package", strToU8("Synthetic text"), /^the file is not a zip package$/],
    [
      "a part cut short",
      editXml("word/document.xml", (xml) => xml.slice(0, xml.lastIndexOf("</w:body>"))),
      /^word\/document\.xml is not well-formed XML: the element w:body is not closed$/,
    ],
    [
      "an ampersand that starts no entity",
      editXml("word/document.xml", (xml) => xml.replace("Synthetic chairs", "Synthetic & chairs")),
      /^word\/document\.xml is not well-formed XML: it has an ampersand that starts no entity$/,
    ],
    [
      "a part a relationship points to, missing",
      changed((parts) => delete parts["word/styles.xml"]),
      /^word\/_rels\/document\.xml\.rels points to word\/styles\.xml, which the package does not hold$/,
    ],
    [
      "a part with no content type",
      changed((parts) => {
        parts["word/media/synthetic.dat"] = strToU8("synthetic");
      }),
      /^word\/media\/synthetic\.dat has no content type$/,
    ],
    [
      "a main document of another type",
      editXml("[Content_Types].xml", (xml) =>
        xml.replace(
          'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"',
          'ContentType="application/xml"',
        ),
      ),
      /^word\/document\.xml is not a Word document's main part$/,
    ],
    [
      "a table cell with no paragraph",
      editXml("word/document.xml", (xml) => {
        const start = xml.indexOf("<w:tc>"),
          end = xml.indexOf("</w:tc>", start);
        const cell = xml.slice(start, end).replace(/<w:p\b[^>]*\/>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, "");
        return xml.slice(0, start) + cell + xml.slice(end);
      }),
      /^a table cell in word\/document\.xml has no paragraph$/,
    ],
    [
      "a table with no grid",
      editXml("word/document.xml", (xml) => xml.replace(/<w:tblGrid>[\s\S]*?<\/w:tblGrid>/, "")),
      /^a table in word\/document\.xml has no grid$/,
    ],
  ];
  for (const [name, bytes, problem] of refused) {
    const problems = wordFileProblems(bytes);
    assert.ok(
      problems.some((each) => problem.test(each)),
      `${name}: ${JSON.stringify(problems)}`,
    );
    assert.throws(() => assertWordFileOpens(bytes), /^Error: WORD_FILE_CHECK_FAILED$/, name);
  }
});

test("a part is well-formed XML only with one root, its elements closed in order, no attribute twice, no document type and no character XML forbids", () => {
  assert.equal(typeof parseXml('<?xml version="1.0"?><a b="1"><c/>text &amp; &#38; &#x26;</a>'), "object");
  for (const [xml, why] of [
    ["<a><b></a></b>", "the end tag a does not close the element open there"],
    ['<a b="1" b="2"/>', "an element has the attribute b twice"],
    ["<!DOCTYPE a><a/>", "it declares a document type"],
    ["<a/><b/>", "it has more than one root element"],
    ["<a>", "the element a is not closed"],
    ["<a>\u0001</a>", "it holds a character XML does not allow"],
    ["text<a/>", "it has text outside its root element"],
    ["", "it has no root element"],
    ['<a b="<"/>', "a start tag is not well formed"],
  ] as const)
    assert.equal(parseXml(xml), why, xml);
});
