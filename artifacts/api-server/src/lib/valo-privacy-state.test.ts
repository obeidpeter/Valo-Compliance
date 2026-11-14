import {test} from "node:test";
import assert from "node:assert/strict";
import {assertPrivacyCompletion,assertPrivacyTransition,assertPrivacyVersion,privacyAuditHash,privacyAuditEqual,
  privacyInitialSteps,privacySnapshotHash,type PrivacyAuditInput} from "./valo-privacy-state";
const material="fixture-only-protection-material-not-an-application-key";
test("privacy states preserve verification and irreversible terminal boundaries",()=>{
  assertPrivacyTransition("awaiting_verification","verified");assertPrivacyTransition("verified","assigned");
  assertPrivacyTransition("assigned","in_progress");assertPrivacyTransition("in_progress","partially_fulfilled");
  for(const[from,to]of[["awaiting_verification","fulfilled"],["verified","fulfilled"],["held","fulfilled"],
    ["fulfilled","in_progress"],["rejected","assigned"],["cancelled","verified"]]as const)
    assert.throws(()=>assertPrivacyTransition(from,to),{status:409});
});
test("privacy stale writes are rejected, not overwritten",()=>{
  assertPrivacyVersion(4,4);assert.throws(()=>assertPrivacyVersion(5,4),{status:409,currentRevision:5});
});
test("all six exact privacy systems need genuine complete dispositions",()=>{
  const steps=privacyInitialSteps("deletion");assert.throws(()=>assertPrivacyCompletion(steps),{status:409});
  const done=steps.map(s=>({...s,status:"confirmed" as const,detail:"Controlled fixture outcome, not provider execution."}));
  assertPrivacyCompletion(done);
  for(const status of["pending","running","held","failed"]as const)
    assert.throws(()=>assertPrivacyCompletion(done.map(s=>s.system==="external_processors"?{...s,status}:s)),{status:409});
  assert.throws(()=>assertPrivacyCompletion(done.slice(0,5)),{status:409});
  assert.throws(()=>assertPrivacyCompletion([...done.slice(0,5),done[0]!] ),{status:409});
  assert.throws(()=>assertPrivacyCompletion(done.map(s=>({...s,detail:" "}))),{status:409});
  assert.throws(()=>assertPrivacyCompletion(done.map(s=>s.system==="identity_verification"?{...s,status:"not_applicable"}:s)),{status:409});
});
test("privacy audit binds exact actor, tenant, state and reason; JSONB order is stable",()=>{
  assert.equal(privacySnapshotHash({b:2,a:{y:3,x:new Date("2026-11-14T00:00:00Z")}}),
    privacySnapshotHash({a:{x:"2026-11-14T00:00:00.000Z",y:3},b:2}));
  const input:PrivacyAuditInput={caseId:"case",workspaceId:"workspace",sequence:1,actorType:"staff",
    actorHash:"a".repeat(64),action:"claim",reason:"Fixture reason",createdAt:new Date("2026-11-14T00:00:00Z"),
    previousHash:"0".repeat(64),stateHash:"1".repeat(64),keyVersion:"fixture-v1"};
  const digest=privacyAuditHash(input,material);
  assert(privacyAuditEqual(digest,privacyAuditHash({...input},material)));
  for(const patch of[{workspaceId:"other"},{actorHash:"b".repeat(64)},{reason:"Altered"},
    {stateHash:"2".repeat(64)},{sequence:2},{previousHash:"3".repeat(64)}])
    assert(!privacyAuditEqual(digest,privacyAuditHash({...input,...patch},material)));
  assert(!privacyAuditEqual(digest,"bad"));assert.throws(()=>privacyAuditHash(input,"short"));
});
