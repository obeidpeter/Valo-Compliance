import test from "node:test";
import assert from "node:assert/strict";
import { candidateDigest, disclosure, type PublicationBundle } from "@workspace/valo-core";
import { readOperationalIntake } from "./operational-intake";
import { templateCandidate } from "./operational-content";
import { renderDocument } from "../../lib/valo-render";
import { inspectOperationalExports } from "./operational-export-inspection";

test("additional operational forms render their complete final canonical bytes in DOCX and PDF", async () => {
  // Actual local readers/renderers, not native private-storage or publication proof.
  for (const id of [
    "TPL-01",
    "TPL-06",
    "TPL-09",
    "TPL-11",
    "TPL-12",
    "TPL-22",
    "TPL-24",
    "TPL-34",
    "TPL-35",
    "TPL-38",
  ]) {
    const now = new Date(),
      intake = await readOperationalIntake(id, 42);
    const source = await templateCandidate(id, 42, now, {
      original: intake.section.body,
      provenance: intake.provenance,
    });
    const raw: Omit<PublicationBundle["candidate"], "hash"> = {
      id,
      version: 42,
      body: JSON.stringify(source.document),
      contentClass: "general_template",
      jurisdiction: "NG",
      risk: "general",
      scope: source.scope,
      limitations: source.limitations,
      assumptions: ["Controlled export test only"],
      unresolvedMaterialIssues: [],
      missingEvidence: [],
      sourceCheckDate: now.toISOString(),
      reviewBy: source.reviewBy,
      disclosure,
      claims: [],
      evidenceMode: "original_operational",
      legalScopeStatus: "not_applicable",
    };
    const candidate = { ...raw, hash: candidateDigest(raw) },
      files = {
        docx: await renderDocument(source.document, "docx", 42, "template_sample"),
        pdf: await renderDocument(source.document, "pdf", 42, "template_sample"),
      };
    const report = await inspectOperationalExports(candidate, files);
    assert.equal(report.passed, true, `${id}: ${JSON.stringify(report)}`);
    const altered = { ...candidate, scope: candidate.scope + " Added claim absent from exports." };
    altered.hash = candidateDigest(altered);
    assert.equal((await inspectOperationalExports(altered, files)).passed, false, id);
  }
});
