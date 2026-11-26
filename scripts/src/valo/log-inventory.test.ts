import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { repositoryRoot } from "./architecture-check";

/**
 * The security baseline's v5.0.0-16.1.1 and 16.2.3 (docs/architecture/alerts.md, part 4): the log
 * inventory, docs/valo/log-inventory.md, lists every event the code logs and no other, the API's one
 * logger writes only to its process's output, and every table the inventory names is in the schema.
 */
const INVENTORY = "docs/valo/log-inventory.md";
const API = "artifacts/api-server/src";

function sources(directory: string): string[] {
  return readdirSync(join(repositoryRoot, directory), { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.(ts|mjs)$/.test(entry.name) && !/\.test\.(ts|mjs)$/.test(entry.name) ? [path] : [];
  });
}

/**
 * The events named in source: `event: "name"`, or `event: flag ? "one" : "other"`, whether given to the
 * logger or printed as JSON.
 */
export function loggedEvents(text: string) {
  const found = new Set<string>();
  const pattern =
    /\bevent:\s*(?:[A-Za-z_$][\w$.]*\s*\?\s*)?"([a-z][a-z0-9_.-]*)"(?:\s*:\s*"([a-z][a-z0-9_.-]*)")?/g;
  for (const match of text.matchAll(pattern)) {
    found.add(match[1]!);
    if (match[2]) found.add(match[2]);
  }
  return found;
}

const inventory = readFileSync(join(repositoryRoot, INVENTORY), "utf8");
const eventsSection = inventory.slice(inventory.indexOf("## Events"), inventory.indexOf("## Not yet"));
const listed = [...eventsSection.matchAll(/^\| `([a-z][a-z0-9_.-]*)` \|/gm)].map((match) => match[1]!);

test("the log inventory lists every event the API, the worker and the operator commands log, and no other", () => {
  const files = sources(API);
  assert.ok(files.length > 100, "the API's sources are read");
  const logged = new Map<string, string[]>();
  for (const file of files)
    for (const event of loggedEvents(readFileSync(join(repositoryRoot, file), "utf8")))
      logged.set(event, [...(logged.get(event) ?? []), relative(API, file)]);
  assert.ok(listed.length > 50, "the inventory's events table is read");
  assert.equal(new Set(listed).size, listed.length, "each event is listed once");
  const missing = [...logged.keys()].filter((event) => !listed.includes(event));
  assert.deepEqual(
    missing.map((event) => `${event} (${logged.get(event)!.join(", ")})`),
    [],
    "logged but not in the inventory",
  );
  assert.deepEqual(
    listed.filter((event) => !logged.has(event)),
    [],
    "in the inventory but logged nowhere",
  );
  // The pattern finds an event in either form, and nothing that is not one.
  assert.deepEqual(
    [
      ...loggedEvents(
        'logger.warn({ event: "synthetic.one" }); report({ event: ok ? "synthetic.two" : "synthetic.three" }); x = { event: z.string() };',
      ),
    ],
    ["synthetic.one", "synthetic.two", "synthetic.three"],
  );
});

test("the API's one logger writes only to its process's output, and every table the log inventory names is in the schema", () => {
  const files = sources(API);
  const calls = (pattern: RegExp) =>
    files.filter((file) => pattern.test(readFileSync(join(repositoryRoot, file), "utf8")));
  // One logger, made in one place; the request logger is given it.
  assert.deepEqual(calls(/\bpino\(/), [`${API}/platform/logger.ts`]);
  assert.deepEqual(calls(/\bpinoHttp\(/), [`${API}/platform/http-logging.ts`]);
  const logger = readFileSync(join(repositoryRoot, API, "platform/logger.ts"), "utf8");
  // In development alone it can print the same output more readably; no other target is named.
  assert.deepEqual(
    [...logger.matchAll(/target:\s*"([^"]+)"/g)].map((match) => match[1]),
    ["pino-pretty"],
  );
  assert.doesNotMatch(logger, /pino\.destination\(|createWriteStream|multistream/);

  const schema = readdirSync(join(repositoryRoot, "lib/db/src/schema"))
    .map((file) => readFileSync(join(repositoryRoot, "lib/db/src/schema", file), "utf8"))
    .join("\n");
  const tables = new Set([...schema.matchAll(/pgTable\(\s*"([a-z_]+)"/g)].map((match) => match[1]!));
  const named = [...new Set([...inventory.matchAll(/`(valo_[a-z_]+)`/g)].map((match) => match[1]!))];
  assert.ok(named.length >= 9, "the inventory's tables are read");
  assert.deepEqual(
    named.filter((table) => !tables.has(table)),
    [],
    "named in the inventory but not in the schema",
  );
});
