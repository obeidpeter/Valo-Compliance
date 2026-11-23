import type { BusinessDocument, Profile } from "@workspace/api-client-react";
import type { GuidedData, GuidedTemplateId } from "@workspace/valo-core/guided";
import { GUIDED_SPECS_V1 } from "@workspace/valo-core/guided-specs";
import { emptyGuidedData, guidedDataFromBlocks, guidedFieldIssue } from "@workspace/valo-core/guided-runtime";

/**
 * Sender/issuer fields that a business owner may explicitly choose to copy from an earlier saved
 * document into a new guided document. Recipient, reference, date, line-item, tax, and
 * acknowledgement fields are intentionally excluded.
 */
export const REUSABLE_ISSUER_FIELD_IDS = [
  "issuerName",
  "issuerAddress",
  "issuerLegalForm",
  "issuerRegistration",
  "paymentInstructions",
] as const;

export type ReusableIssuerFieldId = (typeof REUSABLE_ISSUER_FIELD_IDS)[number];

export type ReusableIssuerDetails = Partial<Record<ReusableIssuerFieldId, string>>;

/**
 * Returns the trimmed saved business name when it is valid to prefill as a document's issuing
 * business, employer, or first-party name — never returning blanks, placeholder markers, or values
 * that violate guided field constraints.
 */
export function savedBusinessName(profile: Pick<Profile, "businessName"> | null | undefined): string {
  const candidate = profile?.businessName?.trim() ?? "";
  if (!candidate) return "";
  const issuerField = GUIDED_SPECS_V1["TPL-01"].fields.find((field) => field.id === "issuerName");
  if (!issuerField || guidedFieldIssue(issuerField, candidate)) return "";
  return candidate;
}

/**
 * Builds initial guided answers for a new document, carrying forward only the business owner's
 * saved business name (`issuerName`). Legal-form authority assumptions, street addresses, governing
 * jurisdiction, dates, amounts, and counterparty details stay empty so Valo never assumes or clears
 * required facts the owner has not confirmed for this document.
 */
export function prefillGuidedData(
  templateId: GuidedTemplateId,
  profile: Pick<Profile, "businessName"> | null | undefined,
): GuidedData {
  const data = emptyGuidedData(templateId);
  const name = savedBusinessName(profile);
  if (!name) return data;
  const issuerField = GUIDED_SPECS_V1[templateId].fields.find((field) => field.id === "issuerName");
  if (issuerField && !guidedFieldIssue(issuerField, name)) {
    data.values.issuerName = name;
  }
  return data;
}

/** Extracts confirmed sender/issuer details from a previously saved document for opt-in reuse. */
export function extractReusableIssuerDetails(doc: Pick<BusinessDocument, "content">): ReusableIssuerDetails {
  const details: ReusableIssuerDetails = {};
  let guided: GuidedData | null = null;
  try {
    guided = guidedDataFromBlocks(doc.content.blocks);
  } catch {
    // Non-guided or unsupported block shapes fall back to the document header's issuerName.
    guided = null;
  }
  if (guided) {
    for (const id of REUSABLE_ISSUER_FIELD_IDS) {
      const value = guided.values[id]?.trim();
      if (value) details[id] = value;
    }
    return details;
  }
  const issuerName = doc.content.fields.issuerName.trim();
  if (issuerName) details.issuerName = issuerName;
  return details;
}

/**
 * Applies explicitly chosen sender/issuer details onto a guided document's answers, keeping only
 * fields defined on the target template that satisfy field validation.
 */
export function applyIssuerDetailsToGuided(
  current: GuidedData,
  details: ReusableIssuerDetails,
): { data: GuidedData; appliedLabels: string[] } {
  const spec = GUIDED_SPECS_V1[current.templateId];
  const values = { ...current.values };
  const appliedLabels: string[] = [];

  for (const id of REUSABLE_ISSUER_FIELD_IDS) {
    const candidate = details[id]?.trim();
    if (!candidate) continue;
    const field = spec.fields.find((item) => item.id === id);
    if (!field || guidedFieldIssue(field, candidate)) continue;
    values[id] = candidate;
    appliedLabels.push(field.label);
  }

  return { data: { ...current, values }, appliedLabels };
}
