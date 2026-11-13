import test from "node:test";
import { ruleEvaluationFixtures,executeRuleFixture } from "./rule-evaluation-fixtures";
for(const fixture of ruleEvaluationFixtures)test(`${fixture.id}: ${fixture.name}`,()=>executeRuleFixture(fixture));
