import { readFile } from "node:fs/promises";
import { pool } from "@workspace/db";
import {
  applyStoredRuleRelease,
  planStoredRuleRelease,
  type RuleReleaseRequest,
} from "../lib/valo-rule-release";

/**
 * Operator command, development only (ADM-004). Plans or applies the release of a rule version from
 * the request file the editorial pipeline wrote:
 *
 *   NODE_ENV=development pnpm --filter @workspace/api-server exec tsx src/scripts/rule-release.ts plan <request.json>
 *   NODE_ENV=development pnpm --filter @workspace/api-server exec tsx src/scripts/rule-release.ts apply <request.json> --confirm <manifest hash>
 *
 * `plan` changes nothing and prints counts only, never a customer's answers.
 */
const [mode, file, flag, confirmation] = process.argv.slice(2);
try {
  if ((mode !== "plan" && mode !== "apply") || !file)
    throw new Error("usage: rule-release.ts plan|apply <request.json> [--confirm <manifest hash>]");
  const request = JSON.parse(await readFile(file, "utf8")) as RuleReleaseRequest;
  if (mode === "plan") {
    const plan = await planStoredRuleRelease(request);
    process.stdout.write(
      `${JSON.stringify({
        decision: plan.decision,
        reasons: plan.reasons,
        scenarios: plan.scenarios,
        profilesChecked: plan.affected.profiles,
        profilesChanged: new Set(plan.affected.changes.map((c) => c.profile)).size,
      })}\n`,
    );
    if (plan.decision !== "ready") process.exitCode = 1;
  } else {
    if (flag !== "--confirm" || !confirmation) throw new Error("apply needs --confirm <manifest hash>");
    process.stdout.write(`${JSON.stringify(await applyStoredRuleRelease(request, confirmation))}\n`);
  }
} finally {
  await pool.end();
}
