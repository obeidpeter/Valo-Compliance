import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const namespace = "valo-native-proof-11111111-1111-4111-8111-111111111111";
const prefix = "private/" + namespace + "/";
const key = "valo/development/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333.pdf";
const preload =
  "data:text/javascript," +
  encodeURIComponent(`
  import {mock} from 'node:test';import {writeFileSync} from 'node:fs';
  const calls=[],objects=JSON.parse(process.env.PROOF_OBJECTS);
  process.on('exit',()=>writeFileSync(process.env.PROOF_TRACE,JSON.stringify(calls)));
  mock.module(${JSON.stringify(import.meta.resolve("@replit/object-storage"))},{namedExports:{Client:class{
    constructor(){calls.push({operation:'construct'});}
    async list(options){calls.push({operation:'list',prefix:options.prefix});return {ok:true,value:[...objects]};}
    async delete(name){calls.push({operation:'delete',name});objects.splice(objects.findIndex(x=>x.name===name),1);return {ok:true,value:null};}
  }}});
`);
function run(overrides = {}, objects = [], action = "cleanup") {
  const dir = mkdtempSync(join(tmpdir(), "valo-native-scope-")),
    trace = join(dir, "trace.json");
  try {
    const env = {
      NODE_ENV: "development",
      VALO_RUN_DB_TESTS: "synthetic-development-only",
      PRIVATE_OBJECT_DIR: "test-bucket/" + prefix,
      VALO_NATIVE_PROOF_NAMESPACE: namespace,
      PROOF_OBJECTS: JSON.stringify(objects),
      PROOF_TRACE: trace,
      ...overrides,
    };
    const result = spawnSync(
      process.execPath,
      [
        "--experimental-test-module-mocks",
        "--import",
        preload,
        fileURLToPath(new URL("./native-proof-namespace.mjs", import.meta.url)),
        action,
      ],
      { env, encoding: "utf8", timeout: 10000 },
    );
    assert.ifError(result.error);
    return { status: result.status, calls: JSON.parse(readFileSync(trace, "utf8")) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
test("unsafe native proof modes reject before any SDK construction", () => {
  const cases = [
    { NODE_ENV: "production" },
    { NODE_ENV: "test" },
    { NODE_ENV: "" },
    { VALO_RUN_DB_TESTS: "" },
    { CI: "true" },
    ...["1", "true", "false", "arbitrary"].map((REPLIT_DEPLOYMENT) => ({ REPLIT_DEPLOYMENT })),
    { REPLIT_DEPLOYMENT_REGION: "arbitrary" },
    { PRIVATE_OBJECT_DIR: "test-bucket/private/not-this-run" },
    { PRIVATE_OBJECT_DIR: "" },
    { VALO_NATIVE_PROOF_NAMESPACE: "../outside" },
  ];
  for (const env of cases) {
    const r = run(env);
    assert.notEqual(r.status, 0);
    assert.deepEqual(r.calls, []);
  }
  const invalidAction = run({}, [], "delete-everything");
  assert.notEqual(invalidAction.status, 0);
  assert.deepEqual(invalidAction.calls, []);
});
test("namespace cleanup prevalidates an entire page before deleting", () => {
  for (const foreign of ["another-run/" + key, prefix + "unexpected.txt", prefix + "../outside.pdf"]) {
    const r = run({}, [{ name: prefix + key }, { name: foreign }]);
    assert.notEqual(r.status, 0);
    assert.ok(r.calls.some((x) => x.operation === "list"));
    assert.equal(r.calls.filter((x) => x.operation === "delete").length, 0);
  }
});
test("only exact scoped keys are removed and an empty recheck completes", () => {
  const r = run({}, [{ name: prefix + key }]);
  assert.equal(r.status, 0);
  assert.deepEqual(
    r.calls.filter((x) => x.operation === "delete"),
    [{ operation: "delete", name: prefix + key }],
  );
  assert.ok(r.calls.filter((x) => x.operation === "list").every((x) => x.prefix === prefix));
});
test("freshness probe never deletes a nonempty namespace", () => {
  const r = run({}, [{ name: prefix + key }], "verify-empty");
  assert.notEqual(r.status, 0);
  assert.equal(r.calls.filter((x) => x.operation === "delete").length, 0);
});
