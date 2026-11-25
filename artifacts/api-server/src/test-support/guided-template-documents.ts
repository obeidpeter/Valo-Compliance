/**
 * Synthetic engineering input only: every guided template's document, made from its questions and
 * from its v2 form with every question answered, and the documents the printed page's tests print.
 * The file checks read each one's Word file and PDF (docs/architecture/editor.md, slice 3).
 */
import { GUIDED_TEMPLATE_IDS } from "@workspace/valo-core/guided";
import { compileGuidedContent } from "@workspace/valo-core/guided-runtime";
import { emptyFormData, formDocumentContent } from "@workspace/valo-core/guided-runtime-v2";
import { GUIDED_SPECS_V1 } from "@workspace/valo-core/guided-specs";
import { GUIDED_SPECS_V2 } from "@workspace/valo-core/guided-specs-v2";
import { completeGuidedTestData } from "@workspace/valo-core/guided-test-data";
import { parseFormText } from "@workspace/valo-core/form-text";
import type { PrintedDocument } from "@workspace/valo-core/printed-page";
import { headingRowSamples, printedPageSamples } from "@workspace/valo-core/printed-page-samples";
import { proposedFormText } from "../modules/manual-library/form-text-maps";
import { everyAnswer, owing } from "./complete-answers";

/** Every guided template's two documents, each with its name. */
export async function guidedTemplateDocuments(): Promise<[string, PrintedDocument][]> {
  const documents: [string, PrintedDocument][] = GUIDED_TEMPLATE_IDS.map((id) => [
    `${id} made from its questions`,
    { title: GUIDED_SPECS_V1[id].title, content: compileGuidedContent(completeGuidedTestData(id)) },
  ]);
  for (const id of GUIDED_TEMPLATE_IDS) {
    const spec = GUIDED_SPECS_V2[id];
    const formText = spec && (await proposedFormText(id));
    if (!spec || !formText) continue;
    const answers = owing(everyAnswer(emptyFormData(spec), spec));
    const { unfilled: _unfilled, ...content } = formDocumentContent(spec, parseFormText(formText), answers);
    documents.push([`${id} made from its v2 form`, { title: spec.title, content }]);
  }
  return documents;
}
/** Those, and the printed page's synthetic documents, each with its name. */
export async function everyPrintedDocument(): Promise<[string, PrintedDocument][]> {
  return [
    ...(await guidedTemplateDocuments()),
    ...printedPageSamples().map(([name, sample]): [string, PrintedDocument] => [
      `a document ${name}`,
      sample,
    ]),
    ...headingRowSamples().map(([name, sample]): [string, PrintedDocument] => [
      `a long table: ${name}`,
      sample,
    ]),
  ];
}
