import assert from "node:assert/strict";
import { test } from "node:test";
import type { AssessmentItem, SavedAssessment } from "@workspace/api-client-react";
import { EMPTY_FACTS } from "./checker";
import {
  filterSavedAssessments,
  trackedRuleIdsForAssessment,
  untrackedActionableItems,
} from "./assessment-tasks";

const baseItem = (
  ruleId: string,
  overrides: { label?: string; sourceLinkedTaskEligible?: boolean } = {},
): AssessmentItem =>
  ({
    ruleId,
    ruleVersion: 1,
    requirementVersionId: "req-" + ruleId,
    title: "Synthetic rule " + ruleId,
    label: overrides.label ?? "Likely relevant",
    reason: "Synthetic reason",
    missingFacts: [],
    matchedFacts: ["legalForm"],
    nextStep: "Check official source",
    jurisdiction: { level: "federal" },
    sources: [],
    relatedTemplateIds: [],
    ...(overrides.sourceLinkedTaskEligible !== undefined
      ? { sourceLinkedTaskEligible: overrides.sourceLinkedTaskEligible }
      : {}),
  }) as unknown as AssessmentItem;

test("trackedRuleIdsForAssessment matches tasks linked to the result or still open", () => {
  const tracked = trackedRuleIdsForAssessment(
    [
      { assessmentId: "a-1", ruleId: "R-1", state: "completed_by_user" },
      { assessmentId: "a-old", ruleId: "R-2", state: "in_progress" },
      { assessmentId: "a-old", ruleId: "R-3", state: "completed_by_user" },
      { assessmentId: null, ruleId: null, state: "not_started" },
    ],
    "a-1",
  );
  assert.deepEqual([...tracked].sort(), ["R-1", "R-2"]);
});

test("untrackedActionableItems excludes already-tracked, non-eligible, and non-relevant rules", () => {
  const tracked = new Set(["R-1"]);
  const items = [
    baseItem("R-1"),
    baseItem("R-2"),
    baseItem("R-3", { sourceLinkedTaskEligible: false }),
    baseItem("R-4", { label: "May apply" }),
  ];
  const result = untrackedActionableItems(items, tracked);
  assert.deepEqual(
    result.map((i) => i.ruleId),
    ["R-2"],
  );
});

test("filterSavedAssessments filters by likely relevant, profile origin, and search text", () => {
  const first: SavedAssessment = {
    id: "a-1",
    createdAt: "2026-11-22T09:00:00.000Z",
    profileRevision: 3,
    facts: { ...EMPTY_FACTS, legalForm: "limited_company", state: "Lagos", lga: "Ikeja" },
    result: {
      rulesetVersion: "rules-v1",
      asOfDate: "2026-11-22",
      disclaimer: "Guidance only.",
      items: [baseItem("R-1", { label: "Likely relevant" })],
      missingQuestions: [],
    },
  };
  const second: SavedAssessment = {
    id: "a-2",
    createdAt: "2026-11-20T09:00:00.000Z",
    profileRevision: null,
    facts: { ...EMPTY_FACTS, legalForm: "sole_proprietor", state: "FCT" },
    result: {
      rulesetVersion: "rules-v1",
      asOfDate: "2026-11-20",
      disclaimer: "Guidance only.",
      items: [baseItem("R-2", { label: "May apply" })],
      missingQuestions: [],
    },
  };
  const list = [first, second];

  assert.deepEqual(
    filterSavedAssessments(list, "", "likely_relevant").map((a) => a.id),
    ["a-1"],
  );
  assert.deepEqual(
    filterSavedAssessments(list, "", "from_profile").map((a) => a.id),
    ["a-1"],
  );
  assert.deepEqual(
    filterSavedAssessments(list, "fct", "all").map((a) => a.id),
    ["a-2"],
  );
  assert.deepEqual(
    filterSavedAssessments(list, "ikeja", "all").map((a) => a.id),
    ["a-1"],
  );
});
