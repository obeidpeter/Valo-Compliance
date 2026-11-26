import test from "node:test";
import assert from "node:assert/strict";
import { isReplaced, latestReleased } from "./replaced-versions";

/**
 * docs/architecture/reviewed-route.md, part 1: a reviewed template's version is replaced once a later
 * version of the same template was released, whether that one is still published or was withdrawn
 * since. A held version was never released, and replaces nothing.
 */
test("a version is replaced once a later version of its template is released, withdrawn or not", () => {
  const live = (...versions: { version: number; status: string }[]) => {
    const rows = versions.map((v) => ({ templateId: "TPL-07", ...v }));
    const latest = latestReleased(rows);
    return rows.filter((row) => row.status === "published" && !isReplaced(row, latest)).map((r) => r.version);
  };
  // A single published version is live.
  assert.deepEqual(live({ version: 1, status: "published" }), [1]);
  // A later published version replaces it.
  assert.deepEqual(live({ version: 1, status: "published" }, { version: 2, status: "published" }), [2]);
  // A later version since withdrawn still replaced it: the template has no live version.
  assert.deepEqual(live({ version: 1, status: "published" }, { version: 2, status: "withdrawn" }), []);
  // A later version that was held, or is still a candidate, was never released and replaces nothing.
  assert.deepEqual(
    live(
      { version: 1, status: "published" },
      { version: 2, status: "held" },
      { version: 3, status: "candidate" },
    ),
    [1],
  );
  // A withdrawn earlier version does not stop a later one.
  assert.deepEqual(live({ version: 1, status: "withdrawn" }, { version: 2, status: "published" }), [2]);
  // The order the versions are read in does not matter.
  assert.deepEqual(live({ version: 3, status: "published" }, { version: 1, status: "published" }), [3]);
});

test("each template is replaced only by its own later versions", () => {
  const rows = [
    { templateId: "TPL-07", version: 1, status: "published" },
    { templateId: "TPL-13", version: 2, status: "published" },
    { templateId: "TPL-13", version: 1, status: "published" },
  ];
  const latest = latestReleased(rows);
  assert.deepEqual(
    [...latest].map(([template, row]) => [template, row.version]),
    [
      ["TPL-07", 1],
      ["TPL-13", 2],
    ],
  );
  assert.deepEqual(
    rows.map((row) => isReplaced(row, latest)),
    [false, false, true],
  );
  // A template with no released version replaces nothing.
  assert.equal(isReplaced({ templateId: "TPL-40", version: 1 }, latest), false);
});
