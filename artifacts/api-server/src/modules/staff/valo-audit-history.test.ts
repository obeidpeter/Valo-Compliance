import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { GetAuditHistoryResponse } from "@workspace/api-zod";

// The mappings need no database; the module only names one, which a unit run never opens.
process.env.DATABASE_URL ??= "postgresql://unused@localhost/unused";
const { AUDIT_HISTORY_PAGE_SIZE, auditHistoryEntry } = await import("./valo-audit-history");

const at = new Date("2026-11-25T12:00:00Z");
const page = (kind: string, entries: unknown[]) =>
  GetAuditHistoryResponse.parse({
    kind,
    entries,
    page: 1,
    pageSize: AUDIT_HISTORY_PAGE_SIZE,
    total: entries.length,
    notice: "Synthetic notice",
  });

test("audit history entries keep a refund's reason with finance, say plainly what a count found and fit the contract", () => {
  const refundRow = {
    id: randomUUID(),
    workspaceId: randomUUID(),
    orderId: randomUUID(),
    refundId: randomUUID(),
    actorId: "user_synthetic_finance",
    action: "approved",
    reason: "Synthetic customer words that only finance reads",
    createdAt: at,
  };
  const refund = auditHistoryEntry.refunds(refundRow);
  assert.equal(refund.reason, null);
  assert.equal(refund.object, `refund:${refundRow.refundId}`);
  assert.doesNotMatch(JSON.stringify(page("refunds", [refund])), /customer words/);

  const count = (mismatched: string[]) =>
    auditHistoryEntry.counts({ id: randomUUID(), checkedAt: at, mismatched });
  assert.deepEqual(
    [count([]), count(["valo_events"]), count(["valo_events", "valo_price_changes"])].map((e) => [
      e.action,
      e.reason,
    ]),
    [
      ["Every history matched its digest", null],
      ["1 history no longer matched its digest", "valo_events"],
      ["2 histories no longer matched their digests", "valo_events, valo_price_changes"],
    ],
  );

  const price = (action: string) =>
    auditHistoryEntry.prices({
      id: randomUUID(),
      priceId: randomUUID(),
      action,
      price: { amountKobo: 10000 },
      changedBy: "valo_app",
      changedAt: at,
    });
  assert.deepEqual(
    ["existing", "created", "closed", "deleted"].map((a) => price(a).action),
    ["Price as it stood when the log began", "Price created", "Price closed", "Price deleted"],
  );
  assert.equal(price("created").reason, null);

  const access = auditHistoryEntry.access({
    id: randomUUID(),
    assignmentId: randomUUID(),
    actorId: "user_synthetic_system",
    area: "system",
    object: "audit_history:access",
    reason: "Read page 1 of the access history",
    createdAt: at,
  });
  assert.deepEqual(
    [access.action, access.object, access.reason],
    ["Read in system", "audit_history:access", "Read page 1 of the access history"],
  );

  // A history may hold longer text than the page carries: it ends in an ellipsis, and the row keeps it all.
  const long = auditHistoryEntry.safety({
    id: randomUUID(),
    requestKey: randomUUID(),
    actorId: "user_synthetic_editor",
    assignmentId: randomUUID(),
    area: "source",
    action: "hold".repeat(100),
    target: "source:" + "x".repeat(400),
    reason: "A synthetic reason. ".repeat(150),
    previous: {},
    current: {},
    payloadHash: "0".repeat(64),
    createdAt: at,
  });
  assert.deepEqual([long.action.length, long.object.length, long.reason?.length], [300, 300, 2000]);
  assert.ok(long.action.endsWith("…") && long.object.endsWith("…") && long.reason?.endsWith("…"));
  for (const [kind, entries] of [
    ["access", [access]],
    ["safety", [long]],
    ["prices", [price("closed")]],
    ["refunds", [refund]],
    ["counts", [count([]), count(["valo_events"])]],
  ] as const)
    assert.equal(page(kind, [...entries]).entries.length, entries.length);
});
