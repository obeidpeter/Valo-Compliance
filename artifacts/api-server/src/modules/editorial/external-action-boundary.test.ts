import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  EditorialExternalActionDenied,
  editorialDeniedActions,
  verifyCurrentEditorialDenials,
  type EditorialDenialReceipt,
  type EditorialDenialAuditRow,
} from "./editorial-evaluation-evidence";

test("actual editorial denial boundary returns only committed current-run action receipts", async (t) => {
  // Native PostgreSQL/role enforcement is not claimed here. The actual service
  // and receipt/readback checks run with a transaction adapter that can fail.
  const persisted: EditorialDenialAuditRow[] = [];
  let fail: "none" | "insert" | "commit" = "none",
    policyCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw Error("NO_EXTERNAL_TRANSPORT_AUTHORIZED");
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  t.mock.module("@workspace/db", {
    namedExports: {
      valoPublicationAudit: { controlled: true },
      db: {
        transaction: async (fn: (tx: unknown) => Promise<void>) => {
          const pending: EditorialDenialAuditRow[] = [];
          await fn({
            execute: async () => ({ rows: [] }),
            insert: () => ({
              values: async (row: {
                id: string;
                versionId: string;
                action: string;
                actor: string;
                reason: string;
              }) => {
                if (fail === "insert") throw Error("CONTROLLED_INSERT_FAILURE");
                pending.push({
                  id: row.id,
                  version_id: row.versionId,
                  action: row.action,
                  actor: row.actor,
                  reason: row.reason,
                });
              },
            }),
          });
          if (fail === "commit") throw Error("CONTROLLED_COMMIT_FAILURE");
          persisted.push(...pending);
        },
      },
    },
  });
  // The publication module, at the boundary this file reads its policy through.
  t.mock.module(new URL("../publication/index.ts", import.meta.url).href, {
    namedExports: {
      developmentPublicationOnly: () => {
        policyCalls++;
      },
    },
  });
  const { dispatchEditorialExternalAction } = await import("./external-action-boundary");
  const versionId = randomUUID();
  for (const evaluationRunId of [randomUUID(), randomUUID()]) {
    const previousIds = persisted.map((row) => row.id);
    const receipts: EditorialDenialReceipt[] = [];
    for (const action of editorialDeniedActions) {
      await assert.rejects(
        () => dispatchEditorialExternalAction(versionId, action, evaluationRunId),
        (error: unknown) => {
          assert.ok(error instanceof EditorialExternalActionDenied);
          assert.equal(error.denial.requestedAction, action);
          assert.equal(error.denial.evaluationRunId, evaluationRunId);
          assert.ok(
            persisted.some((row) => row.id === error.denial.auditId),
            "receipt must follow commit",
          );
          receipts.push(error.denial);
          return true;
        },
      );
    }
    const rows = persisted.filter((row) => receipts.some((r) => r.auditId === row.id));
    assert.equal(
      verifyCurrentEditorialDenials(versionId, evaluationRunId, receipts, rows, previousIds).length,
      3,
    );
    assert.throws(
      () =>
        verifyCurrentEditorialDenials(versionId, evaluationRunId, receipts, rows, [
          ...previousIds,
          receipts[0]!.auditId,
        ]),
      /CURRENT_DENIAL_NOT_NEW/,
    );
    assert.throws(
      () =>
        verifyCurrentEditorialDenials(
          versionId,
          evaluationRunId,
          receipts,
          persisted.filter((row) => !receipts.some((r) => r.auditId === row.id)),
        ),
      /CURRENT_DENIAL_/,
    );
  }
  assert.equal(persisted.length, 6);
  assert.equal(new Set(persisted.map((row) => row.id)).size, 6);
  for (const failure of ["insert", "commit"] as const) {
    fail = failure;
    const before: number = persisted.length;
    await assert.rejects(
      () => dispatchEditorialExternalAction(versionId, "price", randomUUID()),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(!(error instanceof EditorialExternalActionDenied));
        assert.match(error.message, /CONTROLLED_(INSERT|COMMIT)_FAILURE/);
        return true;
      },
    );
    assert.equal(persisted.length, before);
  }
  assert.equal(policyCalls, 8);
});
