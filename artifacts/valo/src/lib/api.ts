import type { CanonicalDocument, DocumentBlock } from "@workspace/api-client-react";
import {
  DOCUMENT_FIELD_LABELS,
  guidedDataFromBlocks,
  guidedDataIssues,
  guidedFieldIssue,
  guidedRenderableBlocks,
} from "@workspace/valo-core/guided-runtime";
import type { GuidedTemplateId } from "@workspace/valo-core/guided";
import { GUIDED_SPECS_V1 } from "@workspace/valo-core/guided-specs";
import { GUIDED_SPECS_V2 } from "@workspace/valo-core/guided-specs-v2";

import { formIssues, formViewV2, type FormValue, type FormView } from "./form-view";
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

/** What a document still needs before it is complete, with jump selectors where a control exists. */
export function missingFieldItems(content: CanonicalDocument): MissingFieldItem[] {
  const out: MissingFieldItem[] = [];
  let visible: readonly DocumentBlock[] = content.blocks;
  const issueItems = (spec: Questions, issues: Record<string, string>) => {
    for (const [key, message] of Object.entries(issues)) {
      const selector = guidedIssueSelector(spec, key);
      out.push(
        selector
          ? { label: neededLine(spec, key, message), selector }
          : { label: neededLine(spec, key, message) },
      );
    }
  };
  try {
    const answers = guidedDataFromBlocks(content.blocks);
    if (content.formAnswers) {
      // A form document (forms v2) fills its template's own wording from its answers.
      const spec = GUIDED_SPECS_V2[content.formAnswers.templateId as GuidedTemplateId];
      if (!spec || answers) throw Error("UNSUPPORTED_FORM_DOCUMENT");
      const issues = formIssues(formViewV2(spec), content.formAnswers as FormValue);
      issueItems(spec, issues);
      // While an answer is missing or wrong, the blanks in the wording are its slots, already
      // listed by their questions; once the answers are complete, any blank left is listed below.
      if (Object.keys(issues).length) return out;
    } else if (answers) {
      const spec = GUIDED_SPECS_V1[answers.templateId];
      issueItems(spec, guidedDataIssues(spec, answers));
      // A v1 form's blocks are the contract's own; its runtime types them more loosely.
      visible = guidedRenderableBlocks(content) as DocumentBlock[];
    } else {
      (Object.keys(FIELD_LABELS) as (keyof CanonicalDocument["fields"])[]).forEach((k) => {
        if (!content.fields[k]?.trim()) out.push({ label: FIELD_LABELS[k], selector: `#f-${k}` });
      });
      if (!content.blocks.some((b) => b.text.trim() || b.rows.some((r) => r.some((c) => c.trim()))))
        out.push({ label: "The document's text", selector: '[data-testid="input-block-0"]' });
    }
  } catch {
    return [
      {
        label:
          "This document's saved questions cannot be read. Restore an earlier version, and do not treat this one as complete.",
      },
    ];
  }
  const body = visible.flatMap((b) => [b.text, ...b.rows.flat()]).join("\n");
  const placeholders = [...new Set(body.match(/\[[^\]\n]{0,140}\]|\{\{[^}\n]{1,140}\}\}|_{3,}/g) ?? [])];
  if (placeholders.length)
    out.push({
      label: `Blanks still in the text (${placeholders.length}): ${placeholders.slice(0, 5).join(", ")}`,
    });
  return out;
}

/** What a document still needs before it is complete, one line each, in the order of its questions. */
export function missingFields(content: CanonicalDocument): string[] {
  return missingFieldItems(content).map((item) => item.label);
}
