import assert from "node:assert/strict";
import { test } from "node:test";
import { digest } from "@workspace/valo-core";
import { regulatoryEvidence } from "./regulatory-evidence";

// EDP-011, CMP-007 (docs/architecture/guidance-currency.md, slice 1): synthetic sources only.
const page = {
  url: "https://synthetic.example/official-page",
  title: "Synthetic official page",
  locator: "Synthetic section",
  rawSha256: "a".repeat(64),
  textSha256: "b".repeat(64),
  validThrough: "2026-12-25T00:00:00.000Z",
  retrievedAt: "2026-11-25T00:00:00.000Z",
  retrieval: "official_url" as const,
};
const file = {
  url: "https://synthetic.example/official-act.pdf",
  title: "Synthetic official act",
  locator: "section 1",
  rawSha256: "c".repeat(64),
  validThrough: "2026-12-25T00:00:00.000Z",
  retrievedAt: "2026-11-25T00:00:00.000Z",
  retrieval: "official_url" as const,
};
const guide = { id: "GUD-08", title: "Synthetic guide", bodySha256: "d".repeat(64), holds: [] as string[] };

test("a check's evidence compares a web page by its words and a file by its bytes, and its evidence in bytes is what it always was", () => {
  const signed = regulatoryEvidence({ ...guide, sources: [page, file] });
  // The evidence in bytes is the digest every earlier check recorded, so guides signed before stay shown.
  assert.equal(
    signed.evidenceSha256,
    digest({
      id: guide.id,
      title: guide.title,
      bodySha256: guide.bodySha256,
      sources: [page, file].map(({ url, title, locator, rawSha256 }) => ({ url, title, locator, rawSha256 })),
      holds: [],
    }),
  );
  // The page returned other bytes with the same words: only the evidence in bytes differs.
  const sameWords = regulatoryEvidence({ ...guide, sources: [{ ...page, rawSha256: "e".repeat(64) }, file] });
  assert.notEqual(sameWords.evidenceSha256, signed.evidenceSha256);
  assert.equal(sameWords.wordsSha256, signed.wordsSha256);
  // The page's words changed, or the file's bytes did, or the check found a hold: both differ.
  for (const changed of [
    { ...guide, sources: [{ ...page, rawSha256: "e".repeat(64), textSha256: "f".repeat(64) }, file] },
    { ...guide, sources: [page, { ...file, rawSha256: "e".repeat(64) }] },
    { ...guide, sources: [page, file], holds: ["The official source could not be read."] },
    { ...guide, sources: [page, file], title: "Another synthetic guide" },
  ]) {
    const evidence = regulatoryEvidence(changed);
    assert.notEqual(evidence.evidenceSha256, signed.evidenceSha256);
    assert.notEqual(evidence.wordsSha256, signed.wordsSha256);
  }
  // When it was read and how long its amendment record runs are in neither: the reader checks those.
  assert.deepEqual(
    regulatoryEvidence({
      ...guide,
      sources: [
        { ...page, retrievedAt: "2026-11-26T00:00:00.000Z", validThrough: "2026-12-26T00:00:00.000Z" },
        file,
      ],
    }),
    signed,
  );
});
