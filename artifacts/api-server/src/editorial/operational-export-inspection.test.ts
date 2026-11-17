import test, { before } from "node:test";
import assert from "node:assert/strict";
import { candidateDigest, disclosure, type PublicationBundle } from "@workspace/valo-core";
import { inventoryCandidate } from "./operational-content";
import { renderDocument } from "../lib/valo-render";
import { inspectOperationalExports, recheckOperationalExports } from "./operational-export-inspection";
import { readOperationalIntake } from "./operational-intake";
let candidate: PublicationBundle["candidate"], files: { docx: Buffer; pdf: Buffer };
before(async () => {
  const now = new Date(),
    source = await inventoryCandidate(100, now);
  const raw: Omit<PublicationBundle["candidate"], "hash"> = {
    id: "TPL-07",
    version: 100,
    body: JSON.stringify(source.document),
    contentClass: "general_template",
    jurisdiction: "NG",
    risk: "general",
    scope: source.scope,
    limitations: source.limitations,
    assumptions: ["Blank operational master"],
    unresolvedMaterialIssues: [],
    missingEvidence: [],
    sourceCheckDate: now.toISOString(),
    reviewBy: source.reviewBy,
    disclosure,
    claims: [],
    evidenceMode: "original_operational",
    legalScopeStatus: "not_applicable",
  };
  candidate = { ...raw, hash: candidateDigest(raw) };
  files = {
    docx: await renderDocument(source.document, "docx", 100, "template_sample"),
    pdf: await renderDocument(source.document, "pdf", 100, "template_sample"),
  };
});
test("actual DOCX and Chromium PDF preserve the complete exact candidate and required notices", async () => {
  const report = await inspectOperationalExports(candidate, files);
  assert.equal(report.passed, true, JSON.stringify(report));
  assert.equal(report.formats.docx.missingTextHashes.length, 0);
  assert.equal(report.formats.pdf.missingTextHashes.length, 0);
  assert.ok(report.geometry.pages > 0);
  assert.equal(report.manualWordApplicationReview, false);
  await recheckOperationalExports(candidate, files, report);
});
test("both formats must be readable; a claimed pass cannot replace re-execution", async () => {
  for (const format of ["docx", "pdf"] as const) {
    const bad = { ...files, [format]: Buffer.from(format === "pdf" ? "%PDF-corrupt" : "PK-corrupt") };
    const actual = await inspectOperationalExports(candidate, bad);
    assert.equal(actual.passed, false);
    assert.equal(actual.formats[format].parsed, false);
    await assert.rejects(
      () => recheckOperationalExports(candidate, bad, { passed: true }),
      /ATTESTATION_INVALID/,
    );
  }
});
test("altered canonical content, date/scope and forged generic reports fail", async () => {
  await assert.rejects(
    () => inspectOperationalExports({ ...candidate, hash: "0".repeat(64) }, files),
    /BINDING_INVALID/,
  );
  for (const mutation of [
    { body: candidate.body.replace("Inventory register", "Changed title") },
    { sourceCheckDate: "2026-01-01T00:00:00.000Z" },
    { scope: candidate.scope + " Altered claim not present in these files." },
    { limitations: candidate.limitations + " A different limitation." },
  ]) {
    const raw = { ...candidate, ...mutation },
      changed = { ...raw, hash: candidateDigest(raw) };
    assert.equal((await inspectOperationalExports(changed, files)).passed, false);
  }
  await assert.rejects(
    () =>
      recheckOperationalExports(candidate, files, { passed: true, version: "generic-passes", checks: [] }),
    /ATTESTATION_INVALID/,
  );
});
test("revised inventory paragraphs spanning pages retain all text despite renderer footer insertion", async () => {
  const now = new Date(),
    intake = await readOperationalIntake("TPL-07", 101);
  const source = await inventoryCandidate(101, now, {
    original: intake.section.body,
    provenance: intake.provenance,
  });
  const raw = {
    ...candidate,
    version: 101,
    body: JSON.stringify(source.document),
    scope: source.scope,
    limitations: source.limitations,
    sourceCheckDate: now.toISOString(),
    reviewBy: source.reviewBy,
  };
  const c = { ...raw, hash: candidateDigest(raw) },
    actualFiles = {
      docx: await renderDocument(source.document, "docx", 101, "template_sample"),
      pdf: await renderDocument(source.document, "pdf", 101, "template_sample"),
    };
  const report = await inspectOperationalExports(c, actualFiles);
  assert.equal(report.passed, true, JSON.stringify(report));
  assert.ok(report.geometry.pages >= 2);
  assert.ok(report.readerNormalization.rendererFooterLinesIgnored >= 2);
});
