import type { BusinessDocument } from "@workspace/api-client-react";
import { guidedDataFromBlocks } from "@workspace/valo-core/guided-runtime";
import { GUIDED_SPECS_V1 } from "@workspace/valo-core/guided-specs";
import { missingFields } from "./api";

export type DocumentStatusFilter = "all" | "incomplete" | "complete";

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

/** Filter saved documents by title query and completeness status. */
export function filterDocuments(
  docs: readonly BusinessDocument[],
  query: string,
  status: DocumentStatusFilter,
): BusinessDocument[] {
  const trimmed = query.trim().toLowerCase();
  return docs.filter((doc) => {
    if (trimmed && !doc.title.toLowerCase().includes(trimmed)) return false;
    if (status === "all") return true;
    const miss = missingFields(doc.content).length;
    return status === "incomplete" ? miss > 0 : miss === 0;
  });
}
