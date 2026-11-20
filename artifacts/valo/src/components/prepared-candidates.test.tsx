import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { StaffPreparedCandidate } from "@workspace/api-client-react";
import { PreparedCandidates } from "./prepared-candidates";

// The staff Content area lists templates awaiting their two reviews (decision 0014), which
// are private files rather than content versions. Synthetic records only.
const candidate = (change: Partial<StaffPreparedCandidate> = {}): StaffPreparedCandidate => ({
  artifactId: "00000000-0000-4000-8000-00000000a001",
  artifactHash: "a".repeat(64),
  versionId: "00000000-0000-4000-8000-00000000b001",
  templateId: "TPL-12",
  version: 1,
  preparedAt: "2026-11-19T10:00:00.000Z",
  reviewBy: "2027-05-19T00:00:00.000Z",
  state: "awaiting_reviews",
  savedStatus: null,
  ...change,
});

test("each prepared template shows where it stands and the reference an operator passes on", () => {
  const html = renderToStaticMarkup(
    <PreparedCandidates
      candidates={[
        candidate(),
        candidate({
          artifactId: "00000000-0000-4000-8000-00000000a002",
          templateId: "TPL-07",
          state: "saved",
          savedStatus: "published",
        }),
        candidate({ artifactId: "00000000-0000-4000-8000-00000000a003", state: "expired" }),
        candidate({ artifactId: "00000000-0000-4000-8000-00000000a004", state: "version_taken" }),
      ]}
    />,
  );
  assert.match(html, /Templates awaiting their reviews/);
  assert.match(html, /TPL-12 · version 1/);
  assert.match(html, /Awaiting its two reviews · Prepared 19\/11\/2026 · Review by 19\/05\/2027/);
  assert.match(html, /Saved as a published version/);
  assert.match(html, /Review date passed; prepare it again/);
  assert.match(html, /Another candidate was saved under this version number; prepare it again/);
  assert.ok(html.includes(`--candidate=00000000-0000-4000-8000-00000000a001:${"a".repeat(64)}`));
  assert.equal((html.match(/<li /g) ?? []).length, 4);
});

test("with nothing prepared the section says so", () => {
  const html = renderToStaticMarkup(<PreparedCandidates candidates={[]} />);
  assert.match(html, /No prepared templates\./);
  assert.ok(!html.includes("--candidate="));
});
