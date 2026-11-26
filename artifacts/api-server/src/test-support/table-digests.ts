import type { Pool } from "pg";

/** The digest of a table with no rows. */
export const NO_ROWS = "d41d8cd98f00b204e9800998ecf8427e";

/**
 * Every table's rows in the public schema, as one digest a table, but the tables named. A test takes
 * them before and after what should change nothing, and compares (docs/architecture/hostile-input.md).
 * A table left out is left out with its rows in the histories' digests (valo_history_digests), which
 * its own triggers keep. The digest is only a fingerprint for that comparison.
 */
export async function tableDigests(pool: Pick<Pool, "query">, leaveOut: readonly string[] = []) {
  const { rows } = await pool.query<{ name: string; digest: string }>(
    `SELECT c.relname AS name,
       (xpath('/row/d/text()', query_to_xml(format(
         'SELECT md5(coalesce(string_agg(t::text, chr(10) ORDER BY t::text), %L)) AS d FROM %I.%I t%s',
         '', n.nspname, c.relname,
         CASE WHEN c.relname = 'valo_history_digests'
           THEN format(' WHERE NOT (t.table_name = ANY(%L::text[]))', $1::text[]) ELSE '' END
       ), false, true, '')))[1]::text AS digest
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT (c.relname = ANY($1::text[]))
     ORDER BY c.relname`,
    [leaveOut],
  );
  return new Map(rows.map((row) => [row.name, row.digest]));
}

/** The tables whose digest differs between two readings. */
export function changedTables(before: Map<string, string>, after: Map<string, string>) {
  return [...after].filter(([name, digest]) => before.get(name) !== digest).map(([name]) => name);
}
