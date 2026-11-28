// OPS-008: a release may only expand the schema, so that the release before it still runs on it
// (docs/valo/release-and-rollback.md, "Schema compatibility rule"; docs/architecture/rollback.md).
//
//   node lib/db/scripts/expand-only.mjs --since <commit>
//
// compares the migrations the journal lists at <commit>, the previous release, with those it lists
// now. It refuses a migration the previous release has that is changed or removed, and, in each
// migration added since, a statement that removes, renames or narrows something the previous release
// may use, or changes data, unless lib/db/expand-only-exceptions.json names that exact statement with
// its reason. What it passes still has to pass the previous release's own database tests on the new
// schema: a new trigger, constraint or row-security policy can refuse a write the previous release
// makes, and only running it shows that.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
export const MIGRATIONS = "lib/db/drizzle";
export const EXCEPTIONS_PATH = "lib/db/expand-only-exceptions.json";

/**
 * The statements of a migration, in order: split at each semicolon outside a quotation, a quoted
 * name, a dollar-quoted body or a comment. Comments, drizzle's statement breakpoints among them, are
 * left out, and runs of white space are made one space.
 */
export function statements(sql) {
  const found = [];
  let current = "";
  const end = () => {
    const text = current.replace(/\s+/g, " ").trim();
    if (text) found.push(text);
    current = "";
  };
  const closing = (from, mark, what) => {
    const at = sql.indexOf(mark, from);
    if (at === -1) throw Error(`EXPAND_ONLY_UNREADABLE: ${what} is never closed`);
    return at;
  };
  let i = 0;
  while (i < sql.length) {
    const rest = sql.slice(i, i + 2);
    if (rest === "--") {
      const line = sql.indexOf("\n", i);
      i = line === -1 ? sql.length : line + 1;
      current += " ";
    } else if (rest === "/*") {
      i = closing(i + 2, "*/", "a comment") + 2;
      current += " ";
    } else if (sql[i] === "'" || sql[i] === '"') {
      // A doubled quotation mark inside stands for one.
      const mark = sql[i];
      let j = i + 1;
      for (;;) {
        const at = closing(j, mark, mark === "'" ? "a quotation" : "a quoted name");
        if (sql[at + 1] === mark) j = at + 2;
        else {
          j = at + 1;
          break;
        }
      }
      current += sql.slice(i, j);
      i = j;
    } else if (sql[i] === "$" && /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.test(sql.slice(i))) {
      const tag = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i))[0];
      const at = closing(i + tag.length, tag, "a dollar-quoted body");
      current += sql.slice(i, at + tag.length);
      i = at + tag.length;
    } else if (sql[i] === ";") {
      end();
      i += 1;
    } else {
      current += sql[i];
      i += 1;
    }
  }
  end();
  return found;
}

const NAME = String.raw`(?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_$]*)`;
const QUALIFIED = String.raw`${NAME}(?:\.${NAME})?`;
/** A name as the database keeps it: unquoted names in lower case, without the public schema. */
export function bareName(name) {
  const parts = name.match(new RegExp(NAME, "g")) ?? [];
  const plain = parts.map((part) =>
    part.startsWith('"') ? part.slice(1, -1).replaceAll('""', '"') : part.toLowerCase(),
  );
  return (plain[0] === "public" && plain.length === 2 ? plain.slice(1) : plain).join(".");
}

/** The parts of an ALTER TABLE, split at each comma outside parentheses and quotations. */
function actions(text) {
  const parts = [];
  let depth = 0,
    start = 0,
    quote = "";
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = "";
    } else if (c === "'" || c === '"') quote = c;
    else if (c === "(") depth += 1;
    else if (c === ")") depth -= 1;
    else if (c === "," && depth === 0) {
      parts.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(text.slice(start).trim());
  return parts.filter(Boolean);
}

const match = (text, pattern) => new RegExp(pattern, "i").exec(text);

/** What a release's new migrations create, so that what they then drop, replace or restrict is known. */
function createdBy(texts) {
  const made = {
    tables: new Set(),
    objects: new Set(),
    constraints: new Set(),
    roles: new Set(),
  };
  for (const text of texts) {
    let m;
    if ((m = match(text, String.raw`^CREATE (?:UNLOGGED )?TABLE (?:IF NOT EXISTS )?(${QUALIFIED})`)))
      made.tables.add(bareName(m[1]));
    else if (
      (m = match(
        text,
        String.raw`^CREATE (?:UNIQUE )?INDEX (?:CONCURRENTLY )?(?:IF NOT EXISTS )?(${QUALIFIED})`,
      ))
    )
      made.objects.add(`index ${bareName(m[1])}`);
    else if ((m = match(text, String.raw`^CREATE (?:OR REPLACE )?(FUNCTION|PROCEDURE) (${QUALIFIED})`)))
      made.objects.add(`function ${bareName(m[2])}`);
    else if (
      (m = match(
        text,
        String.raw`^CREATE (?:OR REPLACE )?(?:CONSTRAINT )?TRIGGER (${NAME}) .*? ON (${QUALIFIED})`,
      ))
    )
      made.objects.add(`trigger ${bareName(m[1])} on ${bareName(m[2])}`);
    else if ((m = match(text, String.raw`^CREATE POLICY (${NAME}) ON (${QUALIFIED})`)))
      made.objects.add(`policy ${bareName(m[1])} on ${bareName(m[2])}`);
    else if (
      (m = match(
        text,
        String.raw`^CREATE (?:OR REPLACE )?(VIEW|SEQUENCE|TYPE|SCHEMA) (?:IF NOT EXISTS )?(${QUALIFIED})`,
      ))
    )
      made.objects.add(`${m[1].toLowerCase()} ${bareName(m[2])}`);
    else if ((m = match(text, String.raw`^CREATE ROLE (${NAME})`))) made.roles.add(bareName(m[1]));
    const table = match(text, String.raw`^ALTER TABLE (?:ONLY )?(?:IF EXISTS )?(${QUALIFIED}) (.*)$`);
    if (table)
      for (const action of actions(table[2])) {
        const added = match(action, String.raw`^ADD CONSTRAINT (${NAME})`);
        if (added) made.constraints.add(`${bareName(added[1])} on ${bareName(table[1])}`);
      }
  }
  return made;
}

const DATA = "changes data the previous release reads, which cannot be undone, so it needs its own runbook";

/**
 * Each statement of the release's new migrations, in order, as one of:
 * - "adds": creates something, or grants, or restricts only what the release itself creates;
 * - "replaces": drops something the release creates again under the same name, or replaces a
 *   function, a view or a check: the previous release's own tests show whether it still runs;
 * - "refused": removes, renames or narrows what the previous release may use, or changes data, or
 *   is a statement this check cannot read.
 * `previous` is the text of every migration the previous release has.
 */
export function classify(migrations, previous = []) {
  const texts = migrations.flatMap((m) => m.statements);
  const made = createdBy(texts);
  const before = createdBy(previous.flatMap((text) => statements(text)));
  const own = (kind, name) => made.objects.has(`${kind} ${name}`);
  const results = [];
  for (const migration of migrations)
    for (const [index, text] of migration.statements.entries()) {
      const result = (kind, what) => results.push({ migration: migration.tag, index, text, kind, what });
      let m;
      if (/^(BEGIN|COMMIT)$|^SET (LOCAL |SESSION )?[a-z_]+ (TO|=) /i.test(text))
        result("adds", "sets how the migration runs");
      else if ((m = match(text, String.raw`^CREATE OR REPLACE (FUNCTION|PROCEDURE|VIEW) (${QUALIFIED})`))) {
        const name = bareName(m[2]);
        const kind = m[1].toLowerCase() === "view" ? "view" : "function";
        result(
          before.objects.has(`${kind} ${name}`) ? "replaces" : "adds",
          `${before.objects.has(`${kind} ${name}`) ? "replaces" : "creates"} the ${kind} ${name}`,
        );
      } else if (/^CREATE\b/i.test(text)) result("adds", text.split(" ").slice(0, 4).join(" "));
      else if (/^(GRANT|COMMENT ON|INSERT INTO)\b/i.test(text))
        result("adds", text.split(" ").slice(0, 3).join(" "));
      else if (/^(UPDATE|DELETE|TRUNCATE)\b/i.test(text)) result("refused", DATA);
      else if (
        (m = match(
          text,
          String.raw`^SELECT public\.valo_history_digest_reseed\('(${QUALIFIED})'(?:::regclass)?\)$`,
        ))
      ) {
        // The audit trail's own way to start a history's digest, or to compute it again from the rows
        // after the history's columns change (ADM-009): it touches that history's digest and nothing else.
        const table = bareName(m[1]);
        if (made.tables.has(table)) result("adds", `starts the history digest of ${table}`);
        else result("replaces", `computes the history digest of ${table} again from its rows`);
      } else if (/^(DO|SELECT|CALL|EXECUTE|COPY)\b/i.test(text))
        result("refused", "runs code or reads data this check cannot follow");
      else if ((m = match(text, String.raw`^ALTER TABLE (?:ONLY )?(?:IF EXISTS )?(${QUALIFIED}) (.*)$`))) {
        const table = bareName(m[1]);
        const isNew = made.tables.has(table);
        for (const action of actions(m[2])) {
          const say = (kind, what) => result(kind, `${what} (${table})`);
          let a;
          if (/^RENAME\b/i.test(action)) say("refused", "renames what the previous release names");
          else if ((a = match(action, String.raw`^ADD CONSTRAINT (${NAME})`)))
            say("adds", `adds the constraint ${bareName(a[1])}`);
          else if (/^ADD (PRIMARY KEY|UNIQUE|CHECK|FOREIGN KEY|EXCLUDE)\b/i.test(action))
            say("adds", "adds a constraint");
          else if ((a = match(action, String.raw`^ADD (?:COLUMN )?(?:IF NOT EXISTS )?(${NAME}) (.*)$`))) {
            const column = bareName(a[1]);
            const required =
              /\b(NOT NULL|PRIMARY KEY)\b/i.test(a[2]) && !/\b(DEFAULT|GENERATED)\b/i.test(a[2]);
            if (required && !isNew)
              say(
                "refused",
                `adds the required column ${column} with no default: the previous release's rows and inserts lack it`,
              );
            else say("adds", `adds the column ${column}`);
          } else if ((a = match(action, String.raw`^DROP CONSTRAINT (?:IF EXISTS )?(${NAME})`))) {
            const name = bareName(a[1]);
            if (made.constraints.has(`${name} on ${table}`))
              say("replaces", `replaces the constraint ${name}`);
            else say("refused", `removes the constraint ${name}`);
          } else if (/^DROP\b/i.test(action)) say("refused", "removes what the previous release may use");
          else if ((a = match(action, String.raw`^ALTER (?:COLUMN )?(${NAME}) (.*)$`))) {
            const column = bareName(a[1]);
            if (/^(DROP NOT NULL|SET DEFAULT)\b/i.test(a[2])) say("adds", `widens the column ${column}`);
            else if (/^SET NOT NULL\b/i.test(a[2]) && isNew) say("adds", `narrows the new column ${column}`);
            else say("refused", `changes the column ${column}: ${a[2].split(" ").slice(0, 3).join(" ")}`);
          } else if (/^(ENABLE|FORCE) ROW LEVEL SECURITY$/i.test(action))
            say(isNew ? "adds" : "replaces", "turns on row-level security");
          else if (/^(VALIDATE CONSTRAINT|OWNER TO)\b/i.test(action))
            say("adds", action.split(" ").slice(0, 2).join(" "));
          else say("refused", `does what this check cannot read: ${action.split(" ").slice(0, 3).join(" ")}`);
        }
      } else if (
        (m = match(
          text,
          String.raw`^DROP (INDEX|FUNCTION|PROCEDURE|VIEW|SEQUENCE|TYPE|TRIGGER|POLICY) (?:CONCURRENTLY )?(?:IF EXISTS )?(${QUALIFIED})(?: ON (${QUALIFIED}))?`,
        ))
      ) {
        const kind = m[1].toLowerCase() === "procedure" ? "function" : m[1].toLowerCase();
        const name = `${bareName(m[2])}${m[3] ? ` on ${bareName(m[3])}` : ""}`;
        // A drop before a later statement makes it again is a replacement; the order is checked by
        // the database itself when the migration runs.
        if (own(kind, name)) result("replaces", `drops the ${kind} ${name} and makes it again`);
        else result("refused", `removes the ${kind} ${name}`);
      } else if (/^DROP\b/i.test(text)) result("refused", "removes what the previous release may use");
      else if (
        (m = match(
          text,
          String.raw`^REVOKE (.+?) ON (?:(TABLE|FUNCTION|PROCEDURE|SEQUENCE) )?(.+?) FROM (.+)$`,
        ))
      ) {
        const kind = (m[2] ?? "table").toLowerCase();
        const names = /\bALL (TABLES|FUNCTIONS|SEQUENCES) IN SCHEMA\b/i.test(m[3])
          ? null
          : actions(m[3]).map((n) => bareName(n.replace(/\(.*$/, "")));
        const mine = (n) =>
          kind === "table" ? made.tables.has(n) : own(kind === "procedure" ? "function" : kind, n);
        if (names && names.every(mine))
          result("adds", `restricts only what the release creates: ${names.join(", ")}`);
        else result("refused", `takes ${m[1]} from ${m[4]}: the previous release may use it`);
      } else if ((m = match(text, String.raw`^ALTER ROLE (${NAME})`)))
        result(made.roles.has(bareName(m[1])) ? "adds" : "refused", "changes a role");
      else if ((m = match(text, String.raw`^ALTER (FUNCTION|PROCEDURE) (${QUALIFIED})`)))
        result(
          / RENAME /i.test(text) ? "refused" : "adds",
          `changes the settings of the function ${bareName(m[2])}`,
        );
      else if (/^ALTER DEFAULT PRIVILEGES\b/i.test(text))
        result("adds", "sets privileges for objects made later");
      else
        result("refused", `is a statement this check cannot read: ${text.split(" ").slice(0, 3).join(" ")}`);
    }
  return results;
}

export const statementHash = (text) => createHash("sha256").update(text).digest("hex");

/**
 * The whole check. `previous` and `current` are { journal, files }: the tags the journal lists, in
 * order, and each tag's SQL. `exceptions` are the reviewed ones; `runbookExists` says whether a path
 * an exception names is a file. It returns the new migrations' statements and every refusal.
 */
export function checkExpandOnly({ previous, current, exceptions = [], runbookExists = () => false }) {
  const problems = [];
  const now = new Set(current.journal);
  for (const tag of previous.journal) {
    if (!now.has(tag)) problems.push(`${tag} is a migration the previous release has, and it is gone`);
    else if (current.files[tag] !== previous.files[tag])
      problems.push(
        `${tag} is a migration the previous release has, and it was changed: migrations are only added`,
      );
  }
  const had = new Set(previous.journal);
  const added = current.journal
    .filter((tag) => !had.has(tag))
    .map((tag) => ({ tag, statements: statements(current.files[tag] ?? "") }));
  const results = classify(
    added,
    previous.journal.map((tag) => previous.files[tag] ?? ""),
  );
  const used = new Set();
  for (const result of results) {
    if (result.kind !== "refused") continue;
    const hash = statementHash(result.text);
    const excepted = exceptions.find((e) => e.migration === result.migration && e.statement === hash);
    if (!excepted) {
      problems.push(
        `${result.migration}, statement ${result.index + 1}, ${result.what}: "${result.text.slice(0, 120)}"`,
      );
      continue;
    }
    used.add(excepted);
    if (typeof excepted.reason !== "string" || excepted.reason.trim().length < 40)
      problems.push(`${result.migration}, statement ${result.index + 1}: its exception gives no reason`);
    if (result.what === DATA && !(typeof excepted.runbook === "string" && runbookExists(excepted.runbook)))
      problems.push(
        `${result.migration}, statement ${result.index + 1}: it changes data, and its exception names no runbook`,
      );
  }
  // An exception for a statement of a new migration that is no longer refused, or no longer there,
  // is a mistake: it would pass a later statement that happens to read the same.
  for (const exception of exceptions)
    if (added.some((m) => m.tag === exception.migration) && !used.has(exception))
      problems.push(`the exception for ${exception.migration} names no statement this check refuses`);
  return { added: added.map((m) => m.tag), results, problems };
}

function git(args) {
  return execFileSync("git", ["-c", "safe.directory=*", ...args], {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
}
const journalTags = (text) => JSON.parse(text).entries.map((entry) => entry.tag);

function main(args) {
  if (args.length !== 2 || args[0] !== "--since" || !/^[0-9a-f]{7,40}$/.test(args[1]))
    throw Error("usage: expand-only.mjs --since <commit, as its hexadecimal hash>");
  const since = args[1];
  const journalPath = `${MIGRATIONS}/meta/_journal.json`;
  const previousJournal = journalTags(git(["show", `${since}:${journalPath}`]));
  const previous = {
    journal: previousJournal,
    files: Object.fromEntries(
      previousJournal.map((tag) => [tag, git(["show", `${since}:${MIGRATIONS}/${tag}.sql`])]),
    ),
  };
  const currentJournal = journalTags(readFileSync(join(repositoryRoot, journalPath), "utf8"));
  const current = {
    journal: currentJournal,
    files: Object.fromEntries(
      currentJournal.map((tag) => [
        tag,
        readFileSync(join(repositoryRoot, MIGRATIONS, `${tag}.sql`), "utf8"),
      ]),
    ),
  };
  const { exceptions } = JSON.parse(readFileSync(join(repositoryRoot, EXCEPTIONS_PATH), "utf8"));
  const { added, results, problems } = checkExpandOnly({
    previous,
    current,
    exceptions,
    runbookExists: (path) => /^docs\/[a-z0-9/._-]+\.md$/.test(path) && existsSync(join(repositoryRoot, path)),
  });
  process.stdout.write(`previous release: ${since}\nmigrations added since: ${added.length}\n`);
  for (const tag of added) {
    process.stdout.write(`\n${tag}\n`);
    for (const result of results.filter((r) => r.migration === tag))
      process.stdout.write(
        `  ${String(result.index + 1).padStart(3)} ${result.kind.padEnd(8)} ${result.what}\n`,
      );
  }
  if (problems.length) {
    process.stdout.write(`\nrefused:\n${problems.map((p) => `- ${p}`).join("\n")}\n`);
    process.exitCode = 1;
  } else process.stdout.write("\nevery migration since the previous release only adds or replaces\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
