import {test} from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {buildFiniteDecisionPacket} from "./inference-decision-packet";
import {prepareOperationalFiniteManifest,finiteManifestProposal,type OperationalFiniteInput} from "./inference-manifest";
import {requestDigest} from "./inference-budget";
const now=new Date("2026-11-15T05:00:00Z"),expiry="2026-11-15T06:00:00Z";
function prepared(){
  const input:OperationalFiniteInput={candidateVersionId:"11111111-1111-4111-8111-111111111111",
    candidateHash:"a".repeat(64),bundleHash:"b".repeat(64),sourceHashes:[],
    sourceFiles:[{path:"docs/source.md",sha256:"c".repeat(64)}],
    plan:{manifest:{candidateHash:"a".repeat(64),preparedAt:now.toISOString(),expiresAt:expiry,
      status:"mechanically_planned_not_reserved"},artifact:{id:"22222222-2222-4222-8222-222222222222",
      hash:"d".repeat(64),extension:"json"},entries:(["factual","challenge"] as const).map(role=>({
        role,request:{model:"gpt-5.4-mini",max_completion_tokens:8192,messages:[{role:"user",content:`Controlled ${role} request`}]}}))}};
  const m=prepareOperationalFiniteManifest(input,now);m.packageId=`finite-package:${"e".repeat(64)}`;
  return finiteManifestProposal(m,expiry);
}
function artifact(p:ReturnType<typeof prepared>){
  return{id:"33333333-3333-4333-8333-333333333333",extension:"json" as const,
    hash:createHash("sha256").update(JSON.stringify(p.manifest)).digest("hex")};
}
const capacity={stateFingerprint:"f".repeat(64),uncommittedCapacityNanoUsd:"30000000000",observedAt:now.toISOString()};
test("real request projection binds roles, exact versions, private artifact, costs and expiry without approval",()=>{
  const p=prepared(),packet=buildFiniteDecisionPacket([p],[artifact(p)],capacity,now);
  assert.equal(packet.attemptCount,2);assert.equal(packet.worstCaseReservationNanoUsd,"741100800");
  assert.equal(packet.enabled,false);assert.equal(packet.ownerApproved,false);assert.equal(packet.authorizesDispatch,false);
  assert.equal(packet.reviewStatus,"independent-review-pending");assert.equal(packet.expiresAt,new Date(expiry).toISOString());
  assert.equal(packet.manifests[0]!.works[0]!.requestHash,requestDigest(p.manifest.works[0]!.request));
  assert.equal(packet.manifests[0]!.works[0]!.sourceFiles[0]!.sha256,"c".repeat(64));
  assert.equal(packet.manifests[0]!.works[0]!.evaluationCase.id,null);
  assert.ok(!JSON.stringify(packet).includes("Controlled factual request"));
});
test("missing or depleted capacity holds the real roster instead of inventing a balance or dropping work",()=>{
  const p=prepared();for(const room of[null,"1"]){
    const packet=buildFiniteDecisionPacket([p],[artifact(p)],{...capacity,uncommittedCapacityNanoUsd:room},now);
    assert.equal(packet.status,"held-capacity-unverified");assert.equal(packet.attemptCount,2);
  }
  assert.throws(()=>buildFiniteDecisionPacket([],[],capacity,now),/ROSTER_REQUIRED/);
});
test("changed manifests, forged private artifact hash, missing roles and expired work fail",()=>{
  const p=prepared(),a=artifact(p);p.manifest.works[0]!.candidateHash="f".repeat(64);
  assert.throws(()=>buildFiniteDecisionPacket([p],[a],capacity,now),/BINDING_INVALID/);
  const fresh=prepared();
  assert.throws(()=>buildFiniteDecisionPacket([fresh],[{...artifact(fresh),hash:"0".repeat(64)}],capacity,now),/BINDING_INVALID/);
  assert.throws(()=>buildFiniteDecisionPacket([fresh],[artifact(fresh)],capacity,new Date(expiry)),/EXPIRED/);
  fresh.manifest.works[1]!.role="factual";fresh.manifestHash=requestDigest(fresh.manifest);
  assert.throws(()=>buildFiniteDecisionPacket([fresh],[artifact(fresh)],capacity,now),/PAIR_REQUIRED/);
});
test("an actual prepared roster exceeding the fixed ceiling cannot be described as ready",()=>{
  const p=prepared();assert.throws(()=>buildFiniteDecisionPacket(Array(41).fill(p),Array(41).fill(artifact(p)),capacity,now),/EXCEEDS_ALLOCATION/);
});
