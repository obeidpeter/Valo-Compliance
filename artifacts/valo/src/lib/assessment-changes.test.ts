import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { describeAssessmentChange } from "./assessment-changes";
import { factLabel } from "./checker";

const change = {
  ruleId: "synthetic-rule",
  title: "Synthetic rule",
  change: "changed" as const,
  previousVersion: 1,
  currentVersion: 1,
  previousLabel: "More information needed",
  currentLabel: "More information needed",
  changedFacts: [] as string[],
};

// CMP-005: a comparison "explains changed recommendations".
test("a comparison explains each changed recommendation in words, naming the rule version and answers", () => {
  assert.deepEqual(
    describeAssessmentChange(
      {
        ...change,
        currentVersion: 2,
        currentLabel: "Likely relevant",
        changedFacts: ["premises", "employees"],
      },
      factLabel,
    ),
    [
      "Its result changed from “More information needed” to “Likely relevant”.",
      "The rule was updated from version 1 to version 2.",
      "Your answers changed for: Operates from premises, Employees.",
    ],
  );
  assert.deepEqual(
    describeAssessmentChange(
      {
        ...change,
        change: "added",
        previousVersion: null,
        previousLabel: null,
        currentLabel: "Likely relevant",
      },
      factLabel,
    ),
    ["It is new in this result, marked “Likely relevant”."],
  );
  assert.deepEqual(
    describeAssessmentChange(
      { ...change, change: "removed", currentVersion: null, currentLabel: null },
      factLabel,
    ),
    ["It is no longer in this result. It was marked “More information needed”."],
  );
  assert.deepEqual(describeAssessmentChange(change, factLabel), [
    "Its wording, sources or next step were updated.",
  ]);
  // The saved-assessments page shows these lines for every explained change.
  const page = readFileSync(fileURLToPath(new URL("../screens/assessments.tsx", import.meta.url)), "utf8");
  assert.match(page, /Why results changed[\s\S]*describeAssessmentChange\(change, factLabel\)/);
});
