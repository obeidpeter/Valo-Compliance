import { test } from "node:test";
import assert from "node:assert/strict";
import { GUIDED_TEMPLATE_IDS } from "@workspace/valo-core/guided";
import { GUIDED_SPECS_V1 } from "@workspace/valo-core/guided-specs";
import { NAMED_IN_LEAD, landingTask, landingTasks, startPath } from "./landing-tasks";
import { ANY_DOCUMENT, signUpFor } from "./start";
import { checkoutSignInPath, templateCheckoutPath } from "./template-checkout";
import { templateDownloadSignInPath } from "./template-download";

test("free file sign-in returns to the chosen edition on Valo", () => {
  const edition = "684762b8-d9c3-4061-9348-b5bb6036d580";
  const slug = "synthetic-free-invoice";
  const signIn = new URL(templateDownloadSignInPath(edition, slug), "https://valo.example");
  const start = signIn.searchParams.get("start");
  assert.equal(startPath(start), "/library/" + slug + "#download-" + edition);
  assert.equal(signUpFor(start!), "/sign-up" + signIn.search);
  assert.equal(
    startPath("download-" + edition + "-invoice_v2.1"),
    "/library/invoice_v2.1#download-" + edition,
  );
  for (const invalid of [
    "download-" + edition + "-..",
    "download-bad-id-invoice",
    "download-" + edition + "-../staff",
    "download-" + edition + "-https://elsewhere.example",
  ]) {
    assert.equal(startPath(invalid), undefined);
  }
});

test("a checkout link carries only the selected price through sign-in and sign-up", () => {
  const id = "684762b8-d9c3-4061-9348-b5bb6036d580";
  const checkout = templateCheckoutPath(id);
  const signIn = checkoutSignInPath(checkout.split("?")[1]!);
  const start = new URL(signIn, "https://valo.example").searchParams.get("start");
  assert.equal(signIn, "/sign-in?start=checkout-" + id);
  assert.equal(startPath(start), checkout);
  assert.equal(signUpFor(start!), "/sign-up?start=checkout-" + id);
  for (const bad of ["", "another", id + "/other"]) {
    assert.equal(checkoutSignInPath("offer=" + encodeURIComponent(bad)), "/sign-in");
    assert.equal(startPath("checkout-" + bad), undefined);
  }
});

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

test("what a visitor chose before signing up leads to the page where a document starts, and a choice the site does not offer leads nowhere", () => {
  // "Create a document" asks for no task in particular.
  assert.equal(signUpFor(ANY_DOCUMENT), "/sign-up?start=document");
  assert.equal(startPath(ANY_DOCUMENT), "/workspace/documents/new");
  for (const task of landingTasks()) {
    assert.equal(signUpFor(task.id), `/sign-up?start=${task.id}`);
    assert.equal(startPath(task.id), `/workspace/documents/new?start=${task.id}`);
    assert.equal(landingTask(task.id), task);
  }
  // Only the site's own choices are turned into an address: nothing from outside is passed on.
  for (const made of [
    null,
    undefined,
    "",
    "nothing",
    "/staff",
    "//example.test",
    "https://example.test/",
    "invoice/../../staff",
    "INVOICE",
    "__proto__",
    "constructor",
  ]) {
    assert.equal(startPath(made), undefined, String(made));
    assert.equal(landingTask(made), undefined, String(made));
  }
});
