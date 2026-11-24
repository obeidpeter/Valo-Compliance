import type { CanonicalDocument } from "@workspace/api-client-react";
import { compileGuidedContent, guidedDataFromBlocks } from "@workspace/valo-core/guided-runtime";
import type { GuidedTemplateId } from "@workspace/valo-core/guided";
import { GUIDED_SPECS_V1 } from "@workspace/valo-core/guided-specs";
import { GUIDED_SPECS_V2 } from "@workspace/valo-core/guided-specs-v2";
import type { GuidedDataV2 } from "@workspace/valo-core/guided-v2";

/**
 * The content a new document starts with when it is made "like" a saved one: everything the saved
 * one holds, except its own reference and its dates, which are left blank so that the customer gives
 * the new document its own. Nothing else is changed, and nothing is filled in. Null when the saved
 * document's questions cannot be read, since a copy of it could not be trusted.
 */
export function anotherLike(content: CanonicalDocument): CanonicalDocument | null {
  // A form document (forms v2) is made like another through its form: see `anotherFormLike`.
  if (content.formAnswers) return null;
  let answers: ReturnType<typeof guidedDataFromBlocks>;
  try {
    answers = guidedDataFromBlocks(content.blocks);
  } catch {
    // The saved layout is unsupported or was altered. The editor says so; no copy is offered.
    return null;
  }
  if (!answers)
    return { ...content, fields: { ...content.fields, documentNumber: "", issueDate: "", dueDate: "" } };
  const values = { ...answers.values };
  for (const field of GUIDED_SPECS_V1[answers.templateId].fields)
    if (field.type === "date" || field.id === "documentNumber") values[field.id] = "";
  return compileGuidedContent({ ...answers, values }, content) as CanonicalDocument;
}

/** The questions that name one transaction, left blank in a copy. */
const REFERENCES: readonly string[] = ["documentNumber", "relatedReference"];

/**
 * The answers a new form document (forms v2) starts with when it is made like a saved one: all of
 * the saved one's answers, except its references and its dates, left blank for the customer to give.
 * A reference names one transaction: the document's own, and the order, quotation or project a v2
 * invoice relates to. The new document fills the wording of its template's edition released at the
 * time. Null for a document not made from a v2 form, or from a form this site does not have.
 */
export function anotherFormLike(content: CanonicalDocument): GuidedDataV2 | null {
  const answers = content.formAnswers;
  const spec = answers && GUIDED_SPECS_V2[answers.templateId as GuidedTemplateId];
  if (!answers || !spec) return null;
  const values = { ...answers.values };
  for (const field of spec.fields)
    if (field.type === "date" || REFERENCES.includes(field.id)) values[field.id] = "";
  return {
    schemaVersion: 2,
    templateId: spec.templateId,
    values,
    tables: structuredClone(answers.tables),
  };
}
