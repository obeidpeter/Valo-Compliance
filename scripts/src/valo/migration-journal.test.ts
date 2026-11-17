import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
test("every reviewed SQL migration is registered in the ordered Drizzle journal", async () => {
  const base = new URL("../../../lib/db/drizzle/", import.meta.url);
  // Sequence-numbered (up to 0039) and timestamp-named migrations; the latter sort after the former.
  const files = (await readdir(base)).filter((n) => /^(\d{4}|\d{14})_.+\.sql$/.test(n)).sort();
  const journal = JSON.parse(await readFile(new URL("meta/_journal.json", base), "utf8"));
  assert.deepEqual(
    journal.entries.map((e: { tag: string }) => `${e.tag}.sql`),
    files,
  );
  for (const [index, entry] of journal.entries.entries()) {
    assert.equal(entry.idx, index);
    if (index) assert.ok(entry.when > journal.entries[index - 1].when);
  }
});
