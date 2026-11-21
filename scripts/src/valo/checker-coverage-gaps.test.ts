import assert from "node:assert/strict";
import { test } from "node:test";
import { assess } from "@workspace/valo-core";
import { evaluationDate, ruleEvaluationFixtures } from "./rule-evaluation-fixtures";

test("every checker result names its coverage gaps and the excluded high-impact sectors, and has no score", () => {
  let results = 0;
  for (const f of ruleEvaluationFixtures) {
    if (f.expected === "reject") continue;
    const result = assess(f.facts, f.rules, f.asOfDate, evaluationDate, { fixtureMode: f.fixtureMode });
    results++;
    assert.ok(
      result.gaps.includes(
        "High-impact healthcare, financial services and energy activities require activity-specific released evidence.",
      ),
      f.id,
    );
    assert.ok(
      result.gaps.some((gap) => gap.startsWith("State/FCT and LGA coverage is not comprehensive.")),
      f.id,
    );
    assert.match(result.notice, /not legal certification/, f.id);
    const keys = JSON.stringify(result).match(/"[A-Za-z]+":/g) ?? [];
    assert.deepEqual(
      keys.filter((key) => /score|percent|compliant/i.test(key)),
      [],
      f.id,
    );
  }
  assert.ok(results >= 70, `${results} scenarios produced a result`);
});
