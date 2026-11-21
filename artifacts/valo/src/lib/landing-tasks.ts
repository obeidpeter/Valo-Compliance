import { GUIDED_TEMPLATE_IDS, type GuidedTemplateId } from "@workspace/valo-core/guided";

/**
 * The everyday tasks the landing page offers, in the customer's words. Each names the documents it
 * is done with, by the starter's own ids, so the page lists a task only while the workspace can
 * start every one of its documents: a task leaves the page with its document, and the page never
 * offers something Valo cannot make.
 */
export type LandingTask = {
  id: string;
  /** What the customer wants to do. */
  task: string;
  /** The document, in a few words. */
  with: string;
  documents: readonly GuidedTemplateId[];
};

const TASKS: readonly LandingTask[] = [
  { id: "invoice", task: "Send an invoice", with: "Bill a customer", documents: ["TPL-01"] },
  { id: "quotation", task: "Give a quotation", with: "Price a job before you start", documents: ["TPL-02"] },
  { id: "receipt", task: "Issue a receipt", with: "Confirm a payment", documents: ["TPL-03"] },
  { id: "reminder", task: "Chase a late payment", with: "A payment reminder letter", documents: ["TPL-12"] },
  { id: "order", task: "Order from a supplier", with: "Purchase order", documents: ["TPL-04"] },
  { id: "delivery", task: "Record a delivery", with: "Delivery note", documents: ["TPL-05"] },
  {
    id: "hire",
    task: "Hire someone",
    with: "Offer letter or employment contract",
    documents: ["TPL-17", "TPL-16"],
  },
  {
    id: "agreement",
    task: "Sign an agreement",
    with: "Service, consultancy or non-disclosure",
    documents: ["TPL-13", "TPL-14", "TPL-15"],
  },
];

/** The tasks to show: those whose every document the starter offers. */
export const landingTasks = (offered: readonly string[] = GUIDED_TEMPLATE_IDS): LandingTask[] =>
  TASKS.filter((task) => task.documents.every((id) => offered.includes(id)));

/** The documents the landing page's opening sentence names: invoices, quotations, receipts and
 * agreements. The sentence is written only while the starter offers each kind. */
export const NAMED_IN_LEAD: readonly GuidedTemplateId[] = ["TPL-01", "TPL-02", "TPL-03", "TPL-13"];
