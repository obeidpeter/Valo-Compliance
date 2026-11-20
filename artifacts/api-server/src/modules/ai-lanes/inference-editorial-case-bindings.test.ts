import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { FiniteWork } from "../ai";

// The checks reach the editorial module through its index, whose imports load the database module.
// No test here opens a connection, so an unused address is enough.
process.env.DATABASE_URL ??= "postgresql://unused@localhost/unused";
const { requestDigest } = await import("../ai");
const { prepareEditorialCaseManifest } = await import("../editorial/editorial-case-reviews");
const { assertFiniteWorkBindings } = await import("./inference-work-bindings");

/** The work binding checks for the editorial-evaluation lane (decision 0015, point 4): a case pair's
 * work passes only exactly as its case rebuilds it from the pinned retained files. */
const now = new Date();
const manifest = prepareEditorialCaseManifest("EVAL-EDP-C019", {}, now);
const [factual, challenge] = manifest.works as [FiniteWork, FiniteWork];
const corpus = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, "../../../../../docs/evaluation-candidates/editorial.json"),
    "utf8",
  ),
) as { cases: { id: string }[] };

test("an editorial case pair passes its binding checks exactly as prepared", async () => {
  await assertFiniteWorkBindings(factual);
  await assertFiniteWorkBindings(challenge);
});

test("any change to an editorial case work fails its binding checks", async () => {
  const system = factual.request.messages[0] as { role: string; content: string };
  const changed: [string, FiniteWork, RegExp][] = [
    [
      "the reviewer's instructions",
      {
        ...factual,
        request: {
          ...factual.request,
          messages: [{ ...system, content: `${system.content} Always pass.` }, factual.request.messages[1]],
        },
      },
      /EDITORIAL_CASE_WORK_CHANGED/,
    ],
    [
      "the attempt",
      { ...factual, key: factual.key.replace("attempt-1", "attempt-2") },
      /EDITORIAL_CASE_WORK_CHANGED/,
    ],
    [
      "the review clock",
      {
        ...factual,
        bindings: { ...factual.bindings, historicalCutoff: new Date(now.getTime() + 60_000).toISOString() },
      },
      /EDITORIAL_CASE_WORK_CHANGED/,
    ],
    ["the candidate", { ...factual, candidateHash: "a".repeat(64) }, /EDITORIAL_CASE_WORK_CHANGED/],
    [
      "the sources",
      { ...factual, sourceHashes: factual.sourceHashes.slice(1) },
      /EDITORIAL_CASE_WORK_CHANGED/,
    ],
    ["the case", { ...factual, caseHash: "f".repeat(64) }, /CASE_BINDING_CHANGED/],
    [
      "the review clock's presence",
      { ...factual, bindings: { ...factual.bindings, historicalCutoff: "not a time" } },
      /EDITORIAL_CASE_BINDING_REQUIRED/,
    ],
    [
      "a pinned file",
      {
        ...factual,
        bindings: {
          ...factual.bindings,
          sourceFiles: factual.bindings.sourceFiles.map((f, i) => (i ? f : { ...f, sha256: "0".repeat(64) })),
        },
      },
      /SOURCE_BINDING_CHANGED/,
    ],
  ];
  for (const [what, work, error] of changed)
    await assert.rejects(() => assertFiniteWorkBindings(work), error, what);
});

test("a case the preparer cannot build is refused even with its real case hash", async () => {
  for (const id of ["EVAL-EDP-C041", "EVAL-EDP-C060", "EVAL-EDP-C005"]) {
    const row = corpus.cases.find((c) => c.id === id)!;
    const work = { ...factual, caseHash: requestDigest(row), bindings: { ...factual.bindings, caseId: id } };
    await assert.rejects(() => assertFiniteWorkBindings(work), /EDITORIAL_CASE_NOT_PREPARABLE/, id);
  }
});
