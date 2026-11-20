import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { requirements, requirementStatus, workItemsForRequirement } from "@workspace/valo-records";
import { readCitations } from "./ci-evidence";

const revision = process.argv[2] ?? execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
assert.match(revision, /^[a-f0-9]{40}$/);
const root = new URL("../../../", import.meta.url);
const sourcePath = new URL("docs/registers/requirements.json", root);
const path = new URL("docs/registers/implementation-evidence.json", root);
type Row = { id: string; source_exact_text: string; [key: string]: unknown };
const register = JSON.parse(await readFile(sourcePath, "utf8")) as {
  requirements: Row[];
  [key: string]: unknown;
};
assert.equal(register.requirements.length, 127);
assert.equal(requirements.length, 127);
const byId = new Map(requirements.map((r) => [r.id, r]));
// Tests cited in docs/registers/ci-evidence.json count as evidence too (decision 0010): the evidence
// files are frozen (decision 0004), so evidence for anything built since comes only from citations.
const citationCounts = new Map<string, number>();
for (const citation of readCitations())
  citationCounts.set(citation.requirement, (citationCounts.get(citation.requirement) ?? 0) + 1);
for (const row of register.requirements) {
  const implemented = byId.get(row.id);
  assert.ok(implemented, row.id);
  assert.equal(row.source_exact_text, implemented.sourceExactText, row.id);
  for (const evidence of implemented.evidence) {
    const bytes = await readFile(new URL(evidence.path, root));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), evidence.hash, evidence.path);
  }
  const citations = citationCounts.get(row.id) ?? 0;
  row.implementation_status = implemented.evidence.length
    ? "partial_development_with_execution_evidence"
    : citations
      ? "partial_development_with_ci_evidence"
      : "unverified";
  row.test_status =
    implemented.evidence.length || citations
      ? "partial_development_evidence_not_full_acceptance"
      : "not_run_for_complete_acceptance";
  row.ci_citations = citations;
  row.implementation_paths = implemented.implementationPaths.filter((p) => existsSync(new URL(p, root)));
  row.evidence = implemented.evidence;
  row.evidence_code_revision = revision;
  row.acceptance_status = requirementStatus(implemented);
  row.remaining_acceptance_blockers = implemented.blockers;
  row.work_items = workItemsForRequirement(row.id);
}
register.specification_baseline_status ??= register.status;
register.status = "partial_development_not_release_accepted";
register.execution_register = {
  generatedAt: new Date().toISOString(),
  codeRevision: revision,
  formalRequirements: 127,
  sourceRegister: "docs/registers/requirements.json",
  rowsWithPartialExecutionEvidence: register.requirements.filter((r) => (r.evidence as unknown[]).length > 0)
    .length,
  rowsWithCiCitations: register.requirements.filter((r) => (r.ci_citations as number) > 0).length,
  r1Accepted: false,
  r2Accepted: false,
  publicLaunchEnabled: false,
  livePaymentsEnabled: false,
  note: "Exact source requirements/criteria are preserved. Partial test evidence, from evidence files or from tests cited in docs/registers/ci-evidence.json (decision 0010), is not full requirement, gate or operational approval.",
};
await writeFile(path, JSON.stringify(register, null, 2) + "\n");
console.log(JSON.stringify(register.execution_register, null, 2));
