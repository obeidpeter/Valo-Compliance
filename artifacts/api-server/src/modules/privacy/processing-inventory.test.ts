import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getTableColumns, getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import * as schema from "@workspace/db/schema";
import { processingInventory, tablesWithoutPersonalData } from "@workspace/valo-core";

// PRV-001 (docs/architecture/processing-inventory.md, slice 1): the processing inventory is checked
// against the database schema and the processor review, so that it says what the code actually stores.
const tables = new Map<string, PgTable>(
  (Object.values(schema) as unknown[])
    .filter((value): value is PgTable => is(value, PgTable))
    .map((table) => [getTableName(table), table]),
);
const inventoried = processingInventory.flatMap((activity) => activity.tables);
const unpersonal = Object.keys(tablesWithoutPersonalData);
/** A column that names a person, or a workspace, which belongs to one. A date to review by names no one. */
const namesSomeone = (column: string) =>
  /identity|email|actor|requester|owner|(?<!review)_by$|^workspace_id$/.test(column);

test("every table in the database schema is in the inventory or listed as holding no personal data, once", () => {
  const listed = [...inventoried, ...unpersonal];
  assert.deepEqual(
    [...tables.keys()].filter((name) => !listed.includes(name)).sort(),
    [],
    "tables the inventory does not account for",
  );
  assert.deepEqual(
    listed.filter((name, index) => listed.indexOf(name) !== index),
    [],
    "tables listed twice",
  );
});

test("every table the inventory names exists in the database schema", () => {
  assert.deepEqual(
    [...inventoried, ...unpersonal].filter((name) => !tables.has(name)),
    [],
  );
});

test("a table with a column naming a person or a workspace is never listed as holding no personal data", () => {
  const naming = unpersonal.flatMap((name) => {
    const columns = Object.values(getTableColumns(tables.get(name)!)).map((column) => column.name);
    const found = columns.filter(namesSomeone);
    return found.length ? [`${name}: ${found.join(", ")}`] : [];
  });
  assert.deepEqual(naming, []);
});

test("every table holding a workspace's rows is in the inventory", () => {
  const workspaceTables = [...tables].flatMap(([name, table]) =>
    Object.values(getTableColumns(table)).some((column) => column.name === "workspace_id") ? [name] : [],
  );
  assert.ok(workspaceTables.length > 20);
  assert.deepEqual(
    workspaceTables.filter((name) => !inventoried.includes(name)),
    [],
  );
});

test("every outside service the inventory names is in the processor review", () => {
  const review = readFileSync(
    new URL("../../../../../docs/valo/processor-review.md", import.meta.url),
    "utf8",
  );
  const services = review
    .slice(review.indexOf("## Services"))
    .split("\n")
    .filter((line) => line.startsWith("| ") && !line.startsWith("| Service") && !line.startsWith("| ---"))
    .map((line) => line.split("|")[1]!.trim());
  assert.ok(services.includes("Replit") && services.includes("Paystack"), services.join(", "));
  const named = [...new Set(processingInventory.flatMap((activity) => activity.services))];
  assert.deepEqual(
    named.filter((service) => !services.includes(service)),
    [],
  );
});

test("optional processing rests on a consent that starts it, and the service needs no consent", () => {
  for (const activity of processingInventory) {
    assert.equal(activity.basis === "consent", activity.consent !== null, activity.id);
    assert.ok(activity.purpose && activity.basisReason && activity.retention, activity.id);
    assert.ok(activity.data.length && activity.subjects.length && activity.tables.length, activity.id);
  }
  // PRV-001: the accounts, drafts, orders, AI and support are each recorded.
  for (const id of ["accounts", "documents", "orders", "ai_drafting", "support"])
    assert.ok(
      processingInventory.some((activity) => activity.id === id),
      id,
    );
  assert.equal(new Set(processingInventory.map((activity) => activity.id)).size, processingInventory.length);
});
