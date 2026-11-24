import type { CanonicalDocument, DocumentBlock } from "@workspace/api-client-react";
import { DOCUMENT_FIELD_LABELS, guidedFieldIssue } from "@workspace/valo-core/guided-runtime";
import { GUIDED_SPECS_V1 } from "@workspace/valo-core/guided-specs";
import { GUIDED_SPECS_V2 } from "@workspace/valo-core/guided-specs-v2";
import { documentComplete, documentGaps } from "@workspace/valo-core/document-completeness";
import type { FormText } from "@workspace/valo-core/form-text";

import type { FormView } from "./form-view";
import { askedAs, saidAs } from "./guided-money";

export { describeError, type DescribedError, type ErrorKind } from "./describe-error";

export function newBlockId(): string {
  return "b_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function blankParagraph(): DocumentBlock {
  return { id: newBlockId(), type: "paragraph", text: "", rows: [] };
}

export function blankContent(issuerName = ""): CanonicalDocument {
  return {
    fields: {
      issuerName,
      recipientName: "",
      documentNumber: "",
      issueDate: "",
      dueDate: "",
      notes: "",
    },
    blocks: [blankParagraph()],
    selectedClauses: [],
    formatting: { font: "serif", accent: "forest" },
  };
}

/** A document's own fields by name, as the shared library gives them. */
export const FIELD_LABELS: Record<keyof CanonicalDocument["fields"], string> = DOCUMENT_FIELD_LABELS;

/** What the questions say of a required answer that was simply not given. */
const UNANSWERED = guidedFieldIssue({ id: "", label: "", type: "text", required: true }, "");

/** A form's questions, of either version, as far as naming and finding them needs. */
type Questions = Pick<FormView, "fields" | "tables">;

/**
 * One line of the list for something a guided document still needs: the question as the editor
 * asks it, a table's row and column by name, then what is wrong with the answer unless it was
 * simply not given.
 */
function neededLine(spec: Questions, key: string, message: string): string {
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

export type MissingFieldItem = {
  label: string;
  /** CSS selector for the editor control to focus when the customer clicks this item. */
  selector?: string;
};

function guidedIssueSelector(spec: Questions, key: string): string | undefined {
  const [tableId, row, columnId] = key.split(":");
  if (spec.fields.some((f) => f.id === key)) return `#g-${key}`;
  const table = spec.tables.find((t) => t.id === tableId);
  if (!table) return undefined;
  if (row !== undefined && columnId) return `#gt-${table.id}-${row}-${columnId}`;
  return `#gt-${table.id}-add`;
}

/** What a document still needs before it is complete, with jump selectors where a control exists:
 * what `documentGaps` finds, in the editor's words. Given a form document's form text, the blanks it
 * lists are the slots left unfilled, not the blanks completed by hand, such as signatures. */
export function missingFieldItems(
  content: CanonicalDocument,
  formText?: FormText | null,
): MissingFieldItem[] {
  const gaps = documentGaps(content, formText);
  if (gaps.kind === "unreadable")
    return [
      {
        label:
          "This document's saved questions cannot be read. Restore an earlier version, and do not treat this one as complete.",
      },
    ];
  const out: MissingFieldItem[] = [];
  if (gaps.kind === "typed") {
    for (const k of gaps.fields) out.push({ label: FIELD_LABELS[k], selector: `#f-${k}` });
    if (gaps.text) out.push({ label: "The document's text", selector: '[data-testid="input-block-0"]' });
  } else {
    const spec: Questions =
      gaps.kind === "form" ? GUIDED_SPECS_V2[gaps.templateId]! : GUIDED_SPECS_V1[gaps.templateId];
    for (const [key, message] of Object.entries(gaps.issues)) {
      const selector = guidedIssueSelector(spec, key);
      out.push(
        selector
          ? { label: neededLine(spec, key, message), selector }
          : { label: neededLine(spec, key, message) },
      );
    }
  }
  if (gaps.blanks.length)
    out.push({
      label: `Blanks still in the text (${gaps.blanks.length}): ${gaps.blanks.slice(0, 5).join(", ")}`,
    });
  return out;
}

/** Whether a document's file can be a finished one, without the draft notice
 * (docs/architecture/finished-file.md): complete, still lacking something, or typed by hand, which is
 * always made as a marked draft. The server checks the saved version again when the file is asked for. */
export function finishedFileState(
  content: CanonicalDocument,
  formText?: FormText | null,
): "complete" | "incomplete" | "typed" {
  const gaps = documentGaps(content, formText);
  return gaps.kind === "typed" ? "typed" : documentComplete(gaps) ? "complete" : "incomplete";
}

/** What a document still needs before it is complete, one line each, in the order of its questions. */
export function missingFields(content: CanonicalDocument): string[] {
  return missingFieldItems(content).map((item) => item.label);
}
