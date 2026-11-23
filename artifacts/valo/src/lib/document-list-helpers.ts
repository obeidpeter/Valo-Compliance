import type { BusinessDocument, CanonicalDocument } from "@workspace/api-client-react";
import { guidedDataFromBlocks } from "@workspace/valo-core/guided-runtime";
import { GUIDED_SPECS_V1 } from "@workspace/valo-core/guided-specs";
import { missingFields } from "./api";

export type DocumentStatusFilter = "all" | "incomplete" | "complete" | "hidden";

export const HIDDEN_DOCS_STORAGE_NAME = "valo-hidden-docs-v1";

const DEFAULT_TITLES = new Set<string>([
  "",
  "untitled document",
  ...Object.values(GUIDED_SPECS_V1).map((spec) => spec.title.toLowerCase()),
]);

function readRecipientAndNumber(content: CanonicalDocument): {
  recipient: string;
  reference: string;
  kindTitle: string;
} {
  try {
    const guided = guidedDataFromBlocks(content.blocks);
    if (guided && guided.templateId in GUIDED_SPECS_V1) {
      return {
        recipient: (guided.values.recipientName ?? content.fields.recipientName ?? "").trim(),
        reference: (guided.values.documentNumber ?? content.fields.documentNumber ?? "").trim(),
        kindTitle: GUIDED_SPECS_V1[guided.templateId].title,
      };
    }
  } catch {
    // Fall back safely when guided metadata cannot be parsed.
  }
  return {
    recipient: (content.fields.recipientName ?? "").trim(),
    reference: (content.fields.documentNumber ?? "").trim(),
    kindTitle: "Document",
  };
}

/** A plain customer-facing label for what kind of document this is (e.g. "Invoice", "Freeform"). */
export function documentKindLabel(doc: Pick<BusinessDocument, "content">): string {
  try {
    const guided = guidedDataFromBlocks(doc.content.blocks);
    if (guided && guided.templateId in GUIDED_SPECS_V1) return GUIDED_SPECS_V1[guided.templateId].title;
  } catch {
    // Fall back safely when guided metadata cannot be parsed.
  }
  return "Freeform";
}

/** Concise recipient + document reference subtitle so similarly titled documents are easy to tell apart. */
export function documentContextSubtitle(doc: Pick<BusinessDocument, "content">): string {
  const { recipient, reference } = readRecipientAndNumber(doc.content);
  return [recipient, reference].filter(Boolean).join(" · ");
}

/**
 * Suggests a clearer title (e.g. "Invoice — Acme Stores (INV-007)") when the current title is still
 * a generic template default and the owner has filled in a counterparty name or document reference.
 */
export function suggestedDocumentTitle(title: string, content: CanonicalDocument): string | null {
  const current = title.trim();
  if (!DEFAULT_TITLES.has(current.toLowerCase())) return null;
  const { recipient, reference, kindTitle } = readRecipientAndNumber(content);
  if (!recipient && !reference) return null;
  const base = current || kindTitle;
  const detail = recipient && reference ? `${recipient} (${reference})` : recipient || reference;
  const candidate = `${base} — ${detail}`.slice(0, 120).trim();
  return candidate.toLowerCase() === current.toLowerCase() ? null : candidate;
}

/** Returns distinct document type labels present in a list, sorted alphabetically for filter pills. */
export function documentKindOptions(docs: readonly Pick<BusinessDocument, "content">[]): string[] {
  const kinds = new Set<string>();
  for (const doc of docs) kinds.add(documentKindLabel(doc));
  return [...kinds].sort((a, b) => a.localeCompare(b));
}

/** Filter saved documents by title/context query, completeness status, hidden set, and optional type label. */
export function filterDocuments(
  docs: readonly BusinessDocument[],
  query: string,
  status: DocumentStatusFilter,
  hiddenIds: ReadonlySet<string> = new Set(),
  kindFilter = "all",
): BusinessDocument[] {
  const trimmed = query.trim().toLowerCase();
  return docs.filter((doc) => {
    const isHidden = hiddenIds.has(doc.id);
    if (status === "hidden") {
      if (!isHidden) return false;
    } else if (isHidden) {
      return false;
    }
    const kind = documentKindLabel(doc);
    if (kindFilter !== "all" && kind !== kindFilter) return false;
    if (trimmed) {
      const haystack = `${doc.title} ${documentContextSubtitle(doc)} ${kind}`.toLowerCase();
      if (!haystack.includes(trimmed)) return false;
    }
    if (status === "all" || status === "hidden") return true;
    const miss = missingFields(doc.content).length;
    return status === "incomplete" ? miss > 0 : miss === 0;
  });
}

export function readHiddenDocumentIds(storage?: Pick<Storage, "getItem"> | null): Set<string> {
  const target =
    storage === undefined ? (typeof window !== "undefined" ? window.localStorage : null) : storage;
  if (!target) return new Set();
  try {
    const raw = target.getItem(HIDDEN_DOCS_STORAGE_NAME);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((item): item is string => typeof item === "string" && item.length > 0));
  } catch {
    // Corrupt or restricted local storage defaults cleanly to showing every document.
    return new Set();
  }
}

export function writeHiddenDocumentIds(
  ids: ReadonlySet<string>,
  storage?: Pick<Storage, "setItem"> | null,
): void {
  const target =
    storage === undefined ? (typeof window !== "undefined" ? window.localStorage : null) : storage;
  if (!target) return;
  try {
    target.setItem(HIDDEN_DOCS_STORAGE_NAME, JSON.stringify([...ids]));
  } catch {
    // Storage-restricted browsers still keep hidden state in memory for the current session.
  }
}
