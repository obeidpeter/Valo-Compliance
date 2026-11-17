import assert from "node:assert/strict";
import test from "node:test";
import { coveragePlan } from "@workspace/valo-core";
test("coverage totals derive from distinct eligible records, not targets or operational forms", () => {
  const empty = coveragePlan();
  const slug = empty.industries[0].slug;
  const base = { industrySlugs: [slug], locationIds: [], sourceCheckedAt: "2026-11-13T12:00:00Z" };
  const guidance = { ...base, id: "SYNTHETIC-GUIDANCE", kind: "guidance" as const };
  const result = coveragePlan([
    guidance,
    guidance,
    { ...base, id: "SYNTHETIC-GUIDE", kind: "guide" },
    { ...base, id: "SYNTHETIC-PACK", kind: "industry_pack" },
    { ...base, id: "SYNTHETIC-LOCATION", kind: "location_pack", locationIds: ["NG-LA"] },
    { ...base, id: "SYNTHETIC-FORM", kind: "template" },
  ]);
  assert.equal(result.publishedGuidance, 1);
  assert.equal(result.publishedGuides, 1);
  assert.equal(result.publishedDeeperPacks, 1);
  assert.equal(result.checkedLocationPacks, 1);
  assert.equal(result.industries[0].publishedItems, 4);
  assert.equal(
    coveragePlan([{ ...base, id: "SYNTHETIC-FORM", kind: "template" }]).industries[0].publishedItems,
    0,
  );
  assert.equal(
    coveragePlan([]).publishedGuidance,
    0,
    "withdrawn/held versions are absent from caller's eligible selection",
  );
});
