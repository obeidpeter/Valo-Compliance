// Compares a migrated database's keys, checks and indexes with the latest Drizzle snapshot.
// drizzle-kit writes each new migration from the snapshot, not from the database, so a key
// the database names or shapes differently makes a later generated migration fail against
// every real database (for example, it drops a constraint by a name the database lacks).
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Tables that only hand-written SQL reads and writes, so drizzle-kit never generates SQL for
 * them. A new table belongs in the Drizzle schema unless it has the same reason to stay out.
 */
export const RAW_SQL_TABLES = new Map([
  ["valo_inference_batches", "approved inference batch records, read by the batch dispatcher"],
  ["valo_privacy_key_versions", "privacy key versions, managed by the privacy key commands"],
  ["valo_privacy_redactions", "privacy copy redactions, written by erasure and recovery"],
  ["valo_runtime_identity", "the runtime identity marker, read by activation and bootstrap"],
]);

/** PostgreSQL keeps the first 63 bytes of an identifier, in every statement that names it. */
export const stored = (name) => {
  if (!/^[\x20-\x7e]+$/.test(name)) throw new Error(`Unexpected non-ASCII identifier ${name}`);
  return name.slice(0, 63);
};

/** The snapshot drizzle-kit compares the schema with: the one for the last journal entry. */
export async function latestSnapshot(folder) {
  const journal = JSON.parse(await readFile(join(folder, "meta/_journal.json"), "utf8"));
  const tag = journal.entries.at(-1).tag;
  return JSON.parse(await readFile(join(folder, "meta", `${tag.split("_")[0]}_snapshot.json`), "utf8"));
}

const ACTIONS = { a: "no action", r: "restrict", c: "cascade", n: "set null", d: "set default" };
/** Records one key or index; two with one stored name on a table cannot be compared, or created. */
const record = (objects, table, name, description) => {
  if (objects.has(name)) throw new Error(`${table}: two keys or indexes are stored as ${name}`);
  objects.set(name, description);
};
const list = (columns) => `(${columns.map((column) => column ?? "<expression>").join(", ")})`;
const shapes = {
  key: (columns) => list(columns),
  foreignKey: (fk) =>
    `${list(fk.columns)} references ${fk.table}${list(fk.references)} on delete ${fk.onDelete} on update ${fk.onUpdate}`,
  index: (index) =>
    `${list(index.columns)}${index.method === "btree" ? "" : ` using ${index.method}`}${index.partial ? " partial" : ""}`,
};

/** Each table's keys and non-constraint indexes, by stored name, as the snapshot declares them. */
function fromSnapshot(snapshot) {
  const tables = new Map();
  for (const table of Object.values(snapshot.tables)) {
    const objects = new Map(),
      add = (name, kind, shape) => record(objects, table.name, stored(name), `${kind} ${shape}`);
    const composite = Object.values(table.compositePrimaryKeys ?? {});
    const columnKey = Object.values(table.columns)
      .filter((column) => column.primaryKey)
      .map((column) => column.name);
    for (const key of composite) add(key.name, "primary key", shapes.key(key.columns));
    if (columnKey.length) add(`${table.name}_pkey`, "primary key", shapes.key(columnKey));
    for (const unique of Object.values(table.uniqueConstraints ?? {}))
      add(unique.name, "unique", shapes.key(unique.columns));
    for (const fk of Object.values(table.foreignKeys ?? {}))
      add(
        fk.name,
        "foreign key",
        shapes.foreignKey({
          columns: fk.columnsFrom,
          table: fk.tableTo,
          references: fk.columnsTo,
          onDelete: fk.onDelete ?? "no action",
          onUpdate: fk.onUpdate ?? "no action",
        }),
      );
    for (const index of Object.values(table.indexes ?? {}))
      add(
        index.name,
        index.isUnique ? "unique index" : "index",
        shapes.index({
          columns: index.columns.map((column) => (column.isExpression ? null : column.expression)),
          method: index.method ?? "btree",
          partial: Boolean(index.where),
        }),
      );
    // Check expressions are compared once PostgreSQL has normalized them (normalizedChecks).
    const checks = Object.values(table.checkConstraints ?? {}).map((check) => ({
      name: stored(check.name),
      value: check.value,
    }));
    tables.set(table.name, { objects, checks });
  }
  return tables;
}

async function fromDatabase(client) {
  const tables = new Map();
  const table = (name) => {
    if (!tables.has(name)) tables.set(name, { objects: new Map() });
    return tables.get(name);
  };
  const relations = await client.query(`SELECT c.relname FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p')`);
  for (const { relname } of relations.rows) table(relname);
  const constraints = await client.query(`SELECT c.relname AS "table",k.conname AS name,k.contype AS type,
      ARRAY(SELECT a.attname::text FROM unnest(k.conkey) WITH ORDINALITY u(n,o)
        JOIN pg_attribute a ON a.attrelid=k.conrelid AND a.attnum=u.n ORDER BY u.o) AS columns,
      r.relname AS "references",
      ARRAY(SELECT a.attname::text FROM unnest(k.confkey) WITH ORDINALITY u(n,o)
        JOIN pg_attribute a ON a.attrelid=k.confrelid AND a.attnum=u.n ORDER BY u.o) AS "referencedColumns",
      k.confdeltype AS "onDelete",k.confupdtype AS "onUpdate",pg_get_constraintdef(k.oid,true) AS definition
    FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    LEFT JOIN pg_class r ON r.oid=k.confrelid
    WHERE n.nspname='public' AND k.contype IN ('p','u','f','c','x')`);
  for (const row of constraints.rows) {
    const { objects } = table(row.table),
      add = (description) => record(objects, row.table, row.name, description);
    if (row.type === "c") add(row.definition);
    else if (row.type === "p") add(`primary key ${shapes.key(row.columns)}`);
    else if (row.type === "u") add(`unique ${shapes.key(row.columns)}`);
    else if (row.type === "x") add(`exclusion constraint ${shapes.key(row.columns)}`);
    else
      add(
        `foreign key ${shapes.foreignKey({
          columns: row.columns,
          table: row.references,
          references: row.referencedColumns,
          onDelete: ACTIONS[row.onDelete],
          onUpdate: ACTIONS[row.onUpdate],
        })}`,
      );
  }
  // Indexes that back a primary key, unique or exclusion constraint are compared as that constraint.
  const indexes = await client.query(`SELECT t.relname AS "table",i.relname AS name,x.indisunique AS "unique",
      x.indpred IS NOT NULL AS partial,am.amname AS method,
      ARRAY(SELECT CASE WHEN u.n=0 THEN NULL ELSE a.attname::text END FROM unnest(x.indkey) WITH ORDINALITY u(n,o)
        LEFT JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=u.n WHERE u.o<=x.indnkeyatts ORDER BY u.o) AS columns
    FROM pg_index x JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_class t ON t.oid=x.indrelid
    JOIN pg_am am ON am.oid=i.relam JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname='public' AND NOT EXISTS (SELECT 1 FROM pg_constraint k
      WHERE k.conindid=i.oid AND k.conrelid=t.oid AND k.contype IN ('p','u','x'))`);
  for (const row of indexes.rows)
    record(
      table(row.table).objects,
      row.table,
      row.name,
      `${row.unique ? "unique index" : "index"} ${shapes.index(row)}`,
    );
  return tables;
}

/**
 * PostgreSQL's own text for a table's snapshot check expressions. Each is added, without checking
 * any row, to a temporary copy of the table under the same name (so the table-qualified columns
 * drizzle-kit writes resolve), then read back the way the database reports its own checks.
 */
async function normalizedChecks(client, table, checks) {
  const quoted = `"${table}"`;
  await client.query(`CREATE TEMP TABLE ${quoted} (LIKE public.${quoted})`);
  try {
    const probes = new Map();
    for (const [index, check] of checks.entries()) {
      const probe = `snapshot_parity_probe_${index}`;
      await client.query(
        `ALTER TABLE pg_temp.${quoted} ADD CONSTRAINT ${probe} CHECK (${check.value}) NOT VALID`,
      );
      probes.set(probe, check.name);
    }
    const { rows } = await client.query(
      "SELECT conname,pg_get_constraintdef(oid,true) AS definition FROM pg_constraint WHERE conrelid=$1::regclass",
      [`pg_temp.${quoted}`],
    );
    return rows.map((row) => [probes.get(row.conname), row.definition.replace(/ NOT VALID$/, "")]);
  } finally {
    await client.query(`DROP TABLE pg_temp.${quoted}`);
  }
}

/**
 * Every difference between the database's primary keys, unique constraints, foreign keys, check
 * constraints and indexes and the snapshot's, by the name PostgreSQL stores. Check expressions
 * must be the same once PostgreSQL has normalized them. An empty list means a generated
 * migration can name every key, check and index it changes.
 */
export async function snapshotDifferences(client, snapshot) {
  const expected = fromSnapshot(snapshot),
    actual = await fromDatabase(client),
    differences = [];
  for (const [name, declared] of expected) {
    const found = actual.get(name);
    if (!found) {
      differences.push(`${name}: table is only in the snapshot`);
      continue;
    }
    if (declared.checks.length)
      for (const [check, definition] of await normalizedChecks(client, name, declared.checks))
        record(declared.objects, name, check, definition);
    for (const [object, shape] of declared.objects) {
      const present = found.objects.get(object);
      if (present === undefined) differences.push(`${name}: ${object} is only in the snapshot: ${shape}`);
      else if (present !== shape)
        differences.push(`${name}: ${object} differs: database ${present}, snapshot ${shape}`);
    }
    for (const [object, shape] of found.objects)
      if (!declared.objects.has(object))
        differences.push(`${name}: ${object} is only in the database: ${shape}`);
  }
  for (const name of actual.keys())
    if (!expected.has(name) && !RAW_SQL_TABLES.has(name))
      differences.push(`${name}: table is only in the database and is not a listed raw SQL table`);
  for (const name of RAW_SQL_TABLES.keys())
    if (expected.has(name) || !actual.has(name))
      differences.push(
        `${name}: listed as a raw SQL table, but it is in the snapshot or not in the database`,
      );
  return differences.sort();
}
