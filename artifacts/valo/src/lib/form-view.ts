import type { GuidedData, GuidedSpec, GuidedTemplateId } from "@workspace/valo-core/guided";
import { guidedDataFromBlocks, guidedDataIssues } from "@workspace/valo-core/guided-runtime";
import { formAnswerIssues } from "@workspace/valo-core/guided-runtime-v2";
import { GUIDED_SPECS_V1 } from "@workspace/valo-core/guided-specs";
import { GUIDED_SPECS_V2 } from "@workspace/valo-core/guided-specs-v2";
import type {
  GuidedDataV2,
  GuidedFieldV2,
  GuidedSpecV2,
  GuidedTableV2,
} from "@workspace/valo-core/guided-v2";

/**
 * A form's questions as the editor shows them, whichever version of the forms it is. A v1 form is
 * its spec; a v2 form (forms v2, which fills a released template's own wording) borrows v1's
 * description and its one section of questions, since it asks v1's questions in v1's words.
 */
export type FormView = {
  schemaVersion: 1 | 2;
  templateId: GuidedTemplateId;
  title: string;
  description: string;
  fields: readonly GuidedFieldV2[];
  tables: readonly GuidedTableV2[];
  sections: GuidedSpec["sections"];
  notices: readonly string[];
};
export type FormValue = {
  schemaVersion: 1 | 2;
  templateId: GuidedTemplateId;
  values: Record<string, string>;
  tables: Record<string, Record<string, string>[]>;
};

/** The note a v2 form's questions carry: v1's first, which holds for v2 as it is. */
const V2_NOTICE = "Answers are your business facts and negotiated terms, not legal findings.";

export function formViewV2(spec: GuidedSpecV2): FormView {
  const v1 = GUIDED_SPECS_V1[spec.templateId];
  return {
    schemaVersion: 2,
    templateId: spec.templateId,
    title: spec.title,
    description: v1.description,
    fields: spec.fields,
    tables: spec.tables,
    sections: [
      {
        id: "answers",
        label: v1.sections[0]?.label ?? "Document questions",
        fieldIds: spec.fields.map((f) => f.id),
      },
    ],
    notices: [V2_NOTICE],
  };
}

/**
 * The answers' issues, keyed as v1 keys them: by question, by `table:row:column` for a cell and by
 * table for its rows. An answer a v2 form does not take at all is reported under `form`.
 */
export function formIssues(view: FormView, value: FormValue): Record<string, string> {
  if (view.schemaVersion === 1) return guidedDataIssues(view as GuidedSpec, value as GuidedData);
  const spec = GUIDED_SPECS_V2[view.templateId];
  if (!spec) return { form: "These answers belong to a form this site does not have." };
  const { refused, drafts } = formAnswerIssues(spec, value as GuidedDataV2);
  return refused.length ? { ...drafts, form: refused.join(" ") } : drafts;
}

/**
 * A guided document's questions and answers, whichever version of the forms made it: a v2 form's
 * answers are the document's own (`formAnswers`), a v1 form's are read from its blocks. Null for a
 * document typed by hand. Throws when they cannot be read: a v1 form's blocks that were altered, or a
 * form this site does not have.
 */
export function documentAnswers(content: {
  blocks: Parameters<typeof guidedDataFromBlocks>[0];
  formAnswers?: { templateId: string } | undefined;
}): { view: FormView; value: FormValue } | null {
  if (content.formAnswers) {
    const spec = GUIDED_SPECS_V2[content.formAnswers.templateId as GuidedTemplateId];
    if (!spec) throw Error("UNSUPPORTED_FORM_DOCUMENT");
    return { view: formViewV2(spec), value: content.formAnswers as FormValue };
  }
  const answers = guidedDataFromBlocks(content.blocks);
  return answers ? { view: GUIDED_SPECS_V1[answers.templateId], value: answers } : null;
}
