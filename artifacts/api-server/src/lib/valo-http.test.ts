import assert from "node:assert/strict";
import { test } from "node:test";

test("running development HTTP API fails closed and reports factual release status", {
  skip: process.env.VALO_RUN_HTTP_TESTS !== "synthetic-development-only",
}, async t => {
  assert.notEqual(process.env.NODE_ENV, "production");
  assert.ok(process.env.REPLIT_DEV_DOMAIN, "Use only the Replit development preview for this check");
  const base = `https://${process.env.REPLIT_DEV_DOMAIN}`;
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
    for (const path of ["/api/workspace", "/api/workspace/documents", "/api/workspace/documents/00000000-0000-4000-8000-000000000001/revisions"]) {
      const response = await fetch(`${base}${path}`);
      assert.equal(response.status, 401);
      assert.ok(response.headers.get("cache-control")?.includes("no-store"));
      assert.equal(response.headers.get("access-control-allow-origin"), null);
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
  await t.test("the original UAT and gate register does not claim execution or sign-offs", async () => {
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
    assert.ok(body.suites.every(s => s.executedCases === 0 && !s.accepted));
    assert.equal(body.r1Accepted || body.r2Unlocked || body.publicLaunchEnabled, false);
    assert.ok(body.releaseControls.some(c => c.text.includes("cannot waive failed mandatory evidence gates")));
  });
});
