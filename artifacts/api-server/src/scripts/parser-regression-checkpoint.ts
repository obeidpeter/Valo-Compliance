import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { publicationWorkspaceRoot } from "../modules/publication";
const exec = promisify(execFile);
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
async function main() {
  if (process.env.REPLIT_DEPLOYMENT || process.env.VALO_PARSER_CHECKPOINT !== "synthetic-development-only")
    throw Error("EXPLICIT_DEVELOPMENT_FLAG_REQUIRED");
  const root = publicationWorkspaceRoot(),
    api = resolve(root, "artifacts/api-server");
  const require = createRequire(import.meta.url),
    expressRequire = createRequire(require.resolve("express"));
  const { stdout: tap } = await exec(
    process.execPath,
    ["--import", "tsx", "--test", "--test-reporter=tap", "src/lib/request-complexity.test.ts"],
    {
      cwd: api,
      timeout: 90000,
      maxBuffer: 1024 * 1024,
      env: {
        ...process.env,
        NODE_ENV: "development",
        VALO_RUN_REQUEST_BUDGET_TESTS: "synthetic-development-only",
        NO_COLOR: "1",
      },
    },
  );
  const count = (name: string) => Number(tap.match(new RegExp(`^# ${name} (\\d+)$`, "m"))?.[1] ?? NaN);
  if (!count("tests") || count("fail") !== 0 || count("skipped") !== 0)
    throw Error("TARGETED_TESTS_NOT_ALL_PASSED");
  const prod = (
    await exec("pnpm", ["--filter", "@workspace/api-server", "why", "undici", "--prod"], { cwd: root })
  ).stdout;
  const generator = (await exec("pnpm", ["--filter", "@workspace/api-spec", "why", "undici"], { cwd: root }))
    .stdout;
  const sourcePaths = [
    "artifacts/api-server/src/app.ts",
    "artifacts/api-server/src/lib/request-complexity.test.ts",
    "artifacts/api-server/src/scripts/request-budget-child.ts",
    "artifacts/api-server/src/scripts/parser-regression-checkpoint.ts",
    "lib/api-spec/package.json",
    "lib/api-spec/orval.config.ts",
    "pnpm-lock.yaml",
  ];
  const sourceHashes = Object.fromEntries(
    await Promise.all(sourcePaths.map(async (path) => [path, hash(await readFile(resolve(root, path)))])),
  );
  const prefix = resolve(root, "docs/valo/evidence/parser-regression");
  await writeFile(`${prefix}.tap.txt`, tap);
  await writeFile(`${prefix}-generator-path.txt`, generator);
  const report = {
    executedAt: new Date().toISOString(),
    scope:
      "Synthetic development process, dependency graph and repository generator configuration; no production exploit or release acceptance",
    advisory: "https://github.com/expressjs/body-parser/security/advisories/GHSA-27r3-jxmh-p828",
    express: require("express/package.json").version,
    bodyParser: expressRequire("body-parser/package.json").version,
    runtime: { node: process.version, builtinUndici: process.versions.undici },
    tests: {
      tests: count("tests"),
      passed: count("pass"),
      failed: count("fail"),
      skipped: count("skipped"),
      tapHash: hash(tap),
    },
    controls: [
      "Compressed JSON rejected before decompression",
      "API health and IPC liveness checked after every hostile/error case",
      "Normal uncompressed JSON reaches authentication and is denied exactly 401 without identity",
      "128 KiB, structural limits and malformed-JSON behavior retained",
    ],
    undici: {
      observedApiProductionDependencyPath: prod.trim() || null,
      generatorDependencyPath: generator,
      generatorUsesLocalRepositorySpec: true,
      generatorConfig: "lib/api-spec/orval.config.ts",
      generatorCodegenRepeatedInThisReport: false,
      productionFilesystemInventoryPerformed: false,
      productionExploitObserved: false,
      limitations:
        "Logical dependency/import paths are not proof that development tooling is absent from a deployed filesystem. Node built-in fetch is separately inventoried, not inferred from npm dependencies.",
    },
    sourceHashes,
    publicLaunchEnabled: false,
    livePaymentsEnabled: false,
    r1Accepted: false,
    r2Accepted: false,
  };
  await writeFile(`${prefix}.json`, JSON.stringify(report, null, 2) + "\n");
  console.log(
    JSON.stringify({
      tests: report.tests,
      express: report.express,
      bodyParser: report.bodyParser,
      runtime: report.runtime,
    }),
  );
}
main().catch((error) => {
  console.error(
    error instanceof Error && /^[A-Z_]+$/.test(error.message)
      ? error.message
      : "PARSER_REGRESSION_CHECKPOINT_FAILED",
  );
  process.exitCode = 1;
});
