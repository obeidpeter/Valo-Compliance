# Rollback

The finishing plan's Phase 8 row "Rollback": "Run the previous release against the new schema in CI,
and check that a migration only adds."

- **OPS-008** asks Valo to "Use backward-compatible database changes, versioned assets and reversible
  feature flags", and accepts it on "deploy the previous application version safely or restore through
  a tested recovery plan; irreversible migrations require a separate approved runbook."

## What there was

- **The rule.** [release-and-rollback.md](../valo/release-and-rollback.md) says migrations only run
  forward, and a release may only expand: add tables, nullable columns or columns with defaults, and
  indexes; add functions and triggers that do not reject writes the previous release makes. A fault in
  the code is rolled back by deploying the previous commit again, against the new schema.
- **Nothing checked it.** The migration tests upgrade a database one migration at a time and check
  what each leaves; the drift test checks that the schema matches its last snapshot. None ran the
  previous release's code on the new schema, and none refused a migration that removes or narrows
  something.

## What is built

**Which release is the previous one.** `scripts/ops/previous_release.mjs` names it for the event a
workflow runs for: for a pull request, the commit of the branch it would merge into; for a push to the
integration branch or to `main`, the commit that branch held before the push; for any other push, or a
run asked for by hand, the commit where the branch leaves the integration branch.

**A migration only adds.** `lib/db/scripts/expand-only.mjs --since <commit>` compares the migrations the
journal lists at the previous release with those it lists now.

- A migration the previous release has is never changed or removed.
- Each statement of each migration added since is one of three kinds:
  - **adds:** it creates something, grants, adds a column that may be empty or has a default, adds a
    constraint, or restricts only what the release itself creates;
  - **replaces:** it drops something the release makes again under the same name (a check widened for a
    new kind of message, a trigger made again), replaces a function the previous release has, turns on
    row-level security for a table the previous release reads, or computes a history's digest again
    after its columns change;
  - **refused:** it removes, renames or narrows what the previous release may use (a table, a column, a
    constraint, an index, a trigger, a function, a policy, a privilege, a role), adds a required column
    with no default to a table that has rows, changes data, or runs code the check cannot read.
- A refused statement passes only on a reviewed exception for its exact text, in
  `lib/db/expand-only-exceptions.json`, with the reason the previous release still runs. One that changes
  data also names its runbook: it cannot be undone, and OPS-008 asks for "a separate approved runbook"
  for such a migration, which the owner approves before it is merged. There are none today.

**The previous release on this schema.** What the check passes still has to work: a new trigger,
constraint or row-level security can refuse a write the previous release makes, and only running it
shows that. `pnpm test:db --previous <checkout>` runs the database job of the release checked out in
`<checkout>`, step by step, as CI runs it, against a cluster of its own. The steps that set up the
database, its migrations, its logins and their check, and the queue, come from this checkout, so the
previous release's own tests meet this release's schema, logins and privileges, as they would once this
release is deployed and then rolled back. Every other step is the previous release's own.

**Failures the register expects.** A test of the previous release can fail on a newer schema by design,
in two ways, and neither is what the release does:
- **it checks the schema itself:** its list of the tables that hold a workspace's rows, for example,
  which a new table lengthens, or the release record's comparison of the migrations the release ships
  with those the database has applied;
- **it sets itself up by writing rows straight into the database**, in a shape the release's own code
  never writes, and a guard the new schema adds refuses that shape: an order whose amount or line is not
  its price's, for example, which the price book's guard refuses (PAY-001). The entry then says which of
  the release's own code writes such rows, and how it writes them as the guard requires, so that a
  reviewer can check it is the test's own rows that are refused and not the release's.

How the register holds them:
- Each such failure is in `lib/db/rollback-expected-failures.json`. An entry names the migrations that
  cause it, one test file, the tests of that file that fail for that one reason, each by its full name,
  and why the previous release still runs.
- An entry is read only while one of its migrations is new to the previous release. Once the previous
  release has them, its own tests know the new shape, and the entry is no longer read.
- The run passes when every failed step is explained: each test that failed in it is one the register
  expects. The previous release's check of its evidence register is explained when the only tests that
  failed in the whole run are expected ones.
- A listed test that did not fail is a mistake in the register, and fails the run too.

**In CI.** A job of its own, "The previous release on this schema (OPS-008)", runs on every push and pull
request:

1. it names the previous release and checks that every migration since it only adds;
2. when a migration was added or changed since, it checks out the previous release beside this one,
   installs its dependencies and runs its database job against this schema. When none was, the schema is
   the previous release's own, and the job says so and stops.

## The trial

The integration branch at `7cc2ce2` was run, as CI's rollback job runs it, against this branch's schema,
which adds 14 migrations to it.
- **The check that a migration only adds** passes: every statement of the 14 adds or replaces. One, a call
  that starts the history digest of a new table, was refused at first, and the check now reads that call
  for what it is.
- **The previous release's database job** had 51 steps passed, 8 skipped (CI setup) and 10 failed. The
  failed tests, 50 of them, are of three kinds:
  - **46 write orders straight into the database.** Each test makes its own orders, or takes them from a
    shared fixture, with an amount, a line or a price that the order's price does not give, and the guard
    `20261127172934_order_price_book_guard` adds refuses them. The previous release's own code writes no
    such order: its `createOrder` takes the amount, currency and line from the price in effect, and its
    bundle order from the bundle in effect and the database's own list of the bundle's released editions,
    exactly as the guard requires. Among them, the substitution test stops before its cases, so its list of
    workspace tables, which two new tables would lengthen, is never reached; its entry names both causes.
  - **One checks the schema itself:** the release record's test requires the migrations the release ships
    and those the database has applied to match, and here the database has this branch's as well.
  - **One fails on this machine only:** the staff library's PDF upload, which reads the PDF with a tool
    that this machine lacks and CI's job installs; and the previous release's check of its evidence register
    fails because of it.
- The 49 that are not this machine's are in the register, in 8 entries. Judged again with it, every failed
  step is explained but this machine's two.

## What does not change

- Migrations still run forward only, and are still written by hand where drizzle cannot generate them.
- The migration tests, the drift test and the Replit development database's steps are as they were.
- Restoring from a backup is the recovery plan's, as before. This checks the other half of OPS-008: that
  the previous application version can be deployed again.

## Slices

| # | Slice | Requirements |
| --- | --- | --- |
| 1 | **The check and the job.** The check that a migration only adds, with its exceptions file and unit tests; the previous release's name; `pnpm test:db --previous`; the CI job; and a local trial of the integration branch on this branch's schema. | OPS-008 |
