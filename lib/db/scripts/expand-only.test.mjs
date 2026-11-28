// The expand-only check's rules (OPS-008): what a migration may do so that the previous release still
// runs on the schema it leaves. The repository's own migrations are read as they are; every other
// statement here is written for the test. The check against the previous release's commit runs in the
// rollback job, which has the history.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { bareName, checkExpandOnly, classify, statementHash, statements } from "./expand-only.mjs";

const drizzle = fileURLToPath(new URL("../drizzle/", import.meta.url));
const journal = JSON.parse(readFileSync(`${drizzle}meta/_journal.json`, "utf8")).entries.map((e) => e.tag);
const kinds = (sql, previous = []) =>
  classify([{ tag: "0200_new", statements: statements(sql) }], previous).map((r) => r.kind);
const only = (sql, previous) => {
  const found = kinds(sql, previous);
  assert.equal(found.length, 1, `one result for ${sql}`);
  return found[0];
};

test("a migration splits into its statements, whatever its bodies, quotations and comments hold", () => {
  assert.deepEqual(
    statements(`-- a comment; with a semicolon
CREATE TABLE "a" ("x" text);--> statement-breakpoint
/* a block; comment */ INSERT INTO a VALUES ('it''s; one');
CREATE FUNCTION f() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'no; never'; END $$;
CREATE FUNCTION g() RETURNS int LANGUAGE sql AS $body$ SELECT 1; $body$;
COMMENT ON TABLE "a" IS 'a "quoted"; name'`),
    [
      'CREATE TABLE "a" ("x" text)',
      "INSERT INTO a VALUES ('it''s; one')",
      "CREATE FUNCTION f() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'no; never'; END $$",
      "CREATE FUNCTION g() RETURNS int LANGUAGE sql AS $body$ SELECT 1; $body$",
      `COMMENT ON TABLE "a" IS 'a "quoted"; name'`,
    ],
  );
  assert.throws(() => statements("CREATE FUNCTION f() AS $$ BEGIN"), /EXPAND_ONLY_UNREADABLE/);
  assert.throws(() => statements("INSERT INTO a VALUES ('open"), /EXPAND_ONLY_UNREADABLE/);
  assert.equal(bareName('"public"."valo_orders"'), "valo_orders");
  assert.equal(bareName("public.Valo_Orders"), "valo_orders");
  assert.equal(bareName('"Odd"'), "Odd");
});

test("every migration in the repository splits into statements", () => {
  for (const tag of journal) {
    const found = statements(readFileSync(`${drizzle}${tag}.sql`, "utf8"));
    assert.ok(found.length > 0, tag);
  }
});

test("a migration that only adds passes", () => {
  for (const sql of [
    'CREATE TABLE "valo_new" ("id" uuid PRIMARY KEY, "n" integer NOT NULL)',
    'CREATE UNIQUE INDEX "valo_new_once" ON "valo_new" USING btree ("n")',
    "CREATE FUNCTION public.valo_new_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$",
    "CREATE TRIGGER valo_new_guard BEFORE INSERT ON public.valo_orders FOR EACH ROW EXECUTE FUNCTION public.valo_new_guard()",
    'CREATE POLICY "valo_new_rows" ON "valo_new" USING (true)',
    'ALTER TABLE "valo_orders" ADD COLUMN "note" text',
    'ALTER TABLE "valo_orders" ADD COLUMN "tries" integer DEFAULT 0 NOT NULL',
    'ALTER TABLE "valo_orders" ADD CONSTRAINT "valo_orders_note_check" CHECK ("note" IS NULL OR length("note") < 500)',
    'ALTER TABLE "valo_orders" ALTER COLUMN "line" DROP NOT NULL',
    "GRANT SELECT ON public.valo_orders TO valo_workspace_scope",
    "COMMENT ON TABLE valo_orders IS 'orders'",
    "SET LOCAL lock_timeout = '5s'",
  ])
    assert.equal(only(sql), "adds", sql);
  // A required column is fine on a table the release makes itself.
  assert.deepEqual(
    kinds('CREATE TABLE "valo_new" ("id" uuid); ALTER TABLE "valo_new" ADD COLUMN "n" integer NOT NULL'),
    ["adds", "adds"],
  );
  // And so is restricting only what the release makes.
  assert.deepEqual(
    kinds(
      "CREATE FUNCTION public.valo_new_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;" +
        "REVOKE ALL ON FUNCTION public.valo_new_guard() FROM PUBLIC",
    ),
    ["adds", "adds"],
  );
});

test("a statement that removes, renames or narrows what the previous release uses is refused", () => {
  for (const sql of [
    'DROP TABLE "valo_orders"',
    'ALTER TABLE "valo_orders" DROP COLUMN "line"',
    'ALTER TABLE "valo_orders" RENAME COLUMN "line" TO "lines"',
    'ALTER TABLE "valo_orders" RENAME TO "valo_old_orders"',
    'ALTER TABLE "valo_orders" ALTER COLUMN "amount_kobo" SET DATA TYPE bigint',
    'ALTER TABLE "valo_orders" ALTER COLUMN "line" SET NOT NULL',
    'ALTER TABLE "valo_orders" ALTER COLUMN "status" DROP DEFAULT',
    'ALTER TABLE "valo_orders" ADD COLUMN "tries" integer NOT NULL',
    'ALTER TABLE "valo_orders" DROP CONSTRAINT "valo_orders_currency_check"',
    "DROP TRIGGER valo_orders_keep_terms ON public.valo_orders",
    "DROP FUNCTION public.valo_order_made_from_price_book()",
    'DROP INDEX "valo_orders_reference"',
    "REVOKE SELECT ON public.valo_orders FROM valo_workspace_scope",
    "REVOKE ALL ON ALL TABLES IN SCHEMA public FROM valo_workspace_scope",
    "ALTER ROLE valo_workspace_scope NOLOGIN",
    "ALTER FUNCTION public.valo_bundle_editions(uuid) RENAME TO valo_editions",
    "ALTER TABLE valo_orders DISABLE ROW LEVEL SECURITY",
    "DO $$ BEGIN PERFORM 1; END $$",
    "SELECT pg_sleep(1)",
    "UPDATE valo_orders SET status = 'paid'",
    "DELETE FROM valo_orders",
    "TRUNCATE valo_orders",
    "VACUUM valo_orders",
  ])
    assert.equal(only(sql), "refused", sql);
});

test("what the release drops and makes again under the same name is a replacement, for the previous release's tests to judge", () => {
  // A check widened, as a new kind of message or a new status needs.
  assert.deepEqual(
    kinds(
      'ALTER TABLE "valo_messages" DROP CONSTRAINT "valo_message_shape";' +
        `ALTER TABLE "valo_messages" ADD CONSTRAINT "valo_message_shape" CHECK ("kind" IN ('a', 'b'))`,
    ),
    ["replaces", "adds"],
  );
  // The same, in one statement.
  assert.deepEqual(
    kinds(
      "ALTER TABLE valo_orders DROP CONSTRAINT valo_orders_currency_check, ADD CONSTRAINT valo_orders_currency_check CHECK (currency IN ('NGN','USD'))",
    ),
    ["replaces", "adds"],
  );
  // A constraint dropped from one table and made on another is not replaced.
  assert.deepEqual(
    kinds('ALTER TABLE "a" DROP CONSTRAINT "c"; ALTER TABLE "b" ADD CONSTRAINT "c" CHECK (true)'),
    ["refused", "adds"],
  );
  assert.deepEqual(
    kinds(
      "DROP TRIGGER valo_guard ON public.valo_orders;" +
        "CREATE TRIGGER valo_guard BEFORE UPDATE ON public.valo_orders FOR EACH ROW EXECUTE FUNCTION public.g()",
    ),
    ["replaces", "adds"],
  );
  // A function the previous release has, replaced in place; one it lacks is new.
  const previous = [
    "CREATE FUNCTION public.valo_bundle_editions(uuid) RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;",
  ];
  assert.equal(
    only(
      "CREATE OR REPLACE FUNCTION public.valo_bundle_editions(uuid) RETURNS int LANGUAGE sql AS $$ SELECT 2 $$",
      previous,
    ),
    "replaces",
  );
  assert.equal(
    only(
      "CREATE OR REPLACE FUNCTION public.valo_other() RETURNS int LANGUAGE sql AS $$ SELECT 2 $$",
      previous,
    ),
    "adds",
  );
  // The audit trail's digest of a history, started for a new one or computed again for one whose
  // columns change; any other call is refused.
  assert.deepEqual(
    kinds(
      'CREATE TABLE "valo_new_history" ("id" int);' +
        "SELECT public.valo_history_digest_reseed('public.valo_new_history')",
    ),
    ["adds", "adds"],
  );
  assert.equal(only("SELECT public.valo_history_digest_reseed('public.valo_orders')"), "replaces");
  assert.equal(only("SELECT public.valo_other('public.valo_orders')"), "refused");
  // Row-level security on a table the previous release reads changes what its requests see.
  assert.equal(only('ALTER TABLE "valo_orders" ENABLE ROW LEVEL SECURITY'), "replaces");
  assert.deepEqual(kinds('CREATE TABLE "n" ("id" int); ALTER TABLE "n" ENABLE ROW LEVEL SECURITY'), [
    "adds",
    "adds",
  ]);
});

const release = (previousFiles, currentFiles) => ({
  previous: { journal: Object.keys(previousFiles), files: previousFiles },
  current: { journal: Object.keys(currentFiles), files: currentFiles },
});

test("a migration the previous release has is never changed or removed", () => {
  const one = 'CREATE TABLE "a" ("id" int);';
  assert.deepEqual(checkExpandOnly(release({ "0001_a": one }, { "0001_a": one })).problems, []);
  assert.match(
    checkExpandOnly(release({ "0001_a": one }, { "0001_a": `${one}\n` })).problems.join(),
    /0001_a is a migration the previous release has, and it was changed/,
  );
  assert.match(
    checkExpandOnly(release({ "0001_a": one }, { "0002_b": one })).problems.join(),
    /0001_a is a migration the previous release has, and it is gone/,
  );
  const { added, problems } = checkExpandOnly(
    release({ "0001_a": one }, { "0001_a": one, "0002_b": 'ALTER TABLE "a" ADD COLUMN "n" text;' }),
  );
  assert.deepEqual(added, ["0002_b"]);
  assert.deepEqual(problems, []);
  // Only migrations added since are read for what they do: an old one is the previous release's own.
  assert.deepEqual(
    checkExpandOnly(release({ "0001_a": "DROP TABLE x;" }, { "0001_a": "DROP TABLE x;" })).problems,
    [],
  );
});

test("a refused statement passes only on a reviewed exception for its exact text", () => {
  const files = {
    previous: { "0001_a": 'CREATE TABLE "a" ("id" int, "n" text);' },
    current: {
      "0001_a": 'CREATE TABLE "a" ("id" int, "n" text);',
      "0002_b": 'ALTER TABLE "a" DROP COLUMN "n";--> statement-breakpoint\nUPDATE "a" SET "id" = 1;',
    },
  };
  const base = release(files.previous, files.current);
  const drop = statementHash('ALTER TABLE "a" DROP COLUMN "n"'),
    update = statementHash('UPDATE "a" SET "id" = 1');
  assert.equal(checkExpandOnly(base).problems.length, 2);
  const reason =
    "The previous release never reads this column: it was added and left unused, as its runbook says.";
  // With a reason for each, and the runbook a change of data needs.
  const passed = checkExpandOnly({
    ...base,
    exceptions: [
      { migration: "0002_b", statement: drop, reason },
      { migration: "0002_b", statement: update, reason, runbook: "docs/valo/a-runbook.md" },
    ],
    runbookExists: (path) => path === "docs/valo/a-runbook.md",
  });
  assert.deepEqual(passed.problems, []);
  // Without a reason, or a runbook, or for another text, it is refused.
  const refused = (exceptions, runbookExists = () => true) =>
    checkExpandOnly({ ...base, exceptions, runbookExists }).problems.join("\n");
  assert.match(refused([{ migration: "0002_b", statement: drop, reason: "short" }]), /gives no reason/);
  assert.match(
    refused([{ migration: "0002_b", statement: update, reason }], () => false),
    /changes data, and its exception names no runbook/,
  );
  assert.match(
    refused([{ migration: "0002_b", statement: statementHash("ALTER TABLE a DROP COLUMN n"), reason }]),
    /statement 1, removes what the previous release may use/,
  );
  // An exception for a new migration's statement that is not refused is itself a mistake.
  assert.match(
    refused([{ migration: "0002_b", statement: statementHash("CREATE TABLE b ()"), reason }]),
    /the exception for 0002_b names no statement this check refuses/,
  );
  // One for a migration the previous release has is not read.
  assert.equal(
    checkExpandOnly({ ...base, exceptions: [{ migration: "0001_a", statement: drop, reason }] }).problems
      .length,
    2,
  );
});
