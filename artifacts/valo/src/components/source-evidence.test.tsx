import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  getGetSourceEvidenceQueryKey,
  type ReferenceEvidence,
  type SourceEvidenceRegister,
} from "@workspace/api-client-react";
import { SourceEvidence } from "./source-evidence";

const reference = (id: string, checked: string | null, reviewed: string | null): ReferenceEvidence => ({
  coordinatingNotes: [],
  titleEvidenceStatus: null,
  metadataTitle: null,
  titleWarning: null,
  id,
  title: `Synthetic official source ${id}`,
  url: `https://example.test/${id}`,
  category: "synthetic",
  baselineNotes: "Synthetic baseline note.",
  sourceLocator: "section 1",
  status: "retrieved_unreviewed",
  attemptedAt: "2026-11-01T09:00:00.000Z",
  fetchedAt: "2026-11-01T09:00:00.000Z",
  httpStatus: 200,
  failureCode: null,
  rawChecksum: "c".repeat(64),
  textChecksum: "d".repeat(64),
  rawStored: true,
  textStored: true,
  publication: "held",
  aiReviewedAt: reviewed,
  sourceCheckedAt: checked,
});

test("the source register labels each date Source checked or AI reviewed, and never claims a professional review", () => {
  const register: SourceEvidenceRegister = {
    editorialRuns: [],
    handoverSummary: "Synthetic handover summary.",
    coordinatingSummary: "Synthetic coordinating summary.",
    notice: "Synthetic notice.",
    references: [
      reference("S01", "2026-11-02T10:00:00.000Z", "2026-11-03T11:00:00.000Z"),
      reference("S02", null, null),
    ],
    retentionProposals: [],
    roadmapSections: [],
  };
  const client = new QueryClient();
  client.setQueryData(getGetSourceEvidenceQueryKey(), register);
  const html = renderToStaticMarkup(
    React.createElement(QueryClientProvider, { client }, React.createElement(SourceEvidence)),
  );
  assert.ok(
    html.includes("Source checked: 2026-11-02T10:00:00.000Z · AI reviewed: 2026-11-03T11:00:00.000Z"),
    html,
  );
  // A date that was never recorded says so, rather than implying a check or review happened.
  assert.ok(html.includes("Source checked: Not recorded · AI reviewed: Not recorded"), html);
  assert.doesNotMatch(html, /professionally reviewed|lawyer|legal review|specialist review/i);
});
