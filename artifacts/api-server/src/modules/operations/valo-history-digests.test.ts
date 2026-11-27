import test from "node:test";
import assert from "node:assert/strict";

// The fold is given a stand-in database; the module only names the real one, which a unit run never opens.
process.env.DATABASE_URL ??= "postgresql://unused@localhost/unused";
const { foldHistoryDigestChanges } = await import("./valo-history-digests");

type Database = NonNullable<Parameters<typeof foldHistoryDigestChanges>[0]>;

/** A stand-in database: it answers whether the changes table exists, then how many changes it removed. */
function standIn(present: boolean, removed: number) {
  const statements: unknown[] = [];
  const database = {
    execute: async (statement: unknown) => {
      statements.push(statement);
      return statements.length === 1 ? { rows: [{ present }] } : { rows: [], rowCount: removed };
    },
  } as unknown as Database;
  return { statements, database };
}

test("the fold removes the digests' changes once their table exists, and before the migration removes nothing (ADM-009)", async (t) => {
  await t.test("after the migration it removes the changes, and says how many it folded in", async () => {
    const { statements, database } = standIn(true, 3);
    assert.equal(await foldHistoryDigestChanges(database), 3);
    assert.equal(statements.length, 2);
  });
  await t.test("before it, every change went to the digest's rows: there is nothing to fold", async () => {
    const { statements, database } = standIn(false, 0);
    assert.equal(await foldHistoryDigestChanges(database), 0);
    assert.equal(statements.length, 1, "no removal is sent to a database without the table");
  });
});
