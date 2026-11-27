import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { assertDevelopmentRuntime } from "../platform/valo-development-runtime";

/**
 * EDP-010, RUL-008 and AI-008 (decision 0016, docs/architecture/reviewer-record.md, slice 3): scores a
 * suite's kept run with the reviewer's record and prints the score with every row of the record it used,
 * by id and hash. A case counts only when its expected outcome is confirmed for its hash and, where the
 * suite cannot score it, the run is recorded as met for the case as kept; a rejected expected outcome
 * takes the case out of the score. With --export it also writes the run, the score and the rows it used,
 * as they were read, to a new file. Development only. It writes nothing to the database and accepts
 * nothing: accepting a requirement stays the owner's decision.
 *
 *   tsx src/scripts/acceptance-score.ts --corpus <editorial|checker|customer_ai> [--run <id>] [--export <file>]
 */
const usage =
  "usage: acceptance-score.ts --corpus <editorial|checker|customer_ai> [--run <id>] [--export <file>]";

export function parseScoreArguments(args: readonly string[]) {
  const options: { corpus?: string; run?: string; exportTo?: string } = {};
  for (let i = 0; i < args.length; i += 2) {
    const [flag, value] = [args[i], args[i + 1]];
    if (!value) throw new Error(usage);
    if (flag === "--corpus" && options.corpus === undefined) options.corpus = value;
    else if (flag === "--run" && options.run === undefined) options.run = value;
    else if (flag === "--export" && options.exportTo === undefined) options.exportTo = value;
    else throw new Error(usage);
  }
  if (!options.corpus) throw new Error(usage);
  return options as { corpus: string; run?: string; exportTo?: string };
}

/** Scores the run and, when asked, exports the record the score used. Returns what it prints. */
export async function scoreAcceptanceRun(options: { corpus: string; run?: string; exportTo?: string }) {
  const { acceptanceScore, isAcceptanceCorpus } = await import("../modules/acceptance-review");
  if (!isAcceptanceCorpus(options.corpus)) throw new Error(usage);
  const { run, score } = await acceptanceScore(options.corpus, options.run);
  if (options.exportTo)
    await writeFile(options.exportTo, `${JSON.stringify({ run, score }, null, 2)}\n`, { flag: "wx" });
  // The score names its run by id and hash; the printed run says who kept it and when, as well.
  const { record: _record, byCase, run: _scored, ...summary } = score;
  return {
    run,
    ...summary,
    byOutcome: Object.fromEntries(
      ["counted", "not_counted", "excluded"].map((outcome) => [
        outcome,
        byCase.filter((c) => c.outcome === outcome).map((c) => `${c.caseId}: ${c.because}`),
      ]),
    ),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  assertDevelopmentRuntime();
  const { pool } = await import("@workspace/db");
  try {
    process.stdout.write(
      `${JSON.stringify(await scoreAcceptanceRun(parseScoreArguments(process.argv.slice(2))), null, 2)}\n`,
    );
  } finally {
    await pool.end();
  }
}
