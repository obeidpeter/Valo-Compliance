import assert from "node:assert/strict";
import { test } from "node:test";
import { GetSourceEvidenceResponse } from "@workspace/api-zod";

test("running development HTTP API fails closed and reports factual release status", {
  skip: process.env.VALO_RUN_HTTP_TESTS !== "synthetic-development-only",
}, async t => {
  assert.notEqual(process.env.NODE_ENV, "production");
  assert.ok(process.env.REPLIT_DEV_DOMAIN, "Use only the Replit development preview for this check");
  const base = `https://${process.env.REPLIT_DEV_DOMAIN}`;
  await t.test("source references report actual snapshots, not baseline approval or private storage locators",async()=>{
    const response=await fetch(`${base}/api/development/source-evidence`);
    assert.equal(response.status,200);assert.match(response.headers.get("cache-control")??"",/no-store/);
    const raw=await response.json();
    const body=GetSourceEvidenceResponse.parse(raw);
    assert.deepEqual(body.references.filter(r=>/^S\d{2}$/.test(r.id)).map(r=>r.id),Array.from({length:24},(_,i)=>`S${String(i+1).padStart(2,"0")}`));
    assert.equal(body.references.filter(r=>r.id.startsWith("SV-")).length,4);
    for(const id of ["CAC-BN-PROCESS","NIPC-BFA-2022","NCC-COPYRIGHT"]){
      const source=body.references.find(r=>r.id===id);
      assert.ok(source&&source.status==="retrieved_unreviewed"&&source.rawStored&&source.textStored);
      assert.match(source.textChecksum??"",/^[a-f0-9]{64}$/);
    }
    assert.match(body.handoverSummary,/871899483093363ec69d765e2d16fa1d88e0836e/);
    assert.match(body.handoverSummary,/local application branch/);
    assert.match(body.handoverSummary,/not application-source upload/);
    assert.ok(body.references.every(r=>r.publication==="held"&&r.aiReviewedAt===null&&r.sourceCheckedAt===null));
    assert.ok(body.references.filter(r=>/^S\d{2}$/.test(r.id)).every(r=>r.attemptedAt!==null&&r.status!=="not_attempted"));
    assert.equal(body.retentionProposals.length,7);
    assert.ok(body.retentionProposals.every(r=>!r.approved&&!r.enforced&&!r.statutoryPeriod));
    assert.equal(body.roadmapSections.length,4);
    assert.ok(body.roadmapSections.every(r=>r.status==="planning_assumption_not_accepted"));
    assert.ok(Array.isArray(body.editorialRuns));
    assert.ok(body.editorialRuns.every(r=>r.publication==="held"&&["draft","factual","challenge"].includes(r.role)));
    assert.doesNotMatch(JSON.stringify(raw),/rawObjectKey|textObjectKey|bucketId|PRIVATE_OBJECT_DIR|"objectKey"|"sourceBundle"|"systemPrompt"|"paragraphs"/);
  });
  await t.test("published search excludes all held templates and private documents", async () => {
    const result = await fetch(`${base}/api/public/catalogue?q=invoice&type=template&page=1`);
    assert.equal(result.status, 200);
    const body = await result.json() as {items: unknown[];heldTemplates:number};
    assert.deepEqual(body.items, []);
    assert.equal(body.heldTemplates, 40);
  });
  await t.test("release status does not accept P0, R2 or live payments", async () => {
    const result = await fetch(`${base}/api/public/status`);
    const body = await result.json() as Record<string, unknown>;
    assert.equal(body.receivedRequirements, 127);
    assert.equal(body.p0Passed, false);
    assert.equal(body.r2Unlocked, false);
    assert.equal(body.livePaymentsEnabled, false);
  });
  await t.test("real development reads receive durable quota metadata without trusting client identity headers", async () => {
    const response = await fetch(`${base}/api/public/status`, { headers: { "X-Forwarded-For":"192.0.2.123", "X-User-Id":"fabricated-user" } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-ratelimit-limit"), "60");
    assert.ok(Number(response.headers.get("x-ratelimit-remaining")) < 60);
    assert.ok(response.headers.get("cache-control")?.includes("no-store"));
    assert.ok(Number.isFinite(Date.parse(response.headers.get("x-ratelimit-reset")!)));
  });
  await t.test("malformed and oversized bodies fail explicitly, without reflecting submitted content", async () => {
    for (const [body,status] of [["{\"synthetic\":",400], [JSON.stringify({synthetic:"x".repeat(132000)}),413]] as const) {
      const response = await fetch(`${base}/api/workspace/documents`, {
        method:"POST", headers:{"Content-Type":"application/json",Origin:base}, body,
      });
      assert.equal(response.status, status);
      assert.ok(response.headers.get("cache-control")?.includes("no-store"));
      assert.ok(!(await response.text()).includes("synthetic"));
    }
  });
  await t.test("unauthenticated private endpoints reject reads without shared-cache retention", async () => {
    for (const path of ["/api/workspace", "/api/workspace/documents", "/api/workspace/documents/00000000-0000-4000-8000-000000000001/revisions",
      "/api/v1/documents/00000000-0000-4000-8000-000000000001/exports", "/api/v1/exports/00000000-0000-4000-8000-000000000001/file"]) {
      const response = await fetch(`${base}${path}`);
      assert.equal(response.status, 401);
      assert.ok(response.headers.get("cache-control")?.includes("no-store"));
      assert.equal(response.headers.get("access-control-allow-origin"), null);
      const error = await response.json() as {code:string;requestId:string;message:string};
      assert.ok(error.code && error.requestId && error.message);
    }
  });
  await t.test("cross-origin and missing-origin mutations are rejected before any save", async () => {
    for (const origin of ["https://attacker.invalid", ""]) {
      const response = await fetch(`${base}/api/workspace/documents`, {
        method: "POST", headers: { "Content-Type": "application/json", ...(origin ? {Origin:origin}: {}) },
        body: JSON.stringify({title: "Synthetic rejected request"}),
      });
      assert.equal(response.status, 403);
    }
  });
  await t.test("same-origin does not bypass identity verification", async () => {
    const response = await fetch(`${base}/api/workspace/documents`, {
      method: "POST", headers: {"Content-Type":"application/json", Origin:base},
      body: JSON.stringify({title:"Synthetic rejected request"}),
    });
    assert.equal(response.status, 401);
  });
  await t.test("the detailed matrix retains all exact criteria without marking them accepted", async () => {
    const response = await fetch(`${base}/api/development/requirements`);
    const body = await response.json() as {requirements: {id:string;exactText:string;acceptance:string;status:string}[]};
    assert.equal(body.requirements.length, 127);
    assert.equal(new Set(body.requirements.map(r => r.id)).size, 127);
    assert.ok(body.requirements.every(r => r.exactText && r.acceptance && r.status !== "verified"));
  });
  await t.test("content traceability does not promote research inventory to publications", async () => {
    const response = await fetch(`${base}/api/development/content`);
    assert.equal(response.status, 200);
    const body = await response.json() as {
      identifiedTemplates:number; regulatoryRows:number; publishedTemplates:number;
      rows:{id:string;status:string;relatedIds:string[]}[];
    };
    assert.equal(body.identifiedTemplates, 80);
    assert.equal(body.regulatoryRows, 79);
    assert.equal(body.publishedTemplates, 0);
    assert.equal(body.rows.length, 186);
    assert.ok(body.rows.every(r => r.status !== "published"));
    assert.deepEqual(body.rows.find(r => r.id === "REG-G01")!.relatedIds, ["REG-D01"]);
  });
  await t.test("the UAT and gate register distinguishes partial execution from acceptance", async () => {
    const response = await fetch(`${base}/api/development/proof`);
    assert.equal(response.status, 200);
    const body = await response.json() as {
      uatPackages:{id:string;accepted:boolean;requiredEvidence:string}[];
      gates:{id:string;status:string;approvers:string}[];
      releaseControls:{text:string}[];
      suites:{executedCases:number;accepted:boolean}[];
      r1Accepted:boolean;r2Unlocked:boolean;publicLaunchEnabled:boolean;
    };
    assert.equal(body.uatPackages.length, 10);
    assert.deepEqual(body.gates.map(g => g.id), ["G0","G1","G2","G3","G4","G5"]);
    assert.ok(body.gates.every(g => g.status !== "accepted" && g.approvers));
    assert.ok(body.uatPackages.every(p => !p.accepted && p.requiredEvidence));
    assert.ok(body.suites.every(s => Number.isInteger(s.executedCases) && s.executedCases >= 0 && !s.accepted));
    assert.equal(body.r1Accepted || body.r2Unlocked || body.publicLaunchEnabled, false);
    assert.ok(body.releaseControls.some(c => c.text.includes("cannot waive failed mandatory evidence gates")));
  });
  await t.test("public coverage serves exactly 20 held industries and six pack targets, not fictional guidance", async () => {
    const response = await fetch(`${base}/api/public/coverage`);
    assert.equal(response.status,200);
    const body=await response.json() as {
      industries:{id:string;slug:string;coverageState:string;publishedItems:number;sourceCheckedAt:string|null;deeperPackTarget:boolean}[];
      publishedGuidance:number;publishedGuides:number;checkedLocationPacks:number;priorityLocations:string[];ngoNotice:string;
    };
    assert.equal(body.industries.length,20);
    assert.equal(body.industries.filter(i=>i.deeperPackTarget).length,6);
    assert.ok(body.industries.every(i=>i.coverageState==="held" && i.publishedItems===0 && i.sourceCheckedAt===null));
    assert.equal(body.publishedGuidance + body.publishedGuides + body.checkedLocationPacks,0);
    assert.deepEqual(body.priorityLocations,["Lagos","FCT","Bayelsa"]);
    assert.match(body.ngoNotice,/No tax or licensing exemption/);
  });
  await t.test("every supplied inventory row has explicit evidence and coverage states; expansion stays disabled", async () => {
    const response=await fetch(`${base}/api/development/content`);
    assert.equal(response.status,200);
    const body=await response.json() as {
      rows:{id:string;canonicalId:string|null;sourceCheckedAt:string|null;publicationEligible:boolean;evidenceState:string;coverageState:string;overlapIds:string[]}[];
      overlaps:unknown[];expansionBoundaries:{enabled:boolean;release:string;status:string}[];
    };
    assert.equal(body.rows.filter(r=>r.id.startsWith("EBD-")).length,27);
    assert.equal(body.rows.filter(r=>r.id.startsWith("REG-")).length,79);
    assert.ok(body.rows.every(r=>r.evidenceState && r.coverageState && !r.publicationEligible && r.sourceCheckedAt===null));
    assert.equal(body.rows.find(r=>r.id==="EBD-B12")!.canonicalId,null);
    assert.ok(body.rows.find(r=>r.id==="REG-G04")!.overlapIds.includes("OVL-02"));
    assert.equal(body.overlaps.length,5);
    assert.ok(body.expansionBoundaries.every(r=>!r.enabled));
    assert.ok(body.expansionBoundaries.filter(r=>r.release==="R3").every(r=>r.status==="excluded_from_commission"));
  });
});
