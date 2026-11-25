import { isDeepStrictEqual } from "node:util";
import { sql } from "drizzle-orm";
import type { z } from "zod";
import type { CreateDocumentBody } from "@workspace/api-zod";
import type { db } from "@workspace/db";
import { baselineTemplates, sha256 } from "@workspace/valo-core";
import { documentGaps } from "@workspace/valo-core/document-completeness";
import { FormTextError, parseFormText } from "@workspace/valo-core/form-text";
import type { GuidedTemplateId } from "@workspace/valo-core/guided";
import { formAnswerIssues, formDocumentContent, formFit } from "@workspace/valo-core/guided-runtime-v2";
import { GUIDED_SPECS_V2 } from "@workspace/valo-core/guided-specs-v2";
import type { GuidedDataV2, GuidedSpecV2 } from "@workspace/valo-core/guided-v2";
import { ValoProblem } from "../../platform/valo-problem";

/**
 * Form documents (forms v2, docs/architecture/forms-v2.md, slice 5): a document started from a
 * template's form fills the form text of one released staff-library edition. The document records
 * that edition when it starts, and every save is checked here: its blocks, its chosen passages and
 * its own fields are exactly what its answers make from that edition's text.
 */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Content = z.infer<typeof CreateDocumentBody>["content"];

const formTextOf = (source: string) => {
  try {
    return parseFormText(source);
  } catch (error) {
    // Released text was read with the same grammar when it was saved; text that no longer parses
    // is treated as having no form.
    if (error instanceof FormTextError) return null;
    throw error;
  }
};

/** The premium forms (TPL-13 to TPL-17) by template, with the title the staff library registers. */
const premiumForms = new Map(
  baselineTemplates.filter((t) => t.guided && t.access === "premium").map((t) => [t.id, t.title]),
);
/** Whether the scoped workspace holds a verified purchase of a live edition of a premium template;
 * true for a template that is not premium. */
export async function holdsTemplate(tx: Tx, templateId: string) {
  const title = premiumForms.get(templateId);
  if (title === undefined) return true;
  const { rows } = await tx.execute<{ held: boolean }>(
    sql`select public.valo_workspace_holds_template(${templateId}, ${title}) as held`,
  );
  return rows[0]?.held === true;
}
/** The premium forms (TPL-13 to TPL-17), by template id. */
export const premiumFormIds = () => [...premiumForms.keys()];
/** A workspace may start a premium form, or add one to a document, only while it holds a verified
 * purchase of a live edition of its template (forms v2, slice 1). The database function answers for
 * the workspace this transaction is scoped to and for nothing else. A document already made stays the
 * customer's, and keeps saving and making files (the finishing plan's delegated decision 3). */
export async function assertFormAvailable(tx: Tx, templateId: string) {
  if (!(await holdsTemplate(tx, templateId)))
    throw new ValoProblem(
      403,
      "This form comes with a template you buy. Buy the template first, then start the document here. Your other documents are unchanged.",
    );
}
/** A document that was not started from a form holds none of a form document's parts. Its tables may
 * print their first row as a heading row, as a form's tables do (docs/architecture/editor.md). */
export function assertPlainContent(content: Content) {
  if (
    content.formAnswers !== undefined ||
    content.selectedClauses.length > 0 ||
    content.blocks.some(
      (block) => block.type === "heading" || (block.headerRows !== undefined && block.type !== "table"),
    )
  )
    throw new ValoProblem(
      422,
      "Headings, chosen passages and form answers belong to a document started from a form. Start the form from its template to use them.",
    );
}

/**
 * The released edition a workspace may start a template's form from, by the template's registered
 * title, and only while the form fits it. For a free template, the most recently released edition
 * with form text. For a premium template (slice 6), the most recently released one with form text
 * that the workspace bought, with the order it was bought under: a workspace that holds no live
 * edition is told to buy the template first, and one whose edition has no form text yet starts the
 * questions-only form, as for a free template.
 */
export async function formEdition(tx: Tx, templateId: string) {
  const spec = GUIDED_SPECS_V2[templateId as GuidedTemplateId];
  const template = baselineTemplates.find((entry) => entry.id === templateId);
  if (!spec || !template)
    throw new ValoProblem(
      404,
      "This template has no form that fills its wording yet. Start its questions-only form instead.",
    );
  const premium = template.access === "premium";
  const { rows } = await tx.execute<{
    edition: string;
    version: number;
    form_text: string;
    purchase: string | null;
  }>(
    premium
      ? sql`select edition, version, form_text, purchase from public.valo_premium_form_edition(${template.title})`
      : sql`select edition, version, form_text, null::uuid as purchase from public.valo_free_form_edition(${template.title})`,
  );
  const row = rows[0];
  if (!row) {
    if (premium) await assertFormAvailable(tx, templateId);
    throw new ValoProblem(
      409,
      "This template's wording is not released for its form yet. Start its questions-only form instead.",
    );
  }
  const text = formTextOf(row.form_text);
  if (!text || formFit(spec, text).length > 0)
    throw new ValoProblem(
      409,
      "This template's released wording does not match its form yet. Start its questions-only form instead.",
    );
  return {
    spec,
    text,
    edition: row.edition,
    editionVersion: row.version,
    digest: sha256(row.form_text),
    purchase: row.purchase,
  };
}

/** The edition one of the scoped workspace's documents was started with, and its form text. */
export async function documentFormText(tx: Tx, documentId: string) {
  const { rows } = await tx.execute<{ edition: string; version: number; title: string; form_text: string }>(
    sql`select edition, version, title, form_text from public.valo_document_form_text(${documentId}::uuid)`,
  );
  return rows[0];
}

/**
 * What a saved version of one of the scoped workspace's documents still lacks
 * (docs/architecture/finished-file.md): a form document is read against the form text of the edition
 * it was started with, so that a blank left for completion by hand is not counted. A form document
 * whose form text cannot be read is unreadable.
 */
export async function savedVersionGaps(tx: Tx, documentId: string, content: Content) {
  if (!content.formAnswers) return documentGaps(content);
  const form = await documentFormText(tx, documentId);
  const text = form && formTextOf(form.form_text);
  return text ? documentGaps(content, text) : ({ kind: "unreadable" } as const);
}

const FIELDS = ["issuerName", "recipientName", "documentNumber", "issueDate", "dueDate"] as const;

/** An answer the form does not take is refused; one not valid yet stays a draft answer. */
function assertFormTakes(spec: GuidedSpecV2, data: GuidedDataV2) {
  const { refused } = formAnswerIssues(spec, data);
  if (refused.length)
    throw new ValoProblem(422, `Some answers cannot be saved. ${refused.slice(0, 3).join(" ")}`);
}

/**
 * The answers a form document starts with when they are given, as when it is made like another of
 * the same form: they must be this form's, and the form must take each of them.
 */
export function startingAnswers(
  spec: GuidedSpecV2,
  answers: { schemaVersion: number; templateId: string },
): GuidedDataV2 {
  if (answers.schemaVersion !== 2 || answers.templateId !== spec.templateId)
    throw new ValoProblem(422, "These answers belong to another form. Reopen the document and try again.");
  const data = answers as GuidedDataV2;
  assertFormTakes(spec, data);
  return data;
}

/**
 * A form document's content is exactly what its answers make from the form text of the edition it
 * was started with. An answer the form does not take is refused; one not valid yet stays a draft
 * answer and leaves its placeholder. The note and the formatting are the document's own.
 */
export async function checkFormContent(
  tx: Tx,
  document: { id: string; formDigest: string },
  content: Content,
) {
  const answers = content.formAnswers;
  if (!answers)
    throw new ValoProblem(422, "This document is made from a form. Save it with the form's answers.");
  const form = await documentFormText(tx, document.id);
  const template =
    form && baselineTemplates.find((entry) => entry.title.toLowerCase() === form.title.toLowerCase());
  const spec = GUIDED_SPECS_V2[answers.templateId as GuidedTemplateId];
  const text = form && formTextOf(form.form_text);
  if (
    !form ||
    !text ||
    !spec ||
    sha256(form.form_text) !== document.formDigest ||
    template?.id !== spec.templateId
  )
    throw new ValoProblem(422, "These answers belong to another form. Reopen the document and try again.");
  const data = answers as GuidedDataV2;
  assertFormTakes(spec, data);
  const made = formDocumentContent(spec, text, data, content);
  if (
    !isDeepStrictEqual(made.blocks, content.blocks) ||
    !isDeepStrictEqual(made.selectedClauses, content.selectedClauses) ||
    FIELDS.some((field) => made.fields[field] !== content.fields[field])
  )
    throw new ValoProblem(
      422,
      "This document's wording comes from its released template, filled from its answers. Keep the wording as it is and change the answers instead.",
    );
}
