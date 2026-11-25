import assert from "node:assert/strict";
import { test } from "node:test";
import { checkDueGuidance } from "./daily-check";

// EDP-011, CMP-007 (docs/architecture/guidance-currency.md, slice 1): the worker's guidance task, with
// its list of guides due and its check stood in. Nothing is read from an official source.
test("the guidance task checks the guide due longest, one at a time, and a check that outlasts its bound fails the run", async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  try {
    const checked: string[][] = [];
    const check = async (ids: readonly string[]) => {
      checked.push([...ids]);
      return [];
    };
    assert.equal(await checkDueGuidance({ due: async () => [], check }), null);
    assert.equal(await checkDueGuidance({ due: async () => ["GUD-08", "GUD-01"], check }), "GUD-08");
    assert.deepEqual(checked, [["GUD-08"]]);

    let finish!: () => void;
    const hanging = new Promise<void>((done) => {
      finish = done;
    });
    await assert.rejects(
      checkDueGuidance({
        boundMs: 20,
        due: async () => ["GUD-09"],
        check: async (ids) => {
          checked.push([...ids]);
          await hanging;
        },
      }),
      /GUIDANCE_CHECK_TIMEOUT/,
    );
    // While that check still runs, no other starts in this process.
    assert.equal(await checkDueGuidance({ due: async () => ["GUD-10"], check }), null);
    finish();
    await hanging;
    await new Promise((done) => setImmediate(done));
    assert.equal(await checkDueGuidance({ due: async () => ["GUD-10"], check }), "GUD-10");
    assert.deepEqual(checked, [["GUD-08"], ["GUD-09"], ["GUD-10"]]);

    // Outside development the task refuses before it reads anything.
    process.env.NODE_ENV = "production";
    await assert.rejects(checkDueGuidance({ due: async () => ["GUD-08"], check }), /development/);
    assert.equal(checked.length, 3);
  } finally {
    process.env.NODE_ENV = previous;
  }
});
