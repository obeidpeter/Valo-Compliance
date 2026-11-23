import assert from "node:assert/strict";
import { test } from "node:test";
import { dirtyStaffPanels, formatStaffCell, formatStaffColumn } from "./staff-table";

test("formatStaffColumn turns camelCase and snake_case keys into readable headers", () => {
  assert.equal(formatStaffColumn("createdAt"), "Created");
  assert.equal(formatStaffColumn("contentVersionId"), "Content version ID");
  assert.equal(formatStaffColumn("delivery_status"), "Delivery status");
  assert.equal(formatStaffColumn("assigneeIdentityId"), "Assignee identity ID");
});

test("formatStaffCell formats empty values, booleans, dates, arrays, and structured objects cleanly", () => {
  assert.deepEqual(formatStaffCell(null), { summary: "—" });
  assert.deepEqual(formatStaffCell(true), { summary: "Yes" });
  assert.deepEqual(formatStaffCell(false), { summary: "No" });
  assert.deepEqual(formatStaffCell(["a", "b"]), { summary: "a, b" });

  const dateCell = formatStaffCell("2026-11-23T08:00:00.000Z");
  assert.ok(dateCell.summary.includes("2026"), dateCell.summary);
  assert.equal(dateCell.detail, undefined);

  const objCell = formatStaffCell({ status: "held", count: 2 });
  assert.equal(objCell.summary, "2 fields");
  assert.ok(objCell.detail?.includes('"status": "held"'));
});

test("dirtyStaffPanels lists each sub-panel with unsaved edits", () => {
  assert.deepEqual(dirtyStaffPanels({ support: false, content: false, manual: false }), []);
  assert.deepEqual(dirtyStaffPanels({ support: true, content: false, manual: true }), [
    "Support cases",
    "Manual content editor",
  ]);
});
