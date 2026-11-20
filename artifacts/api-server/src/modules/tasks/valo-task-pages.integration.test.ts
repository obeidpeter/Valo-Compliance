import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { db, pool, valoTasks, valoWorkspaces, valoMemberships, valoEvents } from "@workspace/db";
import { resolveWorkspace } from "../workspaces";
import { listTasksPage } from "./valo-tasks";
test(
  "actual task pages exceed 200 without losing totals, filters or tenant scope",
  { timeout: 30000, skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only" },
  async () => {
    assert.equal(process.env.NODE_ENV, "development");
    assert.ok(!process.env.REPLIT_DEPLOYMENT);
    const a = await resolveWorkspace(`synthetic-task-pages-${randomUUID()}`),
      b = await resolveWorkspace(`synthetic-task-pages-${randomUUID()}`);
    const workspaces = [a.workspaceId, b.workspaceId];
    try {
      await db.insert(valoTasks).values(
        Array.from({ length: 206 }, (_, i) => ({
          id: randomUUID(),
          workspaceId: a.workspaceId,
          actorId: a.identityId,
          title: `Synthetic page task ${i}`,
          notes: "Controlled database fixture",
          state: (i < 55 ? "completed_by_user" : "not_started") as "completed_by_user" | "not_started",
          deletedAt: i === 205 ? new Date() : null,
        })),
      );
      await db.insert(valoTasks).values(
        Array.from({ length: 3 }, () => ({
          id: randomUUID(),
          workspaceId: b.workspaceId,
          actorId: b.identityId,
          notes: "",
          title: "Other synthetic workspace",
        })),
      );
      const seen = new Set<string>();
      for (let page = 1; page <= 11; page++) {
        const result = await listTasksPage(a, { page, filter: "all" });
        assert.equal(result.total, 205);
        assert.equal(result.openCount, 150);
        assert.equal(result.filteredTotal, 205);
        assert.equal(result.items.length, page === 11 ? 5 : 20);
        assert.equal(result.hasNext, page < 11);
        for (const task of result.items) {
          assert.ok(!seen.has(task.id));
          seen.add(task.id);
        }
      }
      assert.equal(seen.size, 205);
      const empty = await listTasksPage(a, { page: 12, filter: "all" });
      assert.equal(empty.items.length, 0);
      assert.equal(empty.hasNext, false);
      const done = await listTasksPage(a, { page: 3, filter: "done" });
      assert.equal(done.filteredTotal, 55);
      assert.equal(done.items.length, 15);
      assert.equal(done.hasNext, false);
      assert.ok(done.items.every((t) => t.state === "completed_by_user"));
      const open = await listTasksPage(a, { page: 8, filter: "open" });
      assert.equal(open.filteredTotal, 150);
      assert.equal(open.items.length, 10);
      const other = await listTasksPage(b, { filter: "all" });
      assert.equal(other.total, 3);
      assert.ok(other.items.every((t) => !seen.has(t.id)));
      await assert.rejects(listTasksPage(a, { page: 0 }));
      await assert.rejects(listTasksPage(a, { filter: "invalid" }));
      await assert.rejects(listTasksPage(a, { workspaceId: b.workspaceId }));
    } finally {
      await db.delete(valoTasks).where(inArray(valoTasks.workspaceId, workspaces));
      await db.delete(valoEvents).where(inArray(valoEvents.workspaceId, workspaces));
      await db.delete(valoMemberships).where(inArray(valoMemberships.workspaceId, workspaces));
      await db.delete(valoWorkspaces).where(inArray(valoWorkspaces.id, workspaces));
      await pool.end();
    }
  },
);
