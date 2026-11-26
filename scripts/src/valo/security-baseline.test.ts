import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { requirements } from "@workspace/valo-records";
import { repositoryRoot } from "./architecture-check";
import { readCitations } from "./ci-evidence";
import { WORKFLOW } from "./database-tests";

/**
 * The security baseline (docs/architecture/security-baseline.md). The specification, in its section on
 * security: "Use OWASP ASVS Level 2 as the proposed application-security verification baseline. Map
 * applicable controls to evidence; do not claim certification merely because a scanner was run." The
 * register maps each requirement of OWASP ASVS 5.0.0 at Levels 1 and 2 to Valo's control, the code that
 * holds it and the evidence CI runs on every merge, or to the gap that is left or the reason it does not
 * apply. This check keeps the map true to the standard's list and to the repository. Whether a control
 * meets its requirement it cannot judge: that is for the independent assessor.
 */
const REGISTER = "docs/registers/security-baseline.json";
const DESIGN = "docs/architecture/security-baseline.md";
/**
 * The SHA-256 of the standard's Level 1 and 2 requirements, one line each of "<identifier> <level>" in the
 * standard's order, as its own file at the register's source lists them. The design says how to recompute it.
 */
const STANDARD_LIST = "c221cc01ef8fef1236787852eaaffe3e41baaa66b99534975cf9ccc3f62e5b4a";
const STATUSES = [
  "met",
  "partly met",
  "untested",
  "not met",
  "not applicable",
  "identity provider",
  "host",
] as const;
type Status = (typeof STATUSES)[number];
type Entry = {
  id: string;
  level: number;
  status: Status;
  bears_on?: string[];
  control?: string;
  code?: string[];
  tests?: { file: string; test: string }[];
  checks?: { job: string; step: string }[];
  gap?: string;
  reason?: string;
};
type Register = {
  standard: { name: string; version: string; levels: number[]; source: string; sha256: string };
  statuses: Record<string, string>;
  requirements: Entry[];
};

const read = (file: string) => readFileSync(join(repositoryRoot, file), "utf8");
const register = () => JSON.parse(read(REGISTER)) as Register;
const filled = (text: string | undefined) => typeof text === "string" && text.trim().length > 0;

/** What is wrong with one entry, if anything, against the evidence register and the workflow. */
function entryProblems(
  entry: Entry,
  cited: ReadonlySet<string>,
  steps: (job: string) => readonly string[],
  known: ReadonlySet<string>,
): string[] {
  const found: string[] = [];
  const at = (problem: string) => found.push(`${entry.id}: ${problem}`);
  const evidence = (entry.tests?.length ?? 0) + (entry.checks?.length ?? 0);
  const code = entry.code ?? [];
  if (!STATUSES.includes(entry.status)) at(`its status "${entry.status}" is not one the register defines`);
  if (entry.status === "met" && !(filled(entry.control) && code.length && evidence))
    at("is met but lacks its control, its code or the evidence CI runs");
  if (entry.status === "met" && (filled(entry.gap) || filled(entry.reason)))
    at("is met but names a gap or a reason");
  if (
    (entry.status === "partly met" || entry.status === "untested") &&
    !(filled(entry.control) && code.length && filled(entry.gap))
  )
    at(`is ${entry.status} but lacks its control, its code or its gap`);
  if (entry.status === "untested" && evidence) at("is untested but cites evidence");
  if (entry.status === "not met" && !filled(entry.gap)) at("is not met but names no gap");
  if (
    (entry.status === "not applicable" || entry.status === "identity provider" || entry.status === "host") &&
    !filled(entry.reason)
  )
    at(`is ${entry.status} but gives no reason`);
  if (entry.status !== "not applicable" && !entry.bears_on?.length)
    at("bears on none of Valo's requirements");
  for (const id of entry.bears_on ?? [])
    if (!known.has(id)) at(`bears on ${id}, which the register does not hold`);
  for (const place of code) {
    const [path, symbol] = place.split("#");
    const full = join(repositoryRoot, path!);
    if (!existsSync(full)) at(`names ${path}, which does not exist`);
    else if (symbol && (statSync(full).isDirectory() || !readFileSync(full, "utf8").includes(symbol)))
      at(`names ${symbol} in ${path}, which does not hold it`);
  }
  for (const { file, test: name } of entry.tests ?? [])
    if (!cited.has(`${file}\n${name}`))
      at(
        `cites "${name}" in ${file}, which the CI evidence register does not cite, so CI does not check it passed`,
      );
  for (const { job, step } of entry.checks ?? [])
    if (!steps(job).includes(step)) at(`cites the step "${step}", which the ${job} job does not run`);
  for (const field of ["control", "gap", "reason"] as const)
    if (/\bVerify that\b/.test(entry[field] ?? "")) at(`its ${field} copies the standard's words`);
  return found;
}

function workflowSteps(text: string) {
  const workflow = parse(text) as { jobs?: Record<string, { steps?: { name?: string }[] }> };
  return (job: string) => (workflow.jobs?.[job]?.steps ?? []).map((step) => step.name ?? "");
}

test("every OWASP ASVS 5.0.0 Level 1 and 2 requirement is mapped to Valo's control, with its code and the evidence CI runs, or with its gap or reason", () => {
  const { standard, statuses, requirements: entries } = register();
  assert.equal(standard.name, "OWASP Application Security Verification Standard");
  assert.equal(standard.version, "5.0.0");
  assert.deepEqual(standard.levels, [1, 2]);
  assert.match(standard.source, /^https:\/\/github\.com\/OWASP\/ASVS\/raw\/v5\.0\.0\//);
  assert.match(standard.sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(Object.keys(statuses), [...STATUSES]);
  assert.ok(
    entries.every((entry) => /^v5\.0\.0-\d+\.\d+\.\d+$/.test(entry.id) && [1, 2].includes(entry.level)),
    "an entry is not named as v5.0.0-<chapter>.<section>.<requirement> at Level 1 or 2",
  );
  const list = entries.map((entry) => `${entry.id.slice("v5.0.0-".length)} ${entry.level}\n`).join("");
  assert.equal(
    createHash("sha256").update(list).digest("hex"),
    STANDARD_LIST,
    "the register's requirements are not the standard's Level 1 and 2 requirements, in its order",
  );
  assert.equal(entries.length, 253);

  const cited = new Set(readCitations().map((citation) => `${citation.file}\n${citation.test}`));
  const known = new Set(requirements.map((requirement) => requirement.id));
  const steps = workflowSteps(read(WORKFLOW));
  assert.deepEqual(
    entries.flatMap((entry) => entryProblems(entry, cited, steps, known)),
    [],
  );

  // The design gives the same count for each status, and names each requirement that is not met.
  const design = read(DESIGN);
  for (const status of STATUSES) {
    const count = entries.filter((entry) => entry.status === status).length;
    assert.ok(
      design.includes(`| ${status} | ${count} |`),
      `the design does not count ${count} requirements as ${status}`,
    );
  }
  for (const entry of entries.filter((each) => each.status === "not met"))
    assert.ok(design.includes(entry.id), `the design does not name ${entry.id}, which is not met`);
});

test("the security baseline's check finds an entry that claims more than its evidence shows", () => {
  const cited = new Set(["artifacts/a.test.ts\na cited test"]);
  const steps = workflowSteps("jobs:\n  foundation:\n    steps:\n      - name: A step CI runs\n");
  const known = new Set(["SEC-003"]);
  const base = { id: "v5.0.0-1.2.3", level: 1, bears_on: ["SEC-003"], code: ["package.json"] };
  const problems = (entry: Entry) => entryProblems(entry, cited, steps, known);
  assert.deepEqual(problems({ ...base, status: "met", control: "Valo does it." }), [
    "v5.0.0-1.2.3: is met but lacks its control, its code or the evidence CI runs",
  ]);
  assert.deepEqual(
    problems({
      ...base,
      status: "met",
      control: "Valo does it.",
      tests: [{ file: "artifacts/a.test.ts", test: "a test CI never ran" }],
      checks: [{ job: "foundation", step: "A step CI does not run" }],
    }),
    [
      'v5.0.0-1.2.3: cites "a test CI never ran" in artifacts/a.test.ts, which the CI evidence register does not cite, so CI does not check it passed',
      'v5.0.0-1.2.3: cites the step "A step CI does not run", which the foundation job does not run',
    ],
  );
  assert.deepEqual(
    problems({
      ...base,
      status: "met",
      control: "Valo does it.",
      code: ["package.json#noSuchSymbol", "no/such/file.ts"],
      tests: [{ file: "artifacts/a.test.ts", test: "a cited test" }],
    }),
    [
      "v5.0.0-1.2.3: names noSuchSymbol in package.json, which does not hold it",
      "v5.0.0-1.2.3: names no/such/file.ts, which does not exist",
    ],
  );
  assert.deepEqual(
    problems({
      ...base,
      status: "untested",
      control: "Verify that Valo does it.",
      gap: "No test.",
      checks: [{ job: "foundation", step: "A step CI runs" }],
    }),
    ["v5.0.0-1.2.3: is untested but cites evidence", "v5.0.0-1.2.3: its control copies the standard's words"],
  );
  assert.deepEqual(problems({ ...base, status: "host", bears_on: ["SEC-999"] }), [
    "v5.0.0-1.2.3: is host but gives no reason",
    "v5.0.0-1.2.3: bears on SEC-999, which the register does not hold",
  ]);
});

/** The rules the baseline counts on the linter to enforce (1.2.2, 1.3.2 and 3.2.2). */
const LINT_RULES = [
  "no-eval",
  "no-implied-eval",
  "typescript/no-implied-eval",
  "react/no-danger",
  "react/no-danger-with-children",
  "react/jsx-no-script-url",
];

test("the linter CI runs refuses the code the security baseline counts on it to refuse", () => {
  // The configuration oxlint applies, its categories' rules included, as the lint step runs it.
  const config = JSON.parse(
    execFileSync(join(repositoryRoot, "node_modules/.bin/oxlint"), ["--print-config"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    }),
  ) as { rules: Record<string, unknown> };
  const severity = (rule: string) => {
    const value = config.rules[rule];
    return Array.isArray(value) ? value[0] : value;
  };
  for (const rule of LINT_RULES)
    assert.ok(["deny", "error"].includes(String(severity(rule))), `the linter does not refuse ${rule}`);
});

/** The parameters an operation takes in its path or query whose names say they carry a secret. */
function secretAddressParameters(contractText: string): string[] {
  type Parameter = { name?: string; in?: string; $ref?: string };
  const contract = parse(contractText) as {
    paths?: Record<string, Record<string, { parameters?: Parameter[] } | Parameter[]>>;
    components?: { parameters?: Record<string, Parameter> };
  };
  const resolved = (parameter: Parameter) =>
    parameter.$ref ? (contract.components?.parameters?.[parameter.$ref.split("/").at(-1)!] ?? {}) : parameter;
  const secret =
    /token|secret|password|passphrase|api[-_]?key|^key$|credential|session|signature|^otp$|^code$/i;
  const found: string[] = [];
  for (const [path, item] of Object.entries(contract.paths ?? {}))
    for (const [method, operation] of Object.entries(item)) {
      const parameters = Array.isArray(operation) ? operation : (operation.parameters ?? []);
      for (const parameter of parameters.map(resolved))
        if ((parameter.in === "path" || parameter.in === "query") && secret.test(parameter.name ?? ""))
          found.push(`${method.toUpperCase()} ${path}: ${parameter.in} ${parameter.name}`);
    }
  return found;
}

test("no operation in the API contract takes a token, key, secret or password in its address", () => {
  assert.deepEqual(secretAddressParameters(read("lib/api-spec/openapi.yaml")), []);
  // The check can fail: a contract that takes a token in its query is found out.
  assert.deepEqual(
    secretAddressParameters(
      "paths:\n  /files/{id}:\n    get:\n      parameters:\n        - { name: id, in: path }\n        - { name: accessToken, in: query }\n",
    ),
    ["GET /files/{id}: query accessToken"],
  );
});
