import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { financialBlocks,lineTotal } from "@workspace/valo-core/money";
import { buildBusinessDraft } from "@workspace/valo-core/customer-document";
import { customerAICases } from "./valo-customer-ai-fixtures";
import { customerAIInput,customerProviderPayload,missingCustomerFields,unsupportedCustomerInput,hashAI } from "./valo-customer-ai-domain";
import { organizeCustomerDraft } from "./valo-customer-ai-model";
import { documentInput } from "./valo-validation";
const input=()=>structuredClone(customerAICases[0]!.input);
for(const task of ["invoice","quotation","payment_reminder","business_proposal"])
  test(`${task} manual fallback preserves supplied facts without AI consent`,()=>{
    const source=structuredClone(customerAICases.find(c=>c.task===task)!.input);source.processingConsent=false;
    const draft=documentInput.parse(buildBusinessDraft(source,null));
    assert.equal(draft.content.fields.issuerName,source.issuerName);
    assert.deepEqual(draft.content.financialInput,source.financialInput);
  });
test("fractional quantity rounds once, without floating point",()=>assert.equal(lineTotal("1.255","101"),127n));
test("large kobo remains exact beyond Number precision",()=>{
  const source=customerAICases.find(c=>c.name==="invoice: beyond-binary-safe-integer")!;
  assert.equal(financialBlocks(source.input.financialInput).at(-1)!.rows.at(-1)!.at(-1),source.expectedAmount);
});
test("discount cannot exceed supplied subtotal",()=>{
  const i=input();i.financialInput.discountKobo="250001";assert.equal(customerAIInput.safeParse(i).success,false);
});
test("zero quantity is rejected rather than treated as missing or positive",()=>{
  const i=input();i.financialInput.lines[0]!.quantity="0";assert.equal(customerAIInput.safeParse(i).success,false);
});
test("AI requires separate notice acceptance; manual drafting remains independent",()=>{
  const i=input();i.processingConsent=false;assert.equal(customerAIInput.safeParse(i).success,false);
  assert.ok(documentInput.parse(buildBusinessDraft(i,null)));
});
test("calendar errors and mismatched task schemas are rejected",()=>{
  const i=input();i.issueDate="2026-02-30";assert.equal(customerAIInput.safeParse(i).success,false);
  i.issueDate="2026-11-13";i.financialInput.kind="quotation";assert.equal(customerAIInput.safeParse(i).success,false);
});
test("missing facts are named, never invented",()=>{
  const i=input();i.issuerName="";i.documentNumber="";
  assert.deepEqual(missingCustomerFields(i),["issuerName","documentNumber"]);
});
test("scope and permission injection are blocked across all four tasks",()=>{
  for(const c of customerAICases.filter(c=>c.mode==="adversarial"))assert.equal(unsupportedCustomerInput(c.input),true);
});
test("only bounded redacted selected notes enter model context",()=>{
  const i=input();i.contextLines=[`${i.issuerName.toUpperCase()} contact synthetic@example.invalid +234 800 000 0000`];
  const p=customerProviderPayload(i);assert.deepEqual(Object.keys(p).sort(),["notes","task","tone"]);
  assert.ok(!JSON.stringify(p).toLowerCase().includes(i.issuerName.toLowerCase()));
  assert.ok(!JSON.stringify(p).includes("synthetic@example.invalid"));
  assert.ok(!JSON.stringify(p).includes("234"));
});
test("short identifiers cannot cascade replacement or expand model notes without bound",()=>{
  const i=input();i.issuerName="I";i.recipientName="D";i.documentNumber="E";i.contextLines=["I".repeat(1000)];
  const p=customerProviderPayload(i);assert.ok(p.notes[0]!.text.length<=1000);
});
test("model cannot duplicate or omit a supplied note index",()=>{
  assert.throws(()=>buildBusinessDraft(input(),{opening:"none",sections:[{heading:"notes",lineIndexes:[0,0,2]}]}));
});
test("JSONB key-order reconstruction preserves new financial revision hashes",()=>{
  const draft=documentInput.parse(buildBusinessDraft(input(),null));
  const reorder=(v:unknown):unknown=>Array.isArray(v)?v.map(reorder):v&&typeof v==="object"?
    Object.fromEntries(Object.entries(v).reverse().map(([k,value])=>[k,reorder(value)])):v;
  assert.equal(JSON.stringify(documentInput.parse(reorder(draft))),JSON.stringify(draft));
});
test("invalid provider structure gets one bounded retry, never fake success",async()=>{
  let calls=0;const r=await organizeCustomerDraft(input(),async()=>{
    calls++;return{id:"injected-negative-only",model:"not-a-model",choices:[{message:{content:"{}"}}]};
  });
  assert.equal(calls,2);assert.equal(r.plan,null);assert.equal(r.failureCode,"AI_SCHEMA_INVALID");
  assert.equal(r.runs.filter(run=>run.outboundAttempted).length,0);
});
test("injected transport outage preserves manual fallback without logging private input",async()=>{
  const r=await organizeCustomerDraft(input(),async()=>{throw Error("Controlled synthetic outage");});
  assert.equal(r.plan,null);assert.equal(r.failureCode,"AI_PROVIDER_UNAVAILABLE");assert.equal(r.runs.length,1);
  assert.ok(!JSON.stringify(r.runs).includes(input().issuerName));
});
test("fixture source hash identifies exactly sixty separate customer cases",()=>{
  assert.equal(customerAICases.length,60);assert.equal(new Set(customerAICases.map(c=>c.id)).size,60);
  assert.equal(hashAI(customerAICases).length,64);
});
test("retained real-provider payloads remain byte-reproducible after redaction hardening",async()=>{
  const report=JSON.parse(await readFile(new URL("../../../../docs/valo/evidence/customer-ai-60-evaluation.json",import.meta.url),"utf8")) as {
    results:{id:string;mode:string;providerInputHash:string|null}[]};
  const actual=report.results.filter(r=>r.mode==="real_provider");assert.equal(actual.length,20);
  for(const r of actual){
    const fixture=customerAICases.find(c=>c.id===r.id)!;
    assert.equal(hashAI(customerProviderPayload(fixture.input)),r.providerInputHash);
  }
});
