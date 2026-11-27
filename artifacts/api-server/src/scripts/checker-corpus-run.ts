import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { assertDevelopmentRuntime } from "../platform/valo-development-runtime";

/**
 * RUL-008 (docs/architecture/checker-scenarios.md): runs the 80 frozen scenarios through the live
 * requirements check against the rule versions this database releases, as the check's own registry
 * admits them, and prints how many give the corpus's expected result, which do not, and which rules
 * have no released version. With --out it also writes the whole report, never over an existing file.
 * Development only. It calls no model and accepts nothing. It reads the database's released rules and
 * writes nothing there, unless --keep-for-review=<operator> asks it to keep the run for an independent
 * reviewer (docs/architecture/reviewer-record.md, slice 2), with each scenario whose result differs.
 *
 *   tsx src/scripts/checker-corpus-run.ts [--out <report.json>] [--keep-for-review=<operator>]
 */
async function main() {
  assertDevelopmentRuntime();
  const args = process.argv.slice(2);
  let out: string | undefined, keepFor: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--out" && args[i + 1] && out === undefined) out = args[++i];
    else if (arg.startsWith("--keep-for-review=") && keepFor === undefined)
      keepFor = arg.slice("--keep-for-review=".length);
    else throw new Error("usage: checker-corpus-run.ts [--out <report.json>] [--keep-for-review=<operator>]");
  }
  const [
    { db, pool },
    { CHECKER_CORPUS_PATH, corpusDifferences, releasedRegistry, runCorpusAgainstReleased },
  ] = await Promise.all([import("@workspace/db"), import("../modules/rules")]);
  try {
    const root = resolve(import.meta.dirname, "../../../..");
    const corpus = JSON.parse(await readFile(resolve(root, CHECKER_CORPUS_PATH), "utf8"));
    const now = new Date();
    const registry = await releasedRegistry(db, now);
    const runs = runCorpusAgainstReleased(corpus.cases, registry.rules, { now, trusted: registry.trusted });
    const ran = runs.flatMap((r) => ("notReleased" in r ? [] : [r]));
    const differing = ran.filter((r) => !r.matchesExpected);
    const summary = {
      evaluatedAt: now.toISOString(),
      releasedRules: registry.rules.map((r) => `${r.id}@${r.version}`),
      cases: runs.length,
      run: ran.length,
      matchingExpected: ran.length - differing.length,
      differing: differing.map((r) => ({
        caseId: r.caseId,
        live: r.live.outcome === "result" ? r.live.label : r.live.outcome,
        expected: r.expected.label,
        recorded: corpusDifferences[r.caseId]?.live ?? null,
      })),
      checksKept: ran.filter((r) => Object.values(r.checks).every(Boolean)).length,
      notReleased: [...new Set(runs.flatMap((r) => ("notReleased" in r ? [r.ruleId] : [])))],
      accepted: 0,
    };
    if (out) await writeFile(out, `${JSON.stringify({ summary, runs }, null, 2)}\n`, { flag: "wx" });
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    if (keepFor) {
      const { checkerKeptCases, corpusCases, keepAcceptanceRun } =
        await import("../modules/acceptance-review");
      const kept = await keepAcceptanceRun({
        corpus: "checker",
        operator: keepFor,
        summary: [
          `The live check on the rules this database releases, evaluated at ${summary.evaluatedAt}.`,
          `Released rules: ${summary.releasedRules.join(", ") || "none"}.`,
          `${summary.matchingExpected} of the ${summary.run} scenarios run give the corpus's expected result; ${summary.cases - summary.run} have no released rule.`,
        ],
        cases: checkerKeptCases(
          runs,
          new Map(corpusCases("checker").map((item) => [item.id, item.hash])),
          corpusDifferences,
        ),
      });
      process.stdout.write(`${JSON.stringify({ keptForReview: kept })}\n`);
    }
  } finally {
    await pool.end();
  }
}
await main();
