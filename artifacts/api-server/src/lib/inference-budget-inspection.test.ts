import {test} from "node:test";
import assert from "node:assert/strict";
import {inspectInferenceBudget} from "./inference-budget-inspection";
import {InferenceBudgetStore} from "./inference-budget-store";
import {readFile} from "node:fs/promises";
import {emptyBudget,inferenceProposal,requestDigest,type BudgetEntry} from "./inference-budget";
const at="2026-11-15T00:00:00.000Z";
const entry=(runKey:string,status:BudgetEntry["status"]):BudgetEntry=>({
  runKey,lane:"publication",requestHash:"a".repeat(64),bindingHash:"b".repeat(64),scopeHash:"c".repeat(64),
  inputBound:400000,outputBound:8192,reserved:"370550400",
  charged:status==="settled"?"12000":"0",status,
});
const state=()=>({...emptyBudget(),priorUseReconciled:true,
  entries:[entry("PRIVATE-SYNTHETIC-MARKER","settled"),entry("r","reserved"),entry("u","unknown"),entry("x","cancelled")]});
test("inspection preserves full unknown reservations, exact integer room and no request identifiers",()=>{
  const s=state(),before=requestDigest(s);
  const result=inspectInferenceBudget({scope:"additional-new",observedAt:at,row:{
    version:7,policyHash:requestDigest(inferenceProposal),state:s}});
  assert.equal(result.settledNanoUsd,"12000");
  assert.equal(result.outstandingReservedNanoUsd,"741100800");
  assert.equal(result.boundedCommittedNanoUsd,"741112800");
  assert.equal(result.uncommittedCapacityNanoUsd,"29258887200");
  assert.equal(result.statusCounts.cancelled,1);
  assert.equal(result.maximumWholeContextPairs,"39");
  assert.equal(result.authorizesDispatch,false);
  assert.equal(requestDigest(s),before);
  assert.ok(!JSON.stringify(result).includes("PRIVATE-SYNTHETIC-MARKER"));
});
test("historical unknown exposure is visible but never subtracted from or relabelled as a new allocation",()=>{
  const s={...state(),unboundedPrior:["original-unknown-1"]};
  const old=inspectInferenceBudget({scope:"legacy",observedAt:at,row:{
    version:1,policyHash:requestDigest(inferenceProposal),state:s}});
  assert.equal(old.unboundedPriorRecords,1);assert.equal(old.uncommittedCapacityNanoUsd,null);
  const next=inspectInferenceBudget({scope:"additional-new",observedAt:at,row:null});
  assert.equal(next.accountingBasis,"uninitialized-policy-default");
  assert.equal(next.uncommittedCapacityNanoUsd,"30000000000");
  assert.equal(next.maximumWholeContextPairs,"40");
  assert.equal(next.authorizesDispatch,false);assert.equal(next.ledgerVersion,null);
  assert.notEqual(next.allocationId,old.allocationId);
});
test("mismatched policies, unknown liabilities, suspension and unreconciled usage cannot advertise available capacity",()=>{
  for(const mutate of[(s:ReturnType<typeof state>)=>{s.priorUseReconciled=false;},
    (s:ReturnType<typeof state>)=>{s.suspended=true;},
    (s:ReturnType<typeof state>)=>{s.unboundedPrior.push("unknown");}]){
    const s=state();mutate(s);
    const out=inspectInferenceBudget({scope:"additional-new",observedAt:at,row:{
      version:1,policyHash:requestDigest(inferenceProposal),state:s}});
    assert.equal(out.uncommittedCapacityNanoUsd,null);assert.ok(out.holds.length);
  }
  assert.equal(inspectInferenceBudget({scope:"additional-new",observedAt:at,row:{
    version:1,policyHash:"f".repeat(64),state:state()}}).uncommittedCapacityNanoUsd,null);
  assert.throws(()=>inspectInferenceBudget({scope:"legacy",observedAt:"bad",row:null}),/TIME/);
});
test("store inspection uses a read-only snapshot, never initializes/adopts a policy or appends an event",async()=>{
  const calls:string[]=[];
  let released=false;
  const c={query:async(sql:string)=>{calls.push(sql);return{rows:sql.startsWith("SELECT")?
    [{observed_at:at,id:null}]:[]};},release:()=>{released=true;}};
  const store=new InferenceBudgetStore({connect:async()=>c} as never,"public","additional-new");
  const out=await store.inspect();
  assert.equal(out.authorizesDispatch,false);assert.equal(calls.length,3);assert.ok(released);
  assert.match(calls[0]!,/REPEATABLE READ READ ONLY/);
  assert.match(calls[1]!,/LEFT JOIN "public".valo_inference_budgets/);
  assert.equal(calls[2],"COMMIT");
  assert.ok(calls.every(q=>!/\b(INSERT|UPDATE|DELETE|CREATE|ALTER)\b/.test(q)));
});
test("failed snapshot rolls back and releases instead of falling back to an invented balance",async()=>{
  let released=false;const calls:string[]=[];
  const c={query:async(q:string)=>{calls.push(q);if(q.startsWith("SELECT"))throw Error("controlled outage");
    return{rows:[]};},release:()=>{released=true;}};
  const store=new InferenceBudgetStore({connect:async()=>c} as never);
  await assert.rejects(()=>store.inspect(),/controlled outage/);
  assert.equal(calls.at(-1),"ROLLBACK");assert.ok(released);
});
test("standard database CI invokes the non-skipped HTTP privacy suite and keeps storage lanes separate",async()=>{
  const pkg=JSON.parse(await readFile(new URL("../../package.json",import.meta.url),"utf8"));
  const workflow=await readFile(new URL("../../../../.github/workflows/valo-foundation.yml",import.meta.url),"utf8");
  assert.match(pkg.scripts["test:valo-db"],/test:valo-db-core && pnpm run test:valo-privacy-http-db/);
  assert.match(pkg.scripts["test:valo-privacy-http-db"],/VALO_RUN_DB_TESTS=synthetic-development-only/);
  assert.match(pkg.scripts["test:valo-privacy-http-db"],/src\/routes\/valo-privacy-http\.integration\.test\.ts/);
  assert.match(pkg.scripts["test:valo-db-core"],/inference-budget-inspection\.integration\.test\.ts/);
  assert.match(workflow,/run: pnpm --filter @workspace\/api-server test:valo-db-core\n/);
  assert.match(workflow,/name: Prove actual HTTP privacy-role and session boundary\n\s+if:.*!cancelled\(\).*\n\s+run: pnpm --filter @workspace\/api-server test:valo-privacy-http-db\n/);
  assert.match(workflow,/VALO_ERASURE_STORAGE_PROOF: portable/);
  assert.doesNotMatch(workflow,/run:.*test:valo-erasure-native/);
  assert.match(workflow,/poppler-utils/);
});
