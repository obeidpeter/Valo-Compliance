import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pool } from "@workspace/db";
import {
  allocationPackageId,
  approveFiniteAllocationPackage,
  listFiniteAllocationApprovals,
  prepareFiniteAllocationPackage,
  readApprovedFiniteAllocationPackage,
  revokeFiniteAllocationPackage,
  type FiniteAllocationPackage,
} from "./inference-allocation-package";

// The owner's approval of a finite AI allocation, recorded in an isolated schema of a disposable
// database. The approvals here are synthetic: nothing calls a model, reserves budget or admits work.
test(
  "the owner's approval of a finite allocation package is exact, lasts at most 24 hours, is the only one current and can be revoked",
  { skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only", timeout: 60000 },
  async () => {
    assert.equal(process.env.NODE_ENV, "development");
    const schema = `approval_${randomUUID().replaceAll("-", "")}`;
    const batches = `"${schema}".valo_inference_batches`;
    const c = await pool.connect();
    try {
      await c.query(`CREATE SCHEMA "${schema}"`);
      await c.query(`SET search_path TO "${schema}"`);
      const ddl = await readFile(
        new URL("../../../../../lib/db/drizzle/0020_inference_batch_authorization.sql", import.meta.url),
        "utf8",
      );
      await c.query(ddl.replaceAll("--> statement-breakpoint", ""));
    } finally {
      await c.query("RESET search_path");
      c.release();
    }
    try {
      const prepared = (secondsAgo: number) =>
        prepareFiniteAllocationPackage(new Date(Date.now() - secondsAgo * 1000));
      const pkg = await prepared(60);
      const id = allocationPackageId(pkg);
      const request = {
        confirmPackageId: id,
        approvedBy: "synthetic-owner",
        reference: "Synthetic decision record, test database only",
        hours: 24,
      };
      const approve = (overrides: Partial<typeof request> = {}, value: FiniteAllocationPackage = pkg) =>
        approveFiniteAllocationPackage(pool, value, { ...request, ...overrides }, schema);
      const hoursOf = (a: { approvedAt: string; expiresAt: string }) =>
        (Date.parse(a.expiresAt) - Date.parse(a.approvedAt)) / 3_600_000;

      // Refused, and nothing is recorded.
      await assert.rejects(
        approve({ confirmPackageId: `finite-package:${"0".repeat(64)}` }),
        /PACKAGE_APPROVAL_NOT_CONFIRMED/,
      );
      for (const approvedBy of ["finite-package-delegate", "delegate:synthetic", " synthetic-owner", "x"])
        await assert.rejects(approve({ approvedBy }), /PACKAGE_APPROVER_INVALID/, approvedBy);
      for (const reference of [
        "too short",
        "Synthetic\nrecord with a line break",
        "delegate:synthetic-record",
      ])
        await assert.rejects(approve({ reference }), /PACKAGE_APPROVAL_REFERENCE_INVALID/, reference);
      for (const hours of [0, 25, 1.5, Number.NaN])
        await assert.rejects(approve({ hours }), /PACKAGE_APPROVAL_HOURS_INVALID/, String(hours));
      // A package with other limits than the current allocation is refused under its own id.
      const widened = structuredClone(pkg) as unknown as { laneAttemptLimits: { publication: number } };
      widened.laneAttemptLimits.publication = 999;
      const wider = widened as unknown as FiniteAllocationPackage;
      await assert.rejects(
        approve({ confirmPackageId: allocationPackageId(wider) }, wider),
        /ALLOCATION_PACKAGE_INVALID/,
      );
      // So is the historical frozen package the 14 November decision packet names.
      const frozen = JSON.parse(
        await readFile(
          new URL(
            "../../../../../docs/valo/evidence/finite-allocation-package-disabled.json",
            import.meta.url,
          ),
          "utf8",
        ),
      );
      await assert.rejects(
        approve({ confirmPackageId: frozen.packageId }, frozen.package),
        /ALLOCATION_PACKAGE_INVALID/,
      );
      assert.deepEqual(await listFiniteAllocationApprovals(pool, schema), []);
      assert.equal((await pool.query(`SELECT count(*)::int n FROM ${batches}`)).rows[0].n, 0);
      await assert.rejects(readApprovedFiniteAllocationPackage(pool, id, schema), /NOT_AUTHORIZED/);

      // Recorded for exactly that package and period, and the dispatcher's own check accepts it.
      const approved = await approve();
      assert.equal(approved.packageId, id);
      assert.equal(approved.enabled, true);
      assert.equal(approved.approvedBy, "synthetic-owner");
      assert.equal(hoursOf(approved), 24);
      const admitted = await readApprovedFiniteAllocationPackage(pool, id, schema);
      assert.equal(allocationPackageId(admitted.pkg), id);
      assert.equal(admitted.expiresAt, approved.expiresAt);

      // Never repeated, extended or joined by a second package while it is current.
      await assert.rejects(approve(), /ANOTHER_PACKAGE_APPROVAL_CURRENT/);
      const other = await prepared(30);
      await assert.rejects(
        approve({ confirmPackageId: allocationPackageId(other) }, other),
        /ANOTHER_PACKAGE_APPROVAL_CURRENT/,
      );
      await assert.rejects(
        pool.query(`UPDATE ${batches} SET expires_at = expires_at + interval '1 day' WHERE id=$1`, [id]),
        /immutable/,
      );

      // Revocation stops admission at once and cannot be undone.
      const revoked = await revokeFiniteAllocationPackage(pool, id, schema);
      assert.deepEqual([revoked.enabled, revoked.wasEnabled], [false, true]);
      await assert.rejects(readApprovedFiniteAllocationPackage(pool, id, schema), /NOT_AUTHORIZED/);
      await assert.rejects(pool.query(`UPDATE ${batches} SET enabled=true WHERE id=$1`, [id]), /immutable/);
      await assert.rejects(approve(), /PACKAGE_ALREADY_RECORDED/);
      await assert.rejects(
        revokeFiniteAllocationPackage(pool, `finite-package:${"1".repeat(64)}`, schema),
        /APPROVED_PACKAGE_NOT_FOUND/,
      );

      // With none current, another exact package can be approved, here for two hours.
      const otherId = allocationPackageId(other);
      const second = await approve({ confirmPackageId: otherId, hours: 2 }, other);
      assert.equal(hoursOf(second), 2);
      assert.deepEqual(
        (await listFiniteAllocationApprovals(pool, schema)).map((a) => [a.packageId, a.enabled]),
        [
          [id, false],
          [otherId, true],
        ],
      );
      await revokeFiniteAllocationPackage(pool, otherId, schema);

      // Two approvals of different packages at the same moment: exactly one is recorded.
      const racing = [await prepared(20), await prepared(10)];
      const results = await Promise.allSettled(
        racing.map((value) => approve({ confirmPackageId: allocationPackageId(value) }, value)),
      );
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      const refused = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
      assert.match(String(refused?.reason), /ANOTHER_PACKAGE_APPROVAL_CURRENT/);
      assert.equal((await listFiniteAllocationApprovals(pool, schema)).filter((a) => a.enabled).length, 1);
    } finally {
      await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
    }
  },
);
