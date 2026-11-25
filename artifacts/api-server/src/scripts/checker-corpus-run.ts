import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { assertDevelopmentRuntime } from "../platform/valo-development-runtime";

/**
 * RUL-008 (docs/architecture/checker-scenarios.md): runs the 80 frozen scenarios through the live
 * requirements check against the rule versions this database releases, as the check's own registry
 * admits them, and prints how many give the corpus's expected result, which do not, and which rules
 * have no released version. With --out it also writes the whole report, never over an existing file.
 * Development only. It reads and writes nothing in the database, calls no model and accepts nothing.
 *
 *   tsx src/scripts/checker-corpus-run.ts [--out <report.json>]
 */
async function main() {
  assertDevelopmentRuntime();
  const args = process.argv.slice(2);
  const out = args[0] === "--out" ? args[1] : undefined;
  if ((args.length && !out) || args.length > 2)
    throw new Error("usage: checker-corpus-run.ts [--out <report.json>]");
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
  } finally {
    await pool.end();
  }
}
await main();
