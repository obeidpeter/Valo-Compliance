import { readFile } from "node:fs/promises";
import { pool } from "@workspace/db";
import { assembleReviewedRuleRelease, readReviewedRuleReleaseRequest } from "../modules/ai-lanes";
import {
  applyStoredRuleRelease,
  planStoredRuleRelease,
  prepareReviewedRuleCandidate,
  type RuleReleaseRequest,
} from "../modules/editorial";
import { getPublicationArtifact } from "../modules/publication";

/**
 * Operator command, development only (ADM-004). Plans or applies the release of a rule version from
 * the request file the editorial pipeline wrote, or from the request kept for a rule reviewed on the
 * reviewed route:
 *
 *   NODE_ENV=development pnpm --filter @workspace/api-server exec tsx src/scripts/rule-release.ts plan <request.json | --request=<artifact id>:<sha256>>
 *   NODE_ENV=development pnpm --filter @workspace/api-server exec tsx src/scripts/rule-release.ts apply <request.json | --request=<artifact id>:<sha256>> --confirm <manifest hash>
 *
 * `plan` changes nothing and prints counts only, never a customer's answers.
 *
 * On the reviewed route (docs/architecture/reviewed-route.md, part 3), once `finite-inference-run.ts
 * --execute` has run a prepared rule's two reviews, `request` assembles the rule's release request from
 * that run's report and keeps it as a private artifact. It calls no model and releases nothing:
 *
 *   NODE_ENV=development pnpm --filter @workspace/api-server exec tsx src/scripts/rule-release.ts request <batch id> <result artifact id> <sha256> [--reason <what changed>]
 *
 * A version that replaces a released one needs its reason, of 20 to 1,000 characters.
 *
 * `restore` prepares a stored version of a rule, earlier than its latest, as the rule's next version
 * (ADM-004): its words, condition and calculation, with the repository's sources, claims, scenarios and
 * records, built for the reviewed route from today's captures. It is kept for its two reviews as any
 * prepared rule is, and its release request's reason names the version it restores. It calls no model:
 *
 *   NODE_ENV=development pnpm --filter @workspace/api-server exec tsx src/scripts/rule-release.ts restore <rule> <version>
 */
const usage =
  "usage: rule-release.ts plan|apply <request.json | --request=<id>:<sha256>> [--confirm <manifest hash>] | request <batch id> <result artifact id> <sha256> [--reason <text>] | restore <rule> <version>";
const [mode, ...args] = process.argv.slice(2);

/** A request named by its kept artifact, or read from a file. */
async function readRequest(named: string): Promise<RuleReleaseRequest> {
  const kept = /^--request=([a-f0-9-]{36}):([a-f0-9]{64})$/.exec(named);
  if (kept) return readReviewedRuleReleaseRequest({ id: kept[1]!, hash: kept[2]!, extension: "json" });
  return JSON.parse(await readFile(named, "utf8")) as RuleReleaseRequest;
}

try {
  if (mode === "restore") {
    const [ruleId, version, ...extra] = args;
    if (
      !ruleId ||
      !/^[a-z0-9-]{1,80}$/.test(ruleId) ||
      !version ||
      !/^[1-9][0-9]{0,5}$/.test(version) ||
      extra.length
    )
      throw new Error(usage);
    const prepared = await prepareReviewedRuleCandidate(ruleId, { restore: Number(version) });
    process.stdout.write(
      `${JSON.stringify({ ...prepared, providerCalls: 0, approvalRowsWritten: 0, publicationAccepted: false })}\n`,
    );
    if (prepared.state !== "awaiting_reviews") process.exitCode = 1;
  } else if (mode === "request") {
    const [batchId, id, hash, ...rest] = args;
    const reason = rest[0] === "--reason" && rest.length === 2 ? rest[1] : undefined;
    if (
      !batchId ||
      !/^[-a-zA-Z0-9_:]{1,160}$/.test(batchId) ||
      !id ||
      !/^[a-f0-9-]{36}$/.test(id) ||
      !hash ||
      !/^[a-f0-9]{64}$/.test(hash) ||
      (rest.length && reason === undefined)
    )
      throw new Error(usage);
    // The report `--execute` printed for the rule's two reviews.
    const report = JSON.parse((await getPublicationArtifact({ id, hash, extension: "json" })).toString()) as {
      kind?: string;
      batchId?: string;
      complete?: boolean;
      reviews?: { artifact: { id: string; hash: string; extension: "json" } }[];
    };
    if (
      report.kind !== "rule-review-run-v1" ||
      report.batchId !== batchId ||
      report.complete !== true ||
      report.reviews?.length !== 2
    )
      throw new Error("RULE_REVIEW_REPORT_INCOMPLETE");
    const assembled = await assembleReviewedRuleRelease({
      batchId,
      reviews: report.reviews.map((r) => r.artifact),
      ...(reason === undefined ? {} : { reason }),
    });
    process.stdout.write(`${JSON.stringify({ ...assembled, providerCalls: 0, released: false })}\n`);
    if (assembled.state !== "ready") process.exitCode = 1;
  } else if (mode === "plan" || mode === "apply") {
    const [named, flag, confirmation, ...extra] = args;
    if (!named || extra.length) throw new Error(usage);
    const request = await readRequest(named);
    if (mode === "plan") {
      if (flag) throw new Error(usage);
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
  } else throw new Error(usage);
} finally {
  await pool.end();
}
