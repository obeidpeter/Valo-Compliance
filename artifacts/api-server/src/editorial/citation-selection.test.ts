import test from "node:test";
import assert from "node:assert/strict";
import { draftSelectionSchema,editorialDraftInput,resolveDraftSelection,sourceExcerpts } from "./citation-selection";
import { candidateSchema,mechanicalCandidate,type EvidenceBundle } from "./pipeline-contract";
const bundle:EvidenceBundle={
  snapshotId:"a8f1f54a-ef9c-4c44-bbe3-c71bdf1d2c31",sourceId:"synthetic-selector-fixture",
  title:"Synthetic selector boundary fixture, not legal evidence",url:"https://example.invalid",
  rawHash:"a".repeat(64),textHash:"b".repeat(64),fetchedAt:"2026-11-13T00:00:00Z",
  publication:"held",effectivePeriod:"unverified",
  passages:[{id:"page:1",page:1,text:"Synthetic quotation with exact spaces.\nA following source line."}],
};
const raw=()=>({title:"Synthetic citation test",contentClass:"general_guidance_candidate",scope:"Synthetic fixture only",
  paragraphs:[{id:"p1",kind:"source_statement",text:"Synthetic quotation with exact spaces.",
    claims:[{id:"c1",statement:"Synthetic quotation with exact spaces.",excerptIndex:0}]}],
  missingEvidence:["No current legal evidence"],disclosure:candidateSchema.shape.disclosure.value});
test("selection resolves only actual source bytes and passes unchanged quote checks",()=>{
  const c=resolveDraftSelection(raw(),editorialDraftInput(bundle));
  assert.equal(c.paragraphs[0]!.claims[0]!.quote,bundle.passages[0]!.text);
  assert.deepEqual(mechanicalCandidate(c,bundle),[]);
});
test("a supplied invented quotation or snapshot cannot enter the selector schema",()=>{
  const r=raw();Object.assign(r.paragraphs[0]!.claims[0]!,{quote:"Invented",sourceSnapshotId:bundle.snapshotId});
  assert.equal(draftSelectionSchema.safeParse(r).success,false);
});
test("out-of-range citation selection fails rather than substituting another source",()=>{
  const r=raw();r.paragraphs[0]!.claims[0]!.excerptIndex=63;
  assert.throws(()=>resolveDraftSelection(r,editorialDraftInput(bundle)),/AI_CITATION_SELECTION_INVALID/);
});
test("forged input excerpt text fails even with a valid index",()=>{
  const context=editorialDraftInput(bundle);context.sourceExcerpts[0]!.quote="Forged authoritative text";
  assert.throws(()=>resolveDraftSelection(raw(),context),/AI_CITATION_SELECTION_INVALID/);
});
test("post-resolution quote edits still fail the original mechanical guard",()=>{
  const c=resolveDraftSelection(raw(),editorialDraftInput(bundle));
  c.paragraphs[0]!.claims[0]!.quote="Fabricated after resolution";
  assert.deepEqual(mechanicalCandidate(c,bundle),["unsupported_quote:c1"]);
});
test("bounded excerpts retain exact offsets and do not reconstruct missing text",()=>{
  const long={...bundle,passages:[{...bundle.passages[0]!,text:"0123456789".repeat(500)}]};
  for(const e of sourceExcerpts(long)){
    assert.ok(e.quote.length<=1200);assert.equal(e.quote,long.passages[0]!.text.slice(e.start,e.end));
  }
});
