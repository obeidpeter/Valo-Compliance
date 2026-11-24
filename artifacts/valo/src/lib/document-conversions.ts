import type { CanonicalDocument } from "@workspace/api-client-react";
import { GUIDED_TEMPLATE_IDS, type GuidedData, type GuidedTemplateId } from "@workspace/valo-core/guided";
import { GUIDED_SPECS_V1 } from "@workspace/valo-core/guided-specs";
import {
  compileGuidedContent,
  emptyGuidedData,
  guidedDataFromBlocks,
  guidedFieldIssue,
} from "@workspace/valo-core/guided-runtime";

export type ConversionTargetId = "TPL-01" | "TPL-03";

export type DocumentConversionOption = {
  targetId: ConversionTargetId;
  label: string;
  description: string;
  defaultTitle: string;
};

/**
 * A guided document's answers: a v1 form's, read from its blocks, or a v2 form's (forms v2), which
 * asks v1's questions by the same names, so a conversion reads either alike.
 */
function readGuided(content: CanonicalDocument): Pick<GuidedData, "templateId" | "values" | "tables"> | null {
  if (content.formAnswers) {
    const { templateId, values, tables } = content.formAnswers;
    return (GUIDED_TEMPLATE_IDS as readonly string[]).includes(templateId)
      ? { templateId: templateId as GuidedTemplateId, values, tables }
      : null;
  }
  try {
    return guidedDataFromBlocks(content.blocks);
  } catch {
    // Unsupported or altered guided metadata offers no automatic conversion.
    return null;
  }
}

/**
 * What a converted document keeps of the one it is made from. A form document's own parts (forms
 * v2), its wording, answers and kept passages, stay with it: the new document takes only its note
 * and its formatting. Any other document passes its own text through, as before.
 */
function keptFrom(content: CanonicalDocument): CanonicalDocument {
  if (!content.formAnswers) return content;
  const { formAnswers: _answers, ...rest } = content;
  return { ...rest, blocks: [], selectedClauses: [] };
}

function copyIfValid(target: GuidedData, fieldId: string, raw: string | undefined) {
  const value = raw?.trim() ?? "";
  if (!value) return;
  const field = GUIDED_SPECS_V1[target.templateId].fields.find((f) => f.id === fieldId);
  if (!field || guidedFieldIssue(field, value)) return;
  target.values[fieldId] = value;
}

/**
 * Returns the next natural workflow document conversions for a saved guided document:
 * - Quotation (TPL-02) -> Invoice (TPL-01)
 * - Invoice (TPL-01) -> Payment receipt (TPL-03)
 */
export function availableConversions(content: CanonicalDocument): DocumentConversionOption[] {
  const guided = readGuided(content);
  if (!guided) return [];
  if (guided.templateId === "TPL-02") {
    return [
      {
        targetId: "TPL-01",
        label: "Turn into an Invoice",
        description:
          "Copies your business details, customer, scope, and line items. Leaves the invoice reference and dates blank for you to confirm.",
        defaultTitle: "Invoice",
      },
    ];
  }
  if (guided.templateId === "TPL-01") {
    return [
      {
        targetId: "TPL-03",
        label: "Issue a Receipt",
        description:
          "Copies your business details, payer, and invoice reference. Leaves payment date, amount received, method, and confirmation blank.",
        defaultTitle: "Receipt",
      },
    ];
  }
  return [];
}

/**
 * Converts a saved Quotation to an Invoice or a saved Invoice to a Receipt without inventing dates,
 * references, payment amounts, or confirmations. Returns null if the source cannot be converted.
 */
export function convertGuidedDocument(
  content: CanonicalDocument,
  targetId: ConversionTargetId,
): { title: string; content: CanonicalDocument } | null {
  const source = readGuided(content);
  if (!source) return null;

  if (source.templateId === "TPL-02" && targetId === "TPL-01") {
    const next = emptyGuidedData("TPL-01");
    for (const id of [
      "issuerName",
      "issuerAddress",
      "recipientName",
      "recipientAddress",
      "taxMode",
      "taxAmountKobo",
      "taxLabel",
      "taxBasis",
      "discountMode",
      "discountKobo",
      "notes",
    ]) {
      copyIfValid(next, id, source.values[id]);
    }
    copyIfValid(next, "billingBasis", source.values.scope);
    const sourceRows = source.tables.items ?? [];
    if (sourceRows.length > 0) {
      next.tables.items = sourceRows.map((row) => ({
        description: row.description ?? "",
        quantity: row.quantity ?? "",
        unit: row.unit ?? "",
        otherUnit: row.otherUnit ?? "",
        unitPriceKobo: row.unitPriceKobo ?? "",
      }));
    }
    const customer = source.values.recipientName?.trim();
    return {
      title: customer ? `Invoice — ${customer}`.slice(0, 120) : "Invoice",
      content: compileGuidedContent(next, keptFrom(content)) as CanonicalDocument,
    };
  }

  if (source.templateId === "TPL-01" && targetId === "TPL-03") {
    const next = emptyGuidedData("TPL-03");
    for (const id of ["issuerName", "issuerAddress", "recipientName", "recipientAddress"]) {
      copyIfValid(next, id, source.values[id]);
    }
    const invNumber = source.values.documentNumber?.trim();
    const billing = source.values.billingBasis?.trim();
    const purpose = invNumber
      ? billing
        ? `Payment for invoice ${invNumber}: ${billing}`.slice(0, 5000)
        : `Payment for invoice ${invNumber}`
      : (billing ?? "");
    copyIfValid(next, "purpose", purpose);
    const payer = source.values.recipientName?.trim();
    return {
      title: payer ? `Receipt — ${payer}`.slice(0, 120) : "Receipt",
      content: compileGuidedContent(next, keptFrom(content)) as CanonicalDocument,
    };
  }

  return null;
}
