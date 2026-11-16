import assert from "node:assert/strict";
import { test } from "node:test";
import {
  KNOWN_CYCLES,
  apiImportGraph,
  cycleViolations,
  importCycles,
  silentCatchReport,
  silentCatchViolations,
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

test("new import cycles fail while recorded cycles are tolerated", () => {
  const graph = new Map([
    ["a.ts", new Set(["b.ts"])],
    ["b.ts", new Set(["a.ts"])],
    ["c.ts", new Set<string>()],
  ]);
  assert.deepEqual(importCycles(graph), [["a.ts", "b.ts"]]);
  assert.equal(cycleViolations(graph).length, 1);
});

test("the repository has no silent catches and no new import cycles", () => {
  assert.deepEqual(silentCatchReport(), []);
  const graph = apiImportGraph();
  assert.ok(graph.size > 100, "the API import graph was actually read");
  assert.deepEqual(cycleViolations(graph), []);
  // Recorded cycles must still exist exactly; remove an entry once its cycle is broken.
  const actual = new Set(importCycles(graph).map((cycle) => cycle.join("|")));
  for (const known of KNOWN_CYCLES) assert.ok(actual.has([...known].sort().join("|")), known.join(" -> "));
});
