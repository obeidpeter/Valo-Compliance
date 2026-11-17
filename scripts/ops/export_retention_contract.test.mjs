import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { validateExportRetention, planExportRetention } from "./export_retention_contract.mjs";
import { signJournal, verifyJournal } from "./recovery_contract.mjs";
const databaseId = randomUUID(),
  workspaceId = randomUUID(),
  assetId = randomUUID();
const entry = {
  assetId,
  workspaceId,
  jobId: randomUUID(),
  objectKey: `valo/development/${workspaceId}/${assetId}.pdf`,
  checksum: "a".repeat(64),
  bytes: 32,
  createdAt: "2026-01-01T00:00:00.000Z",
  retentionAt: null,
  sourceFingerprint: "b".repeat(64),
  downloadable: true,
};
const inventory = (rows) => ({
  version: 1,
  environment: "development",
  complete: true,
  databaseId,
  entries: rows,
});
const old = inventory([entry]),
  current = inventory([{ ...entry, retentionAt: "2026-02-01T00:00:00.000Z" }]);
test("journal records a complete bounded, canonical generation inventory", () => {
  assert.equal(validateExportRetention(current), current);
  for (const value of [
    { ...current, complete: false },
    { ...current, environment: "production" },
    inventory([entry, entry]),
    inventory([{ ...entry, objectKey: "../private.pdf" }]),
    inventory([{ ...entry, bytes: -1 }]),
    inventory([{ ...entry, retentionAt: "tomorrow" }]),
  ])
    assert.throws(() => validateExportRetention(value));
});
test("restore plan retains exact later-assigned deadlines and never extends existing expiry", () => {
  assert.equal(planExportRetention(old, current)[0].retentionAt, current.entries[0].retentionAt);
  const earlier = inventory([{ ...entry, retentionAt: "2026-01-15T00:00:00.000Z" }]);
  assert.equal(planExportRetention(earlier, current)[0].retentionAt, earlier.entries[0].retentionAt);
  assert.throws(
    () => planExportRetention(old, { ...current, databaseId: randomUUID() }),
    /DATABASE_MISMATCH/,
  );
});
test("missing, replaced, unresolved and nonreadable generations require quarantine", () => {
  for (const rows of [
    [],
    [{ ...entry, sourceFingerprint: "c".repeat(64) }],
    [entry],
    [{ ...current.entries[0], downloadable: false }],
  ])
    assert.equal(planExportRetention(old, inventory(rows))[0].kind, "quarantine");
  assert.equal(
    planExportRetention(inventory([{ ...entry, downloadable: false }]), current)[0].kind,
    "quarantine",
  );
});
test("retention decisions are authenticated with the fresh independent privacy journal", () => {
  const key = randomBytes(32).toString("hex"),
    now = Date.parse("2026-01-01T01:00:00Z");
  const payload = {
    version: 1,
    kind: "current-development-privacy-journal",
    sourceIdentitySha256: "a".repeat(64),
    cutoff: "2026-01-01T00:59:00Z",
    controls: { valo_memberships: [] },
    fingerprints: { valo_memberships: { count: "0", digest: "d41d8cd98f00b204e9800998ecf8427e" } },
    exportRetention: current,
  };
  const binding = {
    sourceIdentitySha256: "a".repeat(64),
    snapshotCutoff: "2026-01-01T00:00:00Z",
    now,
    requireExportRetention: true,
  };
  assert.deepEqual(verifyJournal(signJournal(payload, key), key, binding), payload);
  const legacy = { ...payload };
  delete legacy.exportRetention;
  assert.throws(() => verifyJournal(signJournal(legacy, key), key, binding), /RETENTION_JOURNAL_REQUIRED/);
  assert.throws(
    () => verifyJournal(signJournal(payload, key), key, { ...binding, now: now + 7200000 }),
    /CURRENT_JOURNAL_REQUIRED/,
  );
  const changed = signJournal(payload, key);
  changed.payload = changed.payload.replace("2026-02-01", "2026-03-01");
  assert.throws(() => verifyJournal(changed, key, binding), /AUTHENTICATION/);
});
