import type { CanonicalDocument, DocumentBlock } from "@workspace/api-client-react";
import {
  guidedDataFromBlocks,
  guidedDataIssues,
  guidedFieldIssue,
  guidedRenderableBlocks,
} from "@workspace/valo-core/guided-runtime";
import type { GuidedSpec } from "@workspace/valo-core/guided";
import { GUIDED_SPECS_V1 } from "@workspace/valo-core/guided-specs";

import { askedAs, saidAs } from "./guided-money";

export { describeError, type DescribedError, type ErrorKind } from "./describe-error";

export function newBlockId(): string {
  return "b_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function blankParagraph(): DocumentBlock {
  return { id: newBlockId(), type: "paragraph", text: "", rows: [] };
}

export function blankContent(): CanonicalDocument {
  return {
    fields: { issuerName: "", recipientName: "", documentNumber: "", issueDate: "", dueDate: "", notes: "" },
    blocks: [blankParagraph()],
    selectedClauses: [],
    formatting: { font: "serif", accent: "forest" },
  };
}

export const FIELD_LABELS: Record<keyof CanonicalDocument["fields"], string> = {
  issuerName: "Issued by",
  recipientName: "Addressed to",
  documentNumber: "Reference number",
  issueDate: "Issue date",
  dueDate: "Due date",
  notes: "Notes",
};

/** What the questions say of a required answer that was simply not given. */
const UNANSWERED = guidedFieldIssue({ id: "", label: "", type: "text", required: true }, "");

/**
 * One line of the list for something a guided document still needs: the question as the editor
 * asks it, a table's row and column by name, then what is wrong with the answer unless it was
 * simply not given.
 */
function neededLine(spec: GuidedSpec, key: string, message: string): string {
  const [tableId, row, columnId] = key.split(":");
  const field = spec.fields.find((f) => f.id === key);
  const table = spec.tables.find((t) => t.id === tableId);
  const column = table?.columns.find((c) => c.id === columnId);
  const name = field
    ? askedAs(field)
    : table && row !== undefined
      ? `${table.label}, row ${Number(row) + 1}: ${column ? askedAs(column) : columnId}`
      : table?.label;
  if (!name) return message;
  return message === UNANSWERED ? name : `${name}: ${saidAs(message)}`;
}

/** What a document still needs before it is complete, one line each, in the order of its questions. */
export function missingFields(content: CanonicalDocument): string[] {
  const out: string[] = [];
  let visible = content.blocks;
  try {
    const answers = guidedDataFromBlocks(content.blocks);
    if (answers) {
      const spec = GUIDED_SPECS_V1[answers.templateId];
      for (const [key, message] of Object.entries(guidedDataIssues(spec, answers)))
        out.push(neededLine(spec, key, message));
      visible = guidedRenderableBlocks(content);
    } else {
      (Object.keys(FIELD_LABELS) as (keyof CanonicalDocument["fields"])[]).forEach((k) => {
        if (!content.fields[k]?.trim()) out.push(FIELD_LABELS[k]);
      });
      if (!content.blocks.some((b) => b.text.trim() || b.rows.some((r) => r.some((c) => c.trim()))))
        out.push("The document's text");
    }
  } catch {
    return [
      "This document's saved questions cannot be read. Restore an earlier version, and do not treat this one as complete.",
    ];
  }
  const body = visible.flatMap((b) => [b.text, ...b.rows.flat()]).join("\n");
  const placeholders = [...new Set(body.match(/\[[^\]\n]{0,140}\]|\{\{[^}\n]{1,140}\}\}|_{3,}/g) ?? [])];
  if (placeholders.length)
    out.push(`Blanks still in the text (${placeholders.length}): ${placeholders.slice(0, 5).join(", ")}`);
  return out;
}
