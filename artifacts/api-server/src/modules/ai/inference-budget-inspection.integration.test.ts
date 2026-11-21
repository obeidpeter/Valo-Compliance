import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { InferenceBudgetStore } from "./inference-budget-store";
import { emptyBudget, inferenceProposal, requestDigest } from "./inference-budget";
import { assertDevelopmentRuntime } from "../../platform/valo-development-runtime";
import { copyDatabaseFunctions, INFERENCE_LEDGER_FUNCTIONS } from "../../test-support/database-functions";

test(
  "PostgreSQL inspection reads exact scoped state without initializing or mutating either ledger",
  {
    skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only",
  },
  async () => {
    assertDevelopmentRuntime();
    const schema = `valo_budget_inspection_${randomUUID().replaceAll("-", "")}`;
    try {
      await pool.query(`CREATE SCHEMA "${schema}"`);
      for (const table of ["valo_inference_budgets", "valo_inference_budget_events"])
        await pool.query(`CREATE TABLE "${schema}".${table} (LIKE public.${table} INCLUDING ALL)`);
      await copyDatabaseFunctions(pool, schema, INFERENCE_LEDGER_FUNCTIONS);
      const fresh = new InferenceBudgetStore(pool, schema, "additional-new");
      const absent = await fresh.inspect();
      assert.equal(absent.accountingBasis, "uninitialized-policy-default");
      assert.equal(
        (await pool.query(`SELECT count(*)::int AS n FROM "${schema}".valo_inference_budgets`)).rows[0].n,
        0,
      );
      const legacy = new InferenceBudgetStore(pool, schema);
      await legacy.mutate("synthetic-history-only", () => ({
        state: { ...emptyBudget(), unboundedPrior: ["synthetic-unknown-model"] },
        value: null,
      }));
      const historical = await legacy.inspect();
      assert.equal(historical.unboundedPriorRecords, 1);
      assert.equal(historical.uncommittedCapacityNanoUsd, null);
      await fresh.mutate("synthetic-new-scope", (s) => ({ state: s, value: null }));
      const versions = async () =>
        Promise.all([
          pool.query(
            `SELECT id,version,policy_hash,state FROM "${schema}".valo_inference_budgets ORDER BY id`,
          ),
          pool.query(`SELECT * FROM "${schema}".valo_inference_budget_events ORDER BY budget_id,version`),
        ]).then((r) => requestDigest(r.map((x) => x.rows)));
      const before = await versions();
      const reads = await Promise.all(Array.from({ length: 12 }, () => fresh.inspect()));
      assert.equal(new Set(reads.map((x) => x.stateFingerprint)).size, 1);
      assert.ok(reads.every((x) => x.uncommittedCapacityNanoUsd === "30000000000" && !x.authorizesDispatch));
      assert.equal(await versions(), before);
      await pool.query(`UPDATE "${schema}".valo_inference_budgets SET policy_hash=$1 WHERE id=$2`, [
        "f".repeat(64),
        fresh.allocationId(),
      ]);
      const stale = await fresh.inspect();
      assert.equal(stale.policyMatches, false);
      assert.equal(stale.uncommittedCapacityNanoUsd, null);
      assert.notEqual(stale.stateFingerprint, reads[0]!.stateFingerprint);
      assert.equal(
        (
          await pool.query(`SELECT policy_hash FROM "${schema}".valo_inference_budgets WHERE id=$1`, [
            fresh.allocationId(),
          ])
        ).rows[0].policy_hash,
        "f".repeat(64),
      );
      assert.notEqual(requestDigest(inferenceProposal), "f".repeat(64));
    } finally {
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await pool.end();
    }
  },
);
