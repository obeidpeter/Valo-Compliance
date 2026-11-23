import type { Profile } from "@workspace/api-client-react";
import type { GuidedData, GuidedTemplateId } from "@workspace/valo-core/guided";
import { GUIDED_SPECS_V1 } from "@workspace/valo-core/guided-specs";
import { emptyGuidedData, guidedFieldIssue } from "@workspace/valo-core/guided-runtime";

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
