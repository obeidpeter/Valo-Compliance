import assert from "node:assert/strict";
import { test } from "node:test";
import { assess } from "@workspace/valo-core";
import { evaluationDate, ruleEvaluationFixtures } from "./rule-evaluation-fixtures";

// CMP-007: "stale or unresolved numeric rules cannot generate definite recommendations or new
// statutory reminders; show an uncertainty notice and official route."
const STALE = "Evidence is stale or not yet checked";
const CONFLICT = "Conflicting released versions require editorial resolution";

test("a rule held for stale or conflicting evidence gives no recommendation, says why it is held and keeps the official route", () => {
  const seen: Record<string, number> = { [STALE]: 0, [CONFLICT]: 0 };
  for (const f of ruleEvaluationFixtures) {
    if (f.expected !== "held") continue;
    const result = assess(f.facts, f.rules, f.asOfDate, evaluationDate, { fixtureMode: f.fixtureMode });
    for (const reason of [STALE, CONFLICT]) {
      const held = [...new Set(f.rules.map((r) => r.id))].filter((id) =>
        result.gaps.includes(`${id}: ${reason}`),
      );
      if (!held.length) continue;
      seen[reason]!++;
      for (const id of held)
        assert.ok(!result.items.some((item) => item.ruleId === id), `${f.id} recommends held rule ${id}`);
      // Nothing to act on: no source-backed recommendation and no suggested document or task.
      assert.equal(result.sourceBackedRecommendations, 0, f.id);
      assert.deepEqual(result.recommendedTemplateIds, [], f.id);
      assert.ok(result.officialRoutes.length > 0, `${f.id} names an official route`);
      for (const route of result.officialRoutes)
        assert.match(route.url, /^https:\/\/[a-z0-9.-]+\.gov\.ng\//, f.id);
      assert.match(result.notice, /not legal certification/, f.id);
    }
  }
  assert.ok(seen[STALE]! >= 3, `${seen[STALE]} scenarios held for stale evidence`);
  assert.ok(seen[CONFLICT]! >= 1, `${seen[CONFLICT]} scenarios held for conflicting versions`);
});
