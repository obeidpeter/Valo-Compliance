import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { repositoryRoot } from "./architecture-check";

// The API contract is written as one file per module in lib/api-spec/src, and lib/api-spec/bundle.mjs
// joins them into lib/api-spec/openapi.yaml, which code generation and the tests read.

const specFolder = join(repositoryRoot, "lib/api-spec");

/** Runs the bundler on a copy of the contract's sources after `change` edits the copy. */
function build(change: (folder: string) => void, args: string[] = []) {
  const folder = mkdtempSync(join(tmpdir(), "valo-contract-"));
  try {
    for (const entry of ["bundle.mjs", "src", "openapi.yaml"])
      cpSync(join(specFolder, entry), join(folder, entry), { recursive: true });
    change(folder);
    const run = spawnSync(process.execPath, [join(folder, "bundle.mjs"), ...args], { encoding: "utf8" });
    return {
      status: run.status,
      errors: run.stderr,
      contract: readFileSync(join(folder, "openapi.yaml"), "utf8"),
    };
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}
const probePath = (name: string, schema?: string) =>
  [
    `  /synthetic-${name}:`,
    "    get:",
    `      operationId: synthetic${name.replace(/^./, (c) => c.toUpperCase())}`,
    "      responses:",
    schema
      ? `        "200": { description: ok, content: { application/json: { schema: { $ref: "#/components/schemas/${schema}" } } } }`
      : `        "200": { description: ok }`,
  ].join("\n");
const probeSchema = (name: string) =>
  `  ${name}:\n    type: object\n    properties:\n      id: { type: string }`;
const addModule = (folder: string, module: string, text: string) =>
  writeFileSync(join(folder, "src", `${module}.yaml`), `# A synthetic probe module.\n${text}\n`);

test("the contract file is what its module files build", () => {
  const run = spawnSync(process.execPath, [join(specFolder, "bundle.mjs"), "--check"], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
});

test("a new module file joins the contract, with its paths and the schemas only it uses", () => {
  const run = build((folder) =>
    addModule(
      folder,
      "zz-valid",
      `paths:\n${probePath("valid", "SyntheticValid")}\nschemas:\n${probeSchema("SyntheticValid")}`,
    ),
  );
  assert.equal(run.status, 0, run.errors);
  assert.match(run.contract, /^ {2}\/synthetic-valid:$/m);
  assert.match(run.contract, /^ {4}SyntheticValid:$/m);
});

test("the contract build refuses a path or schema defined twice and a reference to nothing", () => {
  const twice = build((folder) =>
    addModule(folder, "zz-twice", `paths:\n${probePath("twice").replace("synthetic-twice", "healthz")}`),
  );
  assert.notEqual(twice.status, 0);
  assert.match(twice.errors, /src\/zz-twice\.yaml: \/healthz is also defined in src\/platform\.yaml/);
  const schemaTwice = build((folder) => {
    addModule(
      folder,
      "zz-one",
      `paths:\n${probePath("one", "SyntheticSame")}\nschemas:\n${probeSchema("SyntheticSame")}`,
    );
    addModule(folder, "zz-two", `paths:\n${probePath("two")}\nschemas:\n${probeSchema("SyntheticSame")}`);
  });
  assert.notEqual(schemaTwice.status, 0);
  assert.match(
    schemaTwice.errors,
    /src\/zz-two\.yaml: schema SyntheticSame is also defined in src\/zz-one\.yaml/,
  );
  const missing = build((folder) =>
    addModule(folder, "zz-missing", `paths:\n${probePath("missing", "SyntheticMissing")}`),
  );
  assert.notEqual(missing.status, 0);
  assert.match(missing.errors, /refers to schema SyntheticMissing, which no file defines/);
  const response = build((folder) =>
    addModule(
      folder,
      "zz-response",
      `paths:\n${probePath("response")}\n        "429": { $ref: "#/components/responses/SyntheticMissing" }`,
    ),
  );
  assert.notEqual(response.status, 0);
  assert.match(response.errors, /refers to response SyntheticMissing, which base\.yaml does not define/);
});

test("the contract build keeps each schema with its only module, and in shared.yaml when several use it", () => {
  const borrowed = build((folder) => {
    addModule(
      folder,
      "zz-one",
      `paths:\n${probePath("one", "SyntheticOnly")}\nschemas:\n${probeSchema("SyntheticOnly")}`,
    );
    addModule(folder, "zz-two", `paths:\n${probePath("two", "SyntheticOnly")}`);
  });
  assert.notEqual(borrowed.status, 0);
  assert.match(
    borrowed.errors,
    /src\/zz-one\.yaml: schema SyntheticOnly is used by zz-one and zz-two: move it to src\/shared\.yaml/,
  );
  const lone = build((folder) => {
    appendFileSync(join(folder, "src", "shared.yaml"), `${probeSchema("SyntheticLone")}\n`);
    addModule(folder, "zz-lone", `paths:\n${probePath("lone", "SyntheticLone")}`);
  });
  assert.notEqual(lone.status, 0);
  assert.match(
    lone.errors,
    /src\/shared\.yaml: schema SyntheticLone is used by zz-lone: move it to src\/zz-lone\.yaml/,
  );
  const unused = build((folder) =>
    addModule(
      folder,
      "zz-unused",
      `paths:\n${probePath("unused")}\nschemas:\n${probeSchema("SyntheticUnused")}`,
    ),
  );
  assert.notEqual(unused.status, 0);
  assert.match(unused.errors, /schema SyntheticUnused is used by no path or response/);
});

test("the contract build refuses other sections and lines it cannot place, and the check refuses a stale contract", () => {
  const section = build((folder) =>
    addModule(folder, "zz-section", `paths:\n${probePath("section")}\ncomponents:\n  schemas: {}`),
  );
  assert.notEqual(section.status, 0);
  assert.match(section.errors, /src\/zz-section\.yaml: only paths: and schemas: belong here: components:/);
  const stray = build((folder) => addModule(folder, "zz-stray", `paths:\n${probePath("stray")}\nstray`));
  assert.notEqual(stray.status, 0);
  assert.match(stray.errors, /src\/zz-stray\.yaml: cannot place this line in paths: stray/);
  const stale = build(
    (folder) => appendFileSync(join(folder, "openapi.yaml"), "# edited by hand\n"),
    ["--check"],
  );
  assert.notEqual(stale.status, 0);
  assert.match(stale.errors, /openapi\.yaml is not what lib\/api-spec\/src builds/);
});
