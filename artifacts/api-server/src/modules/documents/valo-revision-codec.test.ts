import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { z } from "zod";
import { documentInput, profileInput } from "../../lib/valo-validation";
import { serializeRevisionV1 } from "./valo-revision-codec";
import { parseBoundedProviderJSON } from "../ai/provider-output-budget";
import { publicationWorkspaceRoot } from "../publication/operational-policy";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const legacy = JSON.parse(
  await readFile(
    resolve(publicationWorkspaceRoot(), "docs/valo/evidence/zod-legacy-v3-fixtures.json"),
    "utf8",
  ),
);
function jsonbOrder(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(jsonbOrder);
  if (input && typeof input === "object")
    return Object.fromEntries(
      Object.entries(input)
        .reverse()
        .map(([k, v]) => [k, jsonbOrder(v)]),
    );
  return input;
}
test("native patched schemas and frozen codec preserve all ten actual v3 document hashes", () => {
  assert.equal(legacy.actualRuntime, "3.25.76");
  assert.equal(legacy.fixtures.length, 10);
  for (const f of legacy.fixtures) {
    assert.equal(hash(JSON.stringify(documentInput.parse(f.input))), f.legacyHash);
    assert.equal(hash(serializeRevisionV1(documentInput.parse(f.input))), f.legacyHash);
    assert.equal(hash(serializeRevisionV1(documentInput.parse(jsonbOrder(f.input)))), f.legacyHash);
  }
});
test("unknown profile facts and optional marketing retain their original v3 hashes", () => {
  for (const f of legacy.profiles)
    assert.equal(hash(JSON.stringify(profileInput.parse(f.input))), f.legacyHash);
  assert.equal(profileInput.parse(legacy.profiles[0].input).profile.state, "unknown");
});
test("native patched constrained arrays reject before invoking any item validator", () => {
  let traversed = 0;
  const item = z.string().superRefine(() => {
    traversed++;
  });
  const parsed = z.array(item).max(2).safeParse(Array(10000).fill("synthetic"));
  assert.equal(parsed.success, false);
  assert.equal(traversed, 0);
  assert.equal(z.array(item).max(2).safeParse(["normal"]).success, true);
  assert.equal(traversed, 1);
});
test("provider outputs are byte/structure bounded BEFORE schema validation", () => {
  assert.deepEqual(parseBoundedProviderJSON('{"sections":[]}'), { sections: [] });
  for (const value of [{ rows: Array(257).fill("x") }, { text: "x".repeat(128 * 1024) }]) {
    assert.throws(() => parseBoundedProviderJSON(JSON.stringify(value)));
  }
  let nested: unknown = "x";
  for (let i = 0; i < 22; i++) nested = { nested };
  assert.throws(() => parseBoundedProviderJSON(JSON.stringify(nested)));
  assert.throws(() => parseBoundedProviderJSON("{not-json"));
});
