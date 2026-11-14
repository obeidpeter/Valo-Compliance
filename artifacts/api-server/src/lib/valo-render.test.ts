import test from "node:test";
import assert from "node:assert/strict";
import { unzipSync, strFromU8 } from "fflate";
import { controlledHtml, renderDocument, DRAFT_NOTICE } from "./valo-render";
import { syntheticDocument } from "./valo-test-fixtures";
import { readerContainsText } from "./valo-reader-checks";

test("reader comparison tolerates extraction spacing, never changed parties, currency or money",()=>{
  assert.equal(readerContainsText("Fictional BusinessA","Fictional Business A"),true);
  assert.equal(readerContainsText("Fictional BusinessB","Fictional Business A"),false);
  assert.equal(readerContainsText("₦37,000.00","₦37,001.00"),false);
  assert.equal(readerContainsText("$37,000.00","₦37,000.00"),false);
  assert.equal(readerContainsText("anything"," "),false);
});

test("controlled HTML treats markup, local-file and metadata addresses as inert text",()=>{
  const input = structuredClone(syntheticDocument);
  input.title = '<script>alert("x")</script>';
  input.content.blocks[0]!.text = '<img src="http://169.254.169.254/">file:///etc/passwd<script>fetch("https://example.com")</script>';
  const html = controlledHtml(input,7);
  assert.ok(!html.includes("<script>")); assert.ok(!html.includes("<img"));
  assert.ok(html.includes("&lt;script&gt;")); assert.ok(html.includes("default-src 'none'"));
  assert.ok(html.includes("Saved revision 7")); assert.ok(html.includes(DRAFT_NOTICE));
});
test("DOCX contains editable OOXML, actual table cells, bullets, draft notice and naira",async()=>{
  const input = structuredClone(syntheticDocument);
  input.content.fields.issuerName = "Synthetic ₦ business";
  input.content.blocks.push({id:"t",type:"table",text:"",rows:[["Description","Amount"],["Synthetic item","₦12,345.67"]]},
    {id:"l",type:"list",text:"First action\nSecond action",rows:[]});
  const bytes = await renderDocument(input,"docx",3);
  assert.equal(bytes.subarray(0,2).toString(),"PK");
  const parts = unzipSync(bytes);
  const xml = strFromU8(parts["word/document.xml"]!);
  assert.ok(xml.includes("₦12,345.67")); assert.ok(xml.includes("<w:tbl>"));
  assert.ok(xml.includes("First action")); assert.ok(xml.includes("Saved revision 3"));
  assert.ok(Object.keys(parts).some(name=>name.startsWith("word/header")));
});
test("renderer rejects unknown formatting, arbitrary clause inputs and invalid dates",async()=>{
  const invalid = structuredClone(syntheticDocument);
  (invalid.content.formatting as {font:string}).font = "url(http://169.254.169.254)";
  await assert.rejects(()=>renderDocument(invalid,"docx",1));
  const clauses = structuredClone(syntheticDocument);
  (clauses.content.selectedClauses as string[]).push("unreleased-contract-clause");
  await assert.rejects(()=>renderDocument(clauses,"docx",1));
  const dates = structuredClone(syntheticDocument); dates.content.fields.issueDate = "2026-02-31";
  await assert.rejects(()=>renderDocument(dates,"docx",1));
});
