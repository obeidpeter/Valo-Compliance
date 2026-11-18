import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFile(root + path, "utf8");
const register = JSON.parse(await read("docs/registers/requirements.json")) as {
  requirements: {
    id: string;
    title: string;
    release: string;
    priority: string;
    requirement: string;
    acceptance_criteria: string;
    source_line: number;
    source_exact_text: string;
    suggested_owner: string;
    dependencies: string[];
  }[];
  release_gates: { id: string; planned_window: string; required_evidence: string; approvers: string }[];
  uat_packages: { id: string; title: string; requirements: string; required_evidence: string }[];
};
const trd = await read("docs/specification/VALO-TRD-001-v1.1.txt");
const roadmap = await read("docs/specification/VALO-ROADMAP-001-v1.1.txt");
const essential = await read("docs/specification/essential-business-documents.txt");
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
const controls = JSON.parse(await read("docs/registers/release-controls.json")) as {
  id: string;
  title: string;
  source: "TRD" | "ROADMAP";
  text: string;
}[];
for (const control of controls)
  assert.ok(
    normalize(control.source === "TRD" ? trd : roadmap).includes(normalize(control.text)),
    control.id,
  );
assert.equal(register.uat_packages.length, 10);
assert.equal(register.release_gates.length, 6);
for (const [i, pack] of register.uat_packages.entries()) {
  assert.equal(pack.id, `UAT-${String(i + 1).padStart(2, "0")}`);
  assert.ok(normalize(trd).includes(normalize(pack.requirements)), pack.id);
  assert.ok(normalize(trd).includes(normalize(pack.required_evidence)), pack.id);
}
for (const [i, gate] of register.release_gates.entries()) {
  assert.equal(gate.id, `G${i}`);
  assert.ok(normalize(roadmap).includes(normalize(gate.required_evidence)), gate.id);
  assert.ok(normalize(roadmap).includes(normalize(gate.approvers)), gate.id);
}
assert.equal(register.requirements.length, 127);
assert.equal(new Set(register.requirements.map((r) => r.id)).size, 127);
const sourceRequirements = register.requirements.map((r) => {
  assert.ok(trd.includes(r.source_exact_text), `Missing exact source text for ${r.id}`);
  assert.ok(r.source_exact_text.includes(r.requirement), `Body differs for ${r.id}`);
  assert.ok(r.source_exact_text.includes(r.acceptance_criteria), `Criterion differs for ${r.id}`);
  assert.ok(["R1", "R2/R3"].includes(r.release));
  assert.ok(["Must", "Acceptance target"].includes(r.priority));
  return {
    id: r.id,
    title: r.title,
    release: r.release,
    priority: r.priority,
    exactText: r.requirement,
    acceptance: r.acceptance_criteria,
    sourceExactText: r.source_exact_text,
    sourceLocator: `docs/specification/VALO-TRD-001-v1.1.txt:${r.source_line}`,
    owner: r.suggested_owner,
    dependencies: r.dependencies,
  };
});
const inventory = JSON.parse(await read("docs/registers/content-inventory.json")) as {
  baseline_templates: unknown[];
  essential_document_mapping: unknown[];
  r2_missing_template_candidates: unknown[];
  regulatory_inventory: unknown[];
  industry_taxonomy: string[];
  r1_deeper_packs: string[];
  state_source_priorities: string[];
};
const part4 = JSON.parse(await read("docs/registers/coverage-expansion.json")) as {
  coverageLayers: { id: string; title: string; commitment: string; representation: string }[];
  expansionBoundaries: {
    id: string;
    release: string;
    horizon: string;
    priority: string;
    condition: string;
  }[];
  managementFiles: { id: string; title: string; description: string }[];
  ngoCaution: string;
  provisionalTargets: string;
};
for (const row of inventory.essential_document_mapping as { source_id: string; source_title: string }[])
  assert.ok(normalize(essential).includes(normalize(row.source_title)), row.source_id);
for (const row of inventory.regulatory_inventory as { source_id: string; source_title: string }[])
  assert.ok(normalize(essential).includes(normalize(row.source_title)), row.source_id);
for (const layer of part4.coverageLayers) {
  assert.ok(normalize(trd).includes(normalize(layer.commitment)), layer.id);
  assert.ok(normalize(trd).includes(normalize(layer.representation)), layer.id);
}
for (const row of part4.expansionBoundaries) {
  assert.ok(normalize(roadmap).includes(normalize(row.horizon)), row.id);
  assert.ok(normalize(roadmap).includes(normalize(row.priority)), row.id);
  assert.ok(normalize(roadmap).includes(normalize(row.condition)), row.id);
}
for (const file of part4.managementFiles)
  assert.ok(normalize(essential).includes(normalize(file.description)), file.id);
assert.ok(normalize(essential).includes(normalize(part4.ngoCaution)));
assert.ok(normalize(roadmap).includes(normalize(part4.provisionalTargets)));
assert.equal(inventory.baseline_templates.length, 40);
assert.equal(inventory.essential_document_mapping.length, 27);
assert.equal(inventory.r2_missing_template_candidates.length, 21);
assert.equal(inventory.regulatory_inventory.length, 79);
const sourceDigest = createHash("sha256").update(trd).digest("hex");
const output =
  "// Generated from retained coordinating-team sources. Do not edit; run sync-specification.ts.\n" +
  `export const specificationSha256 = ${JSON.stringify(sourceDigest)};\n` +
  `export const sourceRequirements = ${JSON.stringify(sourceRequirements, null, 2)} as const;\n` +
  `export const sourceGates = ${JSON.stringify(
    register.release_gates.map((g) => ({
      id: g.id,
      plannedWindow: g.planned_window,
      requiredEvidence: g.required_evidence,
      approvers: g.approvers,
    })),
    null,
    2,
  )} as const;\n` +
  `export const sourceUatPackages = ${JSON.stringify(
    register.uat_packages.map((p) => ({
      id: p.id,
      title: p.title,
      requirements: p.requirements,
      requiredEvidence: p.required_evidence,
    })),
    null,
    2,
  )} as const;\n` +
  `export const sourceReleaseControls = ${JSON.stringify(controls, null, 2)} as const;\n`;
await writeFile(root + "lib/valo-records/src/specification.generated.ts", output);
// Inventory remains wholly held. Never turn source inventory statuses into publication.
await writeFile(
  root + "lib/valo-core/src/content-register.generated.ts",
  "// Generated research inventory, not authoritative evidence or published content.\n" +
    `export const sourceContentInventory = ${JSON.stringify(inventory, null, 2)} as const;\n`,
);
await writeFile(
  root + "lib/valo-core/src/coverage-expansion.generated.ts",
  "// Generated planning contracts, not released guidance or enabled R2/R3 functionality.\n" +
    `export const sourceCoverageExpansion = ${JSON.stringify(part4, null, 2)} as const;\n`,
);
console.log(
  "Validated 127 exact requirements, 27 document titles, 79 regulatory titles, 10 UAT packs, six gates, five coverage layers and six expansion boundaries. No publication or gate accepted.",
);
