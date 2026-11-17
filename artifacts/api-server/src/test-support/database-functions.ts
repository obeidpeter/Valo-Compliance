/** The shared inference ledger's database functions, callees first. */
export const INFERENCE_LEDGER_FUNCTIONS = [
  "valo_inference_customer_change_refusal(text,jsonb,jsonb)",
  "valo_inference_budget_lock(text,text)",
  "valo_inference_budget_commit(text,integer,jsonb,text,text,text)",
  "valo_inference_batch_record_result(text,text,jsonb,text)",
] as const;

type Queryable = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: { definition?: string }[] }>;
};

/**
 * Recreates database functions from public in a disposable test schema, aimed at that schema's
 * own tables, so code built on the schema behaves exactly as it does on public. The migrations
 * define the functions; this only copies them.
 */
export async function copyDatabaseFunctions(
  database: Queryable,
  schema: string,
  signatures: readonly string[],
) {
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw Error("INVALID_TEST_SCHEMA");
  for (const signature of signatures) {
    const { rows } = await database.query("SELECT pg_get_functiondef($1::regprocedure) AS definition", [
      `public.${signature}`,
    ]);
    const definition = rows[0]?.definition;
    if (!definition) throw Error(`MISSING_DATABASE_FUNCTION ${signature}`);
    await database.query(definition.replaceAll("public.", `"${schema}".`));
  }
}
