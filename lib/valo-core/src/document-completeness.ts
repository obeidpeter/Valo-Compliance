import type { GuidedTemplateId } from "./guided";
import {
  DOCUMENT_FIELD_LABELS,
  guidedDataFromBlocks,
  guidedDataIssues,
  guidedRenderableBlocks,
  type GuidedBlock,
} from "./guided-runtime-v1";
import { formAnswerIssues } from "./guided-runtime-v2";
import { GUIDED_SPECS_V1 } from "./guided-specs-v1";
import { GUIDED_SPECS_V2 } from "./guided-specs-v2";
import type { GuidedDataV2 } from "./guided-v2";

/** A blank a document's text can still hold: a bracketed placeholder, a `{{…}}` token or a line of
 * underscores. */
const DOCUMENT_BLANK = /\[[^\]\n]{0,140}\]|\{\{[^}\n]{1,140}\}\}|_{3,}/g;

type DocumentField = keyof typeof DOCUMENT_FIELD_LABELS;
/** A saved document, as far as telling what it still lacks needs. */
export type GapsContent = Parameters<typeof guidedRenderableBlocks>[0] & {
  formAnswers?: { templateId: string } | undefined;
};

/**
 * What a document still lacks before it is complete: the "Still needed" list of the editor, without
 * its words (docs/architecture/finished-file.md). A document made from a form (v2) or from questions
 * (v1) lacks its questions' issues, keyed as v1 keys them (by question, by `table:row:column` for a
 * cell and by table for its rows); one typed by hand lacks the fields it leaves empty, and its text
 * when it has none. Each lacks the blanks left in its text, unless a form's answers still have
 * issues: its blanks are then its slots, which the issues already name. A document whose questions
 * cannot be read is `unreadable`.
 */
export type DocumentGaps =
  | { kind: "unreadable" }
  | { kind: "form"; templateId: GuidedTemplateId; issues: Record<string, string>; blanks: string[] }
  | { kind: "questions"; templateId: GuidedTemplateId; issues: Record<string, string>; blanks: string[] }
  | { kind: "typed"; fields: DocumentField[]; text: boolean; blanks: string[] };

/** The blanks left in some blocks' text, each once, in order. */
const blanksIn = (blocks: readonly GuidedBlock[]) => [
  ...new Set(
    blocks
      .flatMap((block) => [block.text, ...block.rows.flat()])
      .join("\n")
      .match(DOCUMENT_BLANK) ?? [],
  ),
];

export function documentGaps(content: GapsContent): DocumentGaps {
  try {
    const answers = guidedDataFromBlocks(content.blocks);
    if (content.formAnswers) {
      // A form document (forms v2) fills its template's own wording from its answers.
      const spec = GUIDED_SPECS_V2[content.formAnswers.templateId as GuidedTemplateId];
      if (!spec || answers) return { kind: "unreadable" };
      const { refused, drafts } = formAnswerIssues(spec, content.formAnswers as GuidedDataV2);
      const issues = refused.length ? { ...drafts, form: refused.join(" ") } : drafts;
      return {
        kind: "form",
        templateId: spec.templateId,
        issues,
        blanks: Object.keys(issues).length ? [] : blanksIn(content.blocks),
      };
    }
    if (answers) {
      const spec = GUIDED_SPECS_V1[answers.templateId];
      return {
        kind: "questions",
        templateId: answers.templateId,
        issues: guidedDataIssues(spec, answers),
        blanks: blanksIn(guidedRenderableBlocks(content)),
      };
    }
    return {
      kind: "typed",
      fields: (Object.keys(DOCUMENT_FIELD_LABELS) as DocumentField[]).filter(
        (field) => !content.fields[field]?.trim(),
      ),
      text: !content.blocks.some(
        (block) => block.text.trim() || block.rows.some((row) => row.some((cell) => cell.trim())),
      ),
      blanks: blanksIn(content.blocks),
    };
  } catch {
    // Blocks that claim to hold questions but cannot be read, or that were altered.
    return { kind: "unreadable" };
  }
}
