import assert from "node:assert/strict";
import { test } from "node:test";
import type { AssessmentResult } from "@workspace/api-client-react";
import { formatRequirementsBrief } from "./requirements-brief";

test("formatRequirementsBrief builds a structured plain-text brief with disclaimer, grouped items, answers, and links", () => {
  const result: AssessmentResult = {
    schemaVersion: "checker-result-v1",
    asOfDate: "2026-11-18",
    rulesetVersion: "abcdef1234567890",
    items: [
      {
        ruleId: "SYNTH-01",
        ruleVersion: 2,
        requirementVersionId: "req-1",
        title: "Synthetic registration requirement",
        label: "Likely relevant",
        reason: "Business operates as a limited company.",
        missingFacts: [],
        matchedFacts: ["legalForm"],
        nextStep: "Verify status on the official portal.",
        jurisdiction: { level: "federal" },
        sources: [
          {
            id: "src-1",
            url: "https://example.test/source",
            title: "Synthetic Act",
            locator: "Section 1",
            quote: "Synthetic quote.",
            snapshotHash: "a".repeat(64),
          },
        ],
        relatedTemplateIds: [],
      },
    ],
    unanswered: [],
    gaps: ["Sector-specific municipal levies are not covered yet."],
    recommendedTemplateIds: [],
    officialRoutes: [{ title: "Synthetic Registry", url: "https://example.test/registry" }],
    notice: "Not legal advice.",
    sourceBackedRecommendations: 1,
    resultHash: "1234567890abcdef".repeat(4),
  };

  const text = formatRequirementsBrief({
    result,
    facts: { legalForm: "limited_company", state: "Lagos" },
    savedAt: "2026-11-18T09:00:00Z",
    profileRevision: 3,
  });

  assert.match(text, /Not legal, tax or accounting advice/);
  assert.match(text, /Rules version: abcdef123456/);
  assert.match(text, /\[Likely relevant — 1\]/);
  assert.match(text, /Synthetic registration requirement \(Federal, Rule SYNTH-01 v2\)/);
  assert.match(text, /https:\/\/example\.test\/source/);
  assert.match(text, /ANSWERS USED/);
  assert.match(text, /WHAT VALO DOES NOT COVER YET/);
  assert.match(text, /https:\/\/example\.test\/registry/);
});
