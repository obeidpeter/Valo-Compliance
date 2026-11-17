import assert from "node:assert/strict";
import { test } from "node:test";
import {
  baselineTemplates,
  contentReadiness,
  contentTraceRows,
  coveragePlan,
  expansionReadiness,
} from "@workspace/valo-core";

test("the 27 document rows keep original numbering and exactly five direct, one composite and 21 new mappings", () => {
  const c = contentReadiness();
  assert.deepEqual(
    c.supplementaryMappings.map((m) => m.source_id),
    [
      ...Array.from({ length: 21 }, (_, i) => `EBD-B${String(i + 1).padStart(2, "0")}`),
      ...Array.from({ length: 6 }, (_, i) => `EBD-N${String(i + 1).padStart(2, "0")}`),
    ],
  );
  assert.deepEqual(
    c.supplementaryMappings
      .filter((m) => m.mapping_type === "exact")
      .map((m) => [m.source_id, m.canonical_template_id]),
    [
      ["EBD-B03", "TPL-17"],
      ["EBD-B04", "TPL-16"],
      ["EBD-B07", "TPL-15"],
      ["EBD-B11", "TPL-26"],
      ["EBD-B14", "TPL-10"],
    ],
  );
  const manual = c.supplementaryMappings.find((m) => m.source_id === "EBD-B12")!;
  assert.equal(manual.mapping_type, "composite");
  assert.equal(manual.canonical_template_id, null);
  assert.ok(manual.related_template_ids.length > 1);
  assert.equal(c.supplementaryMappings.filter((m) => m.mapping_type === "new").length, 21);
  assert.deepEqual(
    c.identifiedAdditions.map((t) => t.id),
    Array.from({ length: 21 }, (_, i) => `TPL-${41 + i}`),
  );
});

test("79 regulatory source rows preserve category IDs and ordinal positions without universal applicability", () => {
  const rows = contentReadiness().regulatoryRows;
  const ids = Object.entries({ A: 9, B: 6, C: 5, D: 12, E: 4, F: 28, G: 5, H: 10 }).flatMap(([category, n]) =>
    Array.from({ length: n }, (_, i) => `REG-${category}${String(i + 1).padStart(2, "0")}`),
  );
  assert.deepEqual(
    rows.map((r) => r.source_id),
    ids,
  );
  assert.deepEqual(
    rows.map((r) => r.ordinal),
    Array.from({ length: 79 }, (_, i) => i + 1),
  );
  assert.ok(
    rows.every(
      (r) =>
        r.publication_status === "held" &&
        !r.mandatory_for_all_businesses &&
        !r.jurisdiction_verified &&
        r.source_evidence.length === 0 &&
        r.applicability_status === "not_assessed",
    ),
  );
});

test("SCUML aliases and facility/sector overlaps are traced, not counted as separate releases", () => {
  const rows = contentTraceRows();
  assert.equal(rows.find((r) => r.id === "REG-G01")!.canonicalId, "REG-D01");
  assert.equal(rows.find((r) => r.id === "REG-G01")!.mappingType, "scoped_alias");
  for (const id of ["REG-G04", "REG-F17", "REG-F19"])
    assert.ok(rows.find((r) => r.id === id)!.overlapIds.includes("OVL-02"));
  assert.equal(contentReadiness().overlaps.length, 5);
  assert.equal(rows.length, 186);
  assert.equal(new Set(rows.map((r) => r.id)).size, 186);
  assert.ok(
    rows.every(
      (r) =>
        !r.publicationEligible &&
        r.sourceCheckedAt === null &&
        r.sourceLocator &&
        r.evidenceState &&
        r.coverageState,
    ),
  );
});

test("19 extra candidates have distinct purposes, existing comparison targets and no publication credit", () => {
  const c = contentReadiness();
  const identified = new Set([...baselineTemplates, ...c.identifiedAdditions].map((t) => t.id));
  assert.equal(c.furtherProposals.length, 19);
  for (const candidate of c.furtherProposals) {
    assert.ok(candidate.rationale.length > 25);
    assert.ok(candidate.comparedWithTemplateIds.length > 0);
    assert.ok(candidate.comparedWithTemplateIds.every((id) => identified.has(id)));
    assert.equal(candidate.countsAsPublished, false);
  }
  const declaration = c.furtherProposals.find((t) => t.title === "Conflict of interest declaration")!;
  assert.ok(declaration.comparedWithTemplateIds.includes("TPL-57"));
  assert.match(declaration.rationale, /individual/);
});

test("the exact 20-industry taxonomy and six deeper-pack targets have no invented review dates", () => {
  const p = coveragePlan(),
    c = contentReadiness();
  assert.deepEqual(
    p.industries.map((i) => i.title),
    c.industryTaxonomy,
  );
  assert.equal(p.industries.length, 20);
  assert.equal(new Set(p.industries.map((i) => i.slug)).size, 20);
  assert.deepEqual(
    p.industries
      .filter((i) => i.deeperPackTarget)
      .map((i) => i.title)
      .sort(),
    [...c.deeperPacks].sort(),
  );
  assert.ok(
    p.industries.every(
      (i) => i.publishedItems === 0 && i.coverageState === "held" && i.sourceCheckedAt === null,
    ),
  );
  assert.deepEqual(p.priorityLocations, ["Lagos", "FCT", "Bayelsa"]);
  assert.equal(p.checkedLocationPacks, 0);
  assert.equal(p.selectableLocations, 37);
  assert.equal(p.guidanceTarget, 30);
  assert.equal(p.guidesTarget, 12);
  assert.match(p.ngoNotice, /No tax or licensing exemption is inferred/);
});

test("R2 metadata remains locked, R3 excluded, and management files never pad the template total", () => {
  const e = expansionReadiness();
  assert.equal(e.expansionBoundaries.length, 6);
  assert.ok(e.expansionBoundaries.every((r) => !r.enabled));
  assert.ok(
    e.expansionBoundaries
      .filter((r) => r.release === "R2")
      .every((r) => r.status === "locked_until_r1_accepted"),
  );
  assert.ok(
    e.expansionBoundaries
      .filter((r) => r.release === "R3")
      .every((r) => r.status === "excluded_from_commission"),
  );
  assert.equal(e.managementFiles.length, 4);
  assert.equal(e.coverageLayers.length, 5);
  assert.deepEqual(e.r2Targets, {
    templates: 80,
    guided: 24,
    guidance: 60,
    deeperPacks: 10,
    locationsUpTo: 6,
  });
  assert.match(e.provisionalTargets, /provisional/);
  assert.match(e.ngoCaution, /does not automatically exempt/);
});
