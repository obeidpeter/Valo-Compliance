import assert from "node:assert/strict";
import { test } from "node:test";
import {
  apiImportGraph,
  cycleViolations,
  importCycles,
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
      "artifacts/api-server/src/lib/valo-exports.ts",
      "workspaceActorFromRecord({ workspaceId, identityId })",
    ),
    0,
  );
  assert.equal(
    flagged("artifacts/api-server/src/lib/valo-exports.ts", "insert({ id, workspaceId, ...values })"),
    0,
    "rows that spread other values are not actors",
  );
});

test("only resolveWorkspace issues actors from memberships, and no code redirects an actor", () => {
  const lib = "artifacts/api-server/src/lib/valo-tasks.ts";
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
  assert.equal(workspaceActorViolations("artifacts/api-server/src/lib/valo-tasks.ts", scoped).length, 1);
  assert.equal(workspaceActorViolations("artifacts/api-server/src/routes/valo.ts", scoped).length, 1);
  for (const entry of WORKSPACE_SCOPE_ENTRIES)
    assert.equal(workspaceActorViolations(entry, scoped).length, 0);
});

test("the repository has no silent catches and no import cycles", () => {
  assert.deepEqual(silentCatchReport(), []);
  assert.deepEqual(workspaceActorReport(), []);
  const graph = apiImportGraph();
  assert.ok(graph.size > 100, "the API import graph was actually read");
  assert.deepEqual(importCycles(graph), []);
  assert.deepEqual(cycleViolations(graph), []);
});
