/**
 * A Node test reporter that records how every test ended, so the requirement evidence register
 * can cite tests by name (decision 0010). CI loads it through NODE_OPTIONS next to the spec
 * reporter, which keeps the usual output:
 *
 *   --test-reporter=spec --test-reporter-destination=stdout
 *   --test-reporter=<this file> --test-reporter-destination=<a regular file>
 *
 * With VALO_TEST_RESULTS_DIR set, each test run writes one JSON Lines file into that folder,
 * one line per finished test: the test file, the test's name and the names of the tests it sits
 * in (outermost first), and whether it passed, failed, was skipped or is a todo. Without it the
 * reporter records nothing. It passes nothing on, so its destination stays empty. Writing is
 * synchronous and a failed write fails the run: a missing record must not look like a pass.
 *
 * A run with Node's coverage on (code-coverage.ts, for NFR-011) also writes its merged coverage per
 * source file to a .coverage.json file, labelled with VALO_COVERAGE_AREA and VALO_COVERAGE_RUN.
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { Transform } from "node:stream";

function outcome(type, data) {
  if (data.todo !== undefined && data.todo !== false) return "todo";
  if (data.skip !== undefined && data.skip !== false) return "skip";
  return type === "test:fail" ? "fail" : "pass";
}

const directory = process.env.VALO_TEST_RESULTS_DIR;
let output;
// The names of the tests now running in each file, by nesting level.
const running = new Map();

function recordCoverage(summary) {
  mkdirSync(directory, { recursive: true });
  const files = summary.files.map((f) => ({
    path: f.path,
    lines: [f.coveredLineCount, f.totalLineCount],
    branches: [f.coveredBranchCount, f.totalBranchCount],
    functions: [f.coveredFunctionCount, f.totalFunctionCount],
  }));
  const area = process.env.VALO_COVERAGE_AREA ?? null;
  const run = process.env.VALO_COVERAGE_RUN ?? null;
  writeFileSync(
    join(directory, `${Date.now()}-${process.pid}-${randomUUID()}.coverage.json`),
    `${JSON.stringify({ area, run, files })}\n`,
  );
}

function record({ type, data }) {
  if (directory && type === "test:coverage") return recordCoverage(data.summary);
  if (!directory || (type !== "test:start" && type !== "test:pass" && type !== "test:fail")) return;
  const file = data.file ?? "";
  const names = running.get(file) ?? [];
  running.set(file, names);
  if (type === "test:start") {
    names.length = data.nesting;
    names[data.nesting] = data.name;
    return;
  }
  if (!output) {
    mkdirSync(directory, { recursive: true });
    output = join(directory, `${Date.now()}-${process.pid}-${randomUUID()}.jsonl`);
  }
  const line = {
    file,
    path: [...names.slice(0, data.nesting), data.name],
    status: outcome(type, data),
    kind: data.details?.type ?? "test",
  };
  appendFileSync(output, `${JSON.stringify(line)}\n`);
}

export default new Transform({
  writableObjectMode: true,
  transform(event, _encoding, callback) {
    try {
      record(event);
      callback();
    } catch (error) {
      callback(error);
    }
  },
});
