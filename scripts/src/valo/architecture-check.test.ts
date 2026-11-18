import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FINITE_WORK_BINDING_ENTRIES,
  apiImportGraph,
  cycleViolations,
  importCycles,
  inferenceBindingReport,
  inferenceBindingViolations,
  moduleBoundaryViolations,
  silentCatchReport,
  silentCatchViolations,
  WORKSPACE_SCOPE_ENTRIES,
  workspaceActorReport,
  workspaceActorViolations,
} from "./architecture-check";

test("an empty catch needs a comment; a catch that handles the error does not", () => {
  const flagged = silentCatchViolations("a.ts", "try { work(); } catch {}\n");
  assert.equal(flagged.length, 1);
  assert.match(flagged[0]!, /^a\.ts:1 silent-catch /);
  assert.deepEqual(
    silentCatchViolations("b.ts", "try { work(); } catch {\n  // Expected: retried below.\n}\n"),
    [],
  );
  assert.deepEqual(silentCatchViolations("c.ts", "try { work(); } catch { failed++; }\n"), []);
  assert.deepEqual(silentCatchViolations("d.ts", "try { work(); } catch (error) { throw error; }\n"), []);
});

test("an empty promise rejection handler needs a comment on its statement", () => {
  assert.equal(silentCatchViolations("e.ts", "void job().catch(() => {});\n").length, 1);
  assert.equal(silentCatchViolations("f.ts", "const v = await res.json().catch(() => null);\n").length, 1);
  assert.deepEqual(
    silentCatchViolations("g.ts", "// Best-effort cleanup.\nawait unlink(path).catch(() => {});\n"),
    [],
  );
  assert.deepEqual(silentCatchViolations("h.ts", "void job().catch((error) => log(error));\n"), []);
});

test("an import cycle fails", () => {
  const graph = new Map([
    ["a.ts", new Set(["b.ts"])],
    ["b.ts", new Set(["a.ts"])],
    ["c.ts", new Set<string>()],
  ]);
  assert.deepEqual(importCycles(graph), [["a.ts", "b.ts"]]);
  assert.equal(cycleViolations(graph).length, 1);
});

test("HTTP code cannot create, cast or redirect a workspace actor", () => {
  const route = "artifacts/api-server/src/routes/example.ts";
  const flagged = (path: string, text: string) => workspaceActorViolations(path, text).length;
  assert.match(
    workspaceActorViolations(route, "await getDocument(workspaceActorFromRecord(record), id);").join("\n"),
    /may not create a workspace actor/,
  );
  assert.equal(flagged(route, "await getDocument(res.locals.valoActor as WorkspaceActor, id);"), 1);
  assert.equal(flagged(route, "const scope = { workspaceId: req.params.workspace };"), 1);
  assert.equal(flagged("artifacts/api-server/src/lib/valo-orders-http.ts", "run({ workspaceId });"), 1);
  assert.equal(flagged(route, "await getDocument(res.locals.valoActor, req.params.id);"), 0);
  assert.equal(flagged("artifacts/api-server/src/routes/example.test.ts", "run({ workspaceId });"), 0);
  // Background work may act for a stored requester; every use re-checks membership.
  assert.equal(
    flagged(
      "artifacts/api-server/src/modules/exports/valo-exports.ts",
      "workspaceActorFromRecord({ workspaceId, identityId })",
    ),
    0,
  );
  assert.equal(
    flagged(
      "artifacts/api-server/src/modules/exports/valo-exports.ts",
      "insert({ id, workspaceId, ...values })",
    ),
    0,
    "rows that spread other values are not actors",
  );
});

test("only resolveWorkspace issues actors from memberships, and no code redirects an actor", () => {
  const lib = "artifacts/api-server/src/modules/tasks/valo-tasks.ts";
  assert.equal(workspaceActorViolations(lib, "workspaceActorFromMembership(row);").length, 1);
  assert.equal(
    workspaceActorViolations(
      "artifacts/api-server/src/lib/valo-store.ts",
      "workspaceActorFromMembership(row);",
    ).length,
    0,
  );
  assert.equal(workspaceActorViolations(lib, "const other = { ...actor, workspaceId: target };").length, 1);
  assert.equal(
    workspaceActorViolations(lib, "const other = { ...ownerActor, identityId: target };").length,
    1,
  );
  assert.equal(workspaceActorViolations(lib, "const copy = { ...res.locals.valoActor };").length, 0);
});

test("only the reviewed entries may enter a workspace scope", () => {
  const scoped = "runInWorkspaceScope(job.workspaceId, () => read(job));";
  assert.equal(
    workspaceActorViolations("artifacts/api-server/src/modules/tasks/valo-tasks.ts", scoped).length,
    1,
  );
  assert.equal(workspaceActorViolations("artifacts/api-server/src/routes/valo.ts", scoped).length, 1);
  for (const entry of WORKSPACE_SCOPE_ENTRIES)
    assert.equal(workspaceActorViolations(entry, scoped).length, 0);
});

test("only the reviewed operator commands provide the dispatcher's binding checks, and only the real ones", () => {
  const [entry] = FINITE_WORK_BINDING_ENTRIES;
  const flagged = (path: string, text: string) => inferenceBindingViolations(path, text);
  const real =
    "const { provideFiniteWorkBindings } = await import('../modules/ai');\nprovideFiniteWorkBindings(assertFiniteWorkBindings);\n";
  assert.deepEqual(flagged(entry!, real), []);
  assert.match(
    flagged("artifacts/api-server/src/lib/example.ts", real)[0]!,
    /inference-bindings only the reviewed entries/,
  );
  assert.match(
    flagged(entry!, "provideFiniteWorkBindings(async () => {});\n")[0]!,
    /provide the real assertFiniteWorkBindings/,
  );
  assert.match(
    flagged(entry!, "provideFiniteWorkBindings(assertFiniteWorkBindings, extra);\n")[0]!,
    /provide the real assertFiniteWorkBindings/,
  );
  assert.match(
    flagged(entry!, "const provide = provideFiniteWorkBindings;\n")[0]!,
    /do not pass it on or rename it/,
  );
  assert.match(
    flagged(entry!, "const { provideFiniteWorkBindings: provide } = managed;\n")[0]!,
    /do not pass it on or rename it/,
  );
  // Tests may compose the dispatcher with stand-ins, and the module defines the function.
  assert.deepEqual(
    flagged("artifacts/api-server/src/lib/example.test.ts", "provideFiniteWorkBindings(async () => {});\n"),
    [],
  );
  assert.deepEqual(
    flagged(
      "artifacts/api-server/src/modules/ai/managed-inference.ts",
      "export function provideFiniteWorkBindings() {}\n",
    ),
    [],
  );
});

test("code outside a module reaches it only through its index", () => {
  const m = "artifacts/api-server/src/modules/";
  const graph = new Map([
    ["artifacts/api-server/src/routes/a.ts", new Set([`${m}ai/index.ts`])],
    ["artifacts/api-server/src/lib/b.ts", new Set([`${m}ai/managed-inference.ts`])],
    [`${m}ai/index.ts`, new Set([`${m}ai/managed-inference.ts`])],
    [`${m}ai/managed-inference.ts`, new Set(["artifacts/api-server/src/lib/c.ts"])],
    [`${m}docs/index.ts`, new Set([`${m}ai/inference-budget.ts`])],
  ]);
  const flagged = moduleBoundaryViolations(graph);
  assert.equal(flagged.length, 2, flagged.join("\n"));
  assert.match(flagged[0]!, /lib\/b\.ts:1 module-boundary imports ai\/managed-inference\.ts/);
  assert.match(flagged[1]!, /modules\/docs\/index\.ts:1 module-boundary imports ai\/inference-budget\.ts/);
});

test("the repository has no silent catches, no import cycles and no unreviewed binding checks", () => {
  assert.deepEqual(silentCatchReport(), []);
  assert.deepEqual(workspaceActorReport(), []);
  assert.deepEqual(inferenceBindingReport(), []);
  const graph = apiImportGraph();
  assert.ok(graph.size > 100, "the API import graph was actually read");
  assert.deepEqual(importCycles(graph), []);
  assert.deepEqual(cycleViolations(graph), []);
  assert.deepEqual(moduleBoundaryViolations(graph), []);
  assert.ok(
    [...graph.keys()].some((file) => file.includes("/modules/ai/")),
    "the ai module was read",
  );
});
