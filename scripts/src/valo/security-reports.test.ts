import test from "node:test";
import assert from "node:assert/strict";
import {dependencySummary,secretSummary} from "./security-reports";
test("dependency detector fails on a harmless high canary and strips raw descriptions",()=>{
  const marker="SYNTHETIC_PRIVATE_AUDIT_MARKER";
  const r=dependencySummary({metadata:{vulnerabilities:{critical:0,high:1}},advisories:{x:{
    id:1,module_name:"fake-package",severity:"high",title:marker}}});
  assert.equal(r.status,"blocked");assert.ok(!JSON.stringify(r).includes(marker));
  assert.throws(()=>dependencySummary({}),/UNAVAILABLE/);
});
test("secret detector strips matches, secrets and source lines",()=>{
  const marker="SYNTHETIC_PRIVATE_SECRET_MARKER";
  const r=secretSummary([{RuleID:"canary",File:"fixture.txt",StartLine:1,Secret:marker,Match:marker,Line:marker}]);
  assert.equal(r.status,"blocked");assert.equal(r.count,1);assert.ok(!JSON.stringify(r).includes(marker));
  assert.throws(()=>secretSummary(null),/UNAVAILABLE/);
});
