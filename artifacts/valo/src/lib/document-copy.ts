import type { CanonicalDocument } from "@workspace/api-client-react";
import { compileGuidedContent, guidedDataFromBlocks } from "@workspace/valo-core/guided-runtime";
import { GUIDED_SPECS_V1 } from "@workspace/valo-core/guided-specs";

/**
 * The content a new document starts with when it is made "like" a saved one: everything the saved
 * one holds, except its own reference and its dates, which are left blank so that the customer gives
 * the new document its own. Nothing else is changed, and nothing is filled in. Null when the saved
 * document's questions cannot be read, since a copy of it could not be trusted.
 */
export function anotherLike(content: CanonicalDocument): CanonicalDocument | null {
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
