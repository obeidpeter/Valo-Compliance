import type { GuidedTemplateId } from "@workspace/valo-core/guided";

/**
 * What each document the workspace can start is for, in the customer's words. A line says what the
 * document records. It promises nothing about the document's effect: Valo does not review what a
 * customer writes, and a document made here is not proof of anything by itself.
 */
export const DOCUMENT_PURPOSES: Record<GuidedTemplateId, string> = {
  "TPL-01": "Bill a customer for goods or work.",
  "TPL-02": "Price a job before you start.",
  "TPL-03": "Acknowledge a payment you received.",
  "TPL-04": "Order goods from a supplier.",
  "TPL-05": "Record what was delivered, and to whom.",
  "TPL-08": "Record what a meeting discussed and decided.",
  "TPL-12": "Ask a customer to pay an invoice that is late.",
  "TPL-13": "Write down the terms of work you do for a client.",
  "TPL-14": "Write down the terms of a consultant's work.",
  "TPL-15": "Write down what two parties agree to keep confidential.",
  "TPL-16": "Write down the terms of a job.",
  "TPL-17": "Offer someone a job.",
};
