import type { GuidedTemplateId } from "./guided";
import {
  DOCUMENT_FIELD_LABELS,
  guidedDataFromBlocks,
  guidedDataIssues,
  guidedRenderableBlocks,
  type GuidedBlock,
} from "./guided-runtime-v1";
import { formTextSlots, type FormText } from "./form-text";
import { compileForm, formAnswerIssues } from "./guided-runtime-v2";
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
 * issues: its blanks are then its slots, which the issues already name. Given a form document's form
 * text, its blanks are the placeholders of the slots its answers leave unfilled: a declared blank,
 * such as a signature, is completed by hand and is not one. A document whose questions cannot be
 * read is `unreadable`.
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

/** The placeholders of a form text's slots that are left unfilled, each once, in the text's order. */
const unfilledIn = (text: FormText, unfilled: readonly string[]) => [
  ...new Set(
    formTextSlots(text)
      .filter((slot) => unfilled.includes(slot.name))
      .map((slot) => slot.placeholder),
  ),
];

export function documentGaps(content: GapsContent, formText?: FormText | null): DocumentGaps {
  try {
    const answers = guidedDataFromBlocks(content.blocks);
    if (content.formAnswers) {
      // A form document (forms v2) fills its template's own wording from its answers.
      const spec = GUIDED_SPECS_V2[content.formAnswers.templateId as GuidedTemplateId];
      if (!spec || answers) return { kind: "unreadable" };
      const data = content.formAnswers as GuidedDataV2;
      const { refused, drafts } = formAnswerIssues(spec, data);
      const issues = refused.length ? { ...drafts, form: refused.join(" ") } : drafts;
      return {
        kind: "form",
        templateId: spec.templateId,
        issues,
        blanks: Object.keys(issues).length
          ? []
          : formText
            ? unfilledIn(formText, compileForm(spec, formText, data).unfilled)
            : blanksIn(content.blocks),
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

/**
 * Whether a document is complete, so that its file may be a finished one with no draft notice: it was
 * made from a form or from questions, and lacks nothing (docs/architecture/finished-file.md). A
 * document typed by hand is never complete in this sense: no questions say what it must hold.
 */
export function documentComplete(gaps: DocumentGaps) {
  return (
    (gaps.kind === "form" || gaps.kind === "questions") &&
    Object.keys(gaps.issues).length === 0 &&
    gaps.blanks.length === 0
  );
}
