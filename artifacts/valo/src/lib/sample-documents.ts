import type { CanonicalDocument } from "@workspace/api-client-react";
import type { GuidedTemplateId } from "@workspace/valo-core/guided";
import { compileGuidedContent, emptyGuidedData } from "@workspace/valo-core/guided-runtime";

export type SampleDocumentPreviewItem = {
  id: GuidedTemplateId;
  taskId: string;
  label: string;
  title: string;
  caption: string;
  content: CanonicalDocument;
};

function buildSampleInvoice(): CanonicalDocument {
  const data = emptyGuidedData("TPL-01");
  data.values.issuerName = "Synthetic Trading Ltd";
  data.values.issuerAddress = "14 Synthetic Way, Ikeja, Lagos";
  data.values.recipientName = "Synthetic Customer Enterprises";
  data.values.recipientAddress = "8 Sample Crescent, Yaba, Lagos";
  data.values.documentNumber = "INV-2026-014";
  data.values.issueDate = "2026-11-18";
  data.values.dueDate = "2026-12-02";
  data.values.billingBasis = "Supply and delivery of packaged household supplies as agreed.";
  data.values.taxMode = "none";
  data.values.discountMode = "none";
  data.values.paymentInstructions =
    "Bank transfer to Synthetic Bank — Account 0000000000 (Synthetic Trading Ltd).";
  data.tables.items = [
    {
      description: "Packaged retail cartons (20-pack)",
      quantity: "3",
      unit: "each",
      otherUnit: "",
      unitPriceKobo: "2500000",
    },
    {
      description: "Same-day Ikeja to Yaba delivery",
      quantity: "1",
      unit: "each",
      otherUnit: "",
      unitPriceKobo: "850000",
    },
  ];
  return compileGuidedContent(data) as CanonicalDocument;
}

function buildSampleQuotation(): CanonicalDocument {
  const data = emptyGuidedData("TPL-02");
  data.values.issuerName = "Synthetic Studio Services Ltd";
  data.values.issuerAddress = "22 Sample Road, Surulere, Lagos";
  data.values.recipientName = "Synthetic Hospitality Group";
  data.values.documentNumber = "QUO-2026-009";
  data.values.issueDate = "2026-11-18";
  data.values.validUntil = "2026-12-02";
  data.values.scope = "Menu photography, print-ready layout, and social-media image pack.";
  data.values.exclusions = "Physical printing and third-party courier fees.";
  data.values.taxMode = "none";
  data.values.discountMode = "none";
  data.values.acceptance = "Reply in writing to confirm scope; 50% deposit before shoot day.";
  data.tables.items = [
    {
      description: "Half-day on-site photography session",
      quantity: "1",
      unit: "each",
      otherUnit: "",
      unitPriceKobo: "12000000",
    },
    {
      description: "Edited print & web deliverables",
      quantity: "1",
      unit: "each",
      otherUnit: "",
      unitPriceKobo: "4500000",
    },
  ];
  return compileGuidedContent(data) as CanonicalDocument;
}

function buildSampleReceipt(): CanonicalDocument {
  const data = emptyGuidedData("TPL-03");
  data.values.issuerName = "Synthetic Trading Ltd";
  data.values.issuerAddress = "14 Synthetic Way, Ikeja, Lagos";
  data.values.recipientName = "Synthetic Customer Enterprises";
  data.values.documentNumber = "RCP-2026-041";
  data.values.issueDate = "2026-11-18";
  data.values.paymentDate = "2026-11-18";
  data.values.receivedKobo = "8350000";
  data.values.paymentMethod = "transfer";
  data.values.paymentReference = "SYNTH-TRF-0014";
  data.values.purpose = "Full settlement for invoice INV-2026-014.";
  data.values.acknowledgement = "yes";
  return compileGuidedContent(data) as CanonicalDocument;
}

/** Clearly labeled synthetic Nigerian SME samples so visitors can see finished layouts before signing up. */
export function buildPublicSampleDocuments(): SampleDocumentPreviewItem[] {
  return [
    {
      id: "TPL-01",
      taskId: "invoice",
      label: "Invoice",
      title: "Sample invoice",
      caption: "Itemised charges, automatic totals, and your own payment instructions.",
      content: buildSampleInvoice(),
    },
    {
      id: "TPL-02",
      taskId: "quotation",
      label: "Quotation",
      title: "Sample quotation",
      caption: "Clear scope, exclusions, expiry date, and acceptance terms.",
      content: buildSampleQuotation(),
    },
    {
      id: "TPL-03",
      taskId: "receipt",
      label: "Receipt",
      title: "Sample payment receipt",
      caption: "Customer acknowledgement with payment date, method, and reference.",
      content: buildSampleReceipt(),
    },
  ];
}
