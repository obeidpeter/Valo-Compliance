import { pool } from "@workspace/db";
import { InferenceBudgetStore, FiniteInferenceDispatcher, type FiniteManifest } from "../modules/ai";
import { assertDevelopmentRuntime } from "../platform/valo-development-runtime";
assertDevelopmentRuntime();
const [schema, id, key] = process.argv.slice(2);
if (
  process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only" ||
  !process.send ||
  !/^finite_[a-f0-9]{32}$/.test(schema ?? "")
)
  throw Error("OWNED_ISOLATED_SCHEMA_REQUIRED");
const { rows } = await pool.query(`SELECT manifest FROM "${schema}".valo_inference_batches WHERE id=$1`, [
  id,
]);
const manifest = rows[0]?.manifest as FiniteManifest | undefined,
  work = manifest?.works.find((w) => w.key === key);
if (!work) throw Error("CONTROLLED_WORK_MISSING");
const d = new FiniteInferenceDispatcher(
  new InferenceBudgetStore(pool, schema, "additional-new"),
  async () => {
    process.send!({ stage: "admitted-before-sdk", realProviderCalls: 0 });
    return new Promise(() => {});
  },
  async () => {},
);
try {
  await d.withWork(id!, key!, () => d.complete(work.lane, work.request, { timeout: 100, maxRetries: 0 }));
} finally {
  await pool.end();
}
