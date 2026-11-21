import { test } from "node:test";
import assert from "node:assert/strict";
import { GUIDED_TEMPLATE_IDS } from "@workspace/valo-core/guided";
import { GUIDED_SPECS_V1 } from "@workspace/valo-core/guided-specs";
import { NAMED_IN_LEAD, landingTasks } from "./landing-tasks";

/** What each task's documents are called in the workspace's starter. A task's words on the landing
 * page were written for these documents: when one is renamed, its task's words are due a look. */
const DOCUMENTS: Record<string, string[]> = {
  "Send an invoice": ["Invoice"],
  "Give a quotation": ["Quotation"],
  "Issue a receipt": ["Receipt"],
  "Chase a late payment": ["Payment reminder letter"],
  "Order from a supplier": ["Purchase order"],
  "Record a delivery": ["Delivery note"],
  "Hire someone": ["Offer letter", "Employment contract"],
  "Sign an agreement": ["Service agreement", "Consultancy agreement", "Non-disclosure agreement"],
};

test("every task the landing page offers is done with documents the workspace's starter can start today", () => {
  const tasks = landingTasks();
  assert.deepEqual(
    tasks.map((task) => task.task),
    Object.keys(DOCUMENTS),
  );
  for (const task of tasks) {
    assert.ok(task.documents.length > 0, task.task);
    for (const id of task.documents) assert.ok(GUIDED_TEMPLATE_IDS.includes(id), `${task.task}: ${id}`);
    assert.deepEqual(
      task.documents.map((id) => GUIDED_SPECS_V1[id].title),
      DOCUMENTS[task.task],
      task.task,
    );
  }
  assert.equal(new Set(tasks.map((task) => task.id)).size, tasks.length, "each task has its own id");
});

test("a task leaves the landing page when the starter stops offering one of its documents", () => {
  const without = (gone: string) => landingTasks(GUIDED_TEMPLATE_IDS.filter((id) => id !== gone));
  // The invoice task needs the invoice.
  assert.equal(
    without("TPL-01").some((task) => task.id === "invoice"),
    false,
  );
  assert.equal(without("TPL-01").length, landingTasks().length - 1);
  // A task that names two documents needs both: its words promise either.
  assert.equal(
    without("TPL-16").some((task) => task.id === "hire"),
    false,
  );
  assert.equal(
    without("TPL-15").some((task) => task.id === "agreement"),
    false,
  );
  // A document no task names changes nothing.
  assert.equal(without("TPL-08").length, landingTasks().length);
  assert.deepEqual(landingTasks([]), []);
});

test("the documents the landing page's opening sentence names are ones the starter offers", () => {
  assert.deepEqual(
    NAMED_IN_LEAD.map((id) => GUIDED_SPECS_V1[id].title),
    ["Invoice", "Quotation", "Receipt", "Service agreement"],
  );
  for (const id of NAMED_IN_LEAD) assert.ok(GUIDED_TEMPLATE_IDS.includes(id), id);
});
