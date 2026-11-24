import type { BusinessDocument, CanonicalDocument, Profile } from "@workspace/api-client-react";
import type { GuidedData, GuidedTemplateId } from "@workspace/valo-core/guided";
import { GUIDED_SPECS_V1 } from "@workspace/valo-core/guided-specs";
import { GUIDED_SPECS_V2 } from "@workspace/valo-core/guided-specs-v2";
import {
  emptyGuidedData,
  guidedDataFromBlocks,
  guidedFieldIssue,
  guidedRenderableBlocks,
} from "@workspace/valo-core/guided-runtime";
import { FIELD_LABELS } from "./api";
import type { FormValue } from "./form-view";
import { formatDay } from "./format";

/** The questions of a document's form, of either version: a v2 form asks v1's questions, by reference. */
function formFields(current: FormValue) {
  return current.schemaVersion === 2
    ? (GUIDED_SPECS_V2[current.templateId]?.fields ?? [])
    : GUIDED_SPECS_V1[current.templateId].fields;
}

/** A saved document's answers, from a form of either version, or null for one typed by hand. */
function savedAnswers(doc: Pick<BusinessDocument, "content">): Record<string, string> | null {
  if (doc.content.formAnswers) return doc.content.formAnswers.values;
  try {
    return guidedDataFromBlocks(doc.content.blocks)?.values ?? null;
  } catch {
    // Unsupported block shapes are read as a document typed by hand: only its header is reused.
    return null;
  }
}

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

/** Counterparty/customer fields that a business owner may explicitly choose to reuse for repeat billing. */
export const REUSABLE_CUSTOMER_FIELD_IDS = [
  "recipientName",
  "recipientAddress",
  "recipientLegalForm",
  "recipientRegistration",
] as const;

export type ReusableCustomerFieldId = (typeof REUSABLE_CUSTOMER_FIELD_IDS)[number];

export type ReusableCustomerDetails = Partial<Record<ReusableCustomerFieldId, string>>;

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
  const answers = savedAnswers(doc);
  if (answers) {
    for (const id of REUSABLE_ISSUER_FIELD_IDS) {
      const value = answers[id]?.trim();
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
export function applyIssuerDetailsToGuided<T extends FormValue>(
  current: T,
  details: ReusableIssuerDetails,
): { data: T; appliedLabels: string[] } {
  const fields = formFields(current);
  const values = { ...current.values };
  const appliedLabels: string[] = [];

  for (const id of REUSABLE_ISSUER_FIELD_IDS) {
    const candidate = details[id]?.trim();
    if (!candidate) continue;
    const field = fields.find((item) => item.id === id);
    if (!field || guidedFieldIssue(field, candidate)) continue;
    values[id] = candidate;
    appliedLabels.push(field.label);
  }

  return { data: { ...current, values }, appliedLabels };
}

/** Extracts counterparty/customer details from a saved document for opt-in repeat billing reuse. */
export function extractReusableCustomerDetails(
  doc: Pick<BusinessDocument, "content">,
): ReusableCustomerDetails {
  const details: ReusableCustomerDetails = {};
  const answers = savedAnswers(doc);
  if (answers) {
    for (const id of REUSABLE_CUSTOMER_FIELD_IDS) {
      const value = answers[id]?.trim();
      if (value) details[id] = value;
    }
    return details;
  }
  const recipientName = doc.content.fields.recipientName.trim();
  if (recipientName) details.recipientName = recipientName;
  return details;
}

/** Applies explicitly selected customer/counterparty details onto a guided document's answers. */
export function applyCustomerDetailsToGuided<T extends FormValue>(
  current: T,
  details: ReusableCustomerDetails,
): { data: T; appliedLabels: string[] } {
  const fields = formFields(current);
  const values = { ...current.values };
  const appliedLabels: string[] = [];

  for (const id of REUSABLE_CUSTOMER_FIELD_IDS) {
    const candidate = details[id]?.trim();
    if (!candidate) continue;
    const field = fields.find((item) => item.id === id);
    if (!field || guidedFieldIssue(field, candidate)) continue;
    values[id] = candidate;
    appliedLabels.push(field.label);
  }

  return { data: { ...current, values }, appliedLabels };
}

/** Returns deduplicated customer/recipient names extracted from previously saved documents. */
export function uniqueSavedCustomerNames(docs: readonly Pick<BusinessDocument, "content">[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const doc of docs) {
    const name = extractReusableCustomerDetails(doc).recipientName?.trim();
    if (!name) continue;
    const norm = name.toLowerCase();
    if (seen.has(norm)) continue;
    seen.add(norm);
    names.push(name);
  }
  return names;
}

/** Formats a clean plain-text draft summary of a document for quick copy-paste into WhatsApp or email. */
export function formatDocumentPlainText(title: string, content: CanonicalDocument): string {
  const lines: string[] = [
    `${(title.trim() || "Untitled document").toUpperCase()} (DRAFT)`,
    "Your own draft — not reviewed by Valo and not legal, tax or payment confirmation.",
    "",
  ];
  const guided = content.blocks.some((b) => b.id.startsWith("guided-"));
  if (!guided) {
    const fields = content.fields;
    for (const key of ["issuerName", "recipientName", "documentNumber", "issueDate", "dueDate"] as const) {
      const raw = fields[key]?.trim();
      if (!raw) continue;
      const shown = key === "issueDate" || key === "dueDate" ? formatDay(raw) : raw;
      lines.push(`${FIELD_LABELS[key]}: ${shown}`);
    }
    if (lines[lines.length - 1] !== "") lines.push("");
  }

  for (const block of guidedRenderableBlocks(content)) {
    if (block.type === "table") {
      for (const row of block.rows) {
        lines.push(row.filter(Boolean).join(" | "));
      }
      lines.push("");
    } else if (block.type === "list") {
      for (const item of block.text.split("\n").filter((l) => l.trim())) {
        lines.push(`- ${item.trim()}`);
      }
      lines.push("");
    } else if (block.text.trim()) {
      lines.push(block.text.trim(), "");
    }
  }

  if (!guided && content.fields.notes.trim()) {
    lines.push("Notes:", content.fields.notes.trim());
  }

  return lines.join("\n").trim();
}
