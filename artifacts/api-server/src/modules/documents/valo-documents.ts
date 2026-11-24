import { serializeRevision } from "./valo-revision-codec";
import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import type { db, valoDocumentRevisions, valoDocuments } from "@workspace/db";
import { baselineTemplates, sha256 } from "@workspace/valo-core";
import { documentInput, documentUpdate } from "../../lib/valo-validation";
import { z } from "zod";
import { guidedDataFromBlocks, guidedFieldIssue } from "@workspace/valo-core/guided-runtime";
import { emptyFormData, formDocumentContent } from "@workspace/valo-core/guided-runtime-v2";
import { GUIDED_SPECS_V2 } from "@workspace/valo-core/guided-specs-v2";
import { StartFormDocumentBody } from "@workspace/api-zod";
import { ValoProblem } from "../../platform/valo-problem";
import {
  assertPlainContent,
  checkFormContent,
  documentFormText,
  freeFormEdition,
  startingAnswers,
} from "./valo-form-documents";
import { singleRow } from "../../platform/rows";
import {
  authorizeWorkspaceRead,
  authorizeWorkspaceWrite,
  limitWorkspaceWrite,
  recordWorkspaceEvent,
  savedBusinessName,
  type WorkspaceActor,
} from "../workspaces";
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** The premium forms (TPL-13 to TPL-17) by template, with the title the staff library registers. */
const premiumForms = new Map(
  baselineTemplates.filter((t) => t.guided && t.access === "premium").map((t) => [t.id, t.title]),
);
/** A workspace may start a premium form, or add one to a document, only while it holds a verified
 * purchase of a live edition of its template (forms v2, slice 1). The database function answers for
 * the workspace this transaction is scoped to and for nothing else. A document already made stays the
 * customer's, and keeps saving and making files (the finishing plan's delegated decision 3). */
async function assertFormAvailable(tx: Tx, templateId: string) {
  const title = premiumForms.get(templateId);
  if (title === undefined) return;
  const { rows } = await tx.execute<{ held: boolean }>(
    sql`select public.valo_workspace_holds_template(${templateId}, ${title}) as held`,
  );
  if (rows[0]?.held !== true)
    throw new ValoProblem(
      403,
      "This form comes with a template you buy. Buy the template first, then start the document here. Your other documents are unchanged.",
    );
}
function serialize(
  document: typeof valoDocuments.$inferSelect,
  revision: typeof valoDocumentRevisions.$inferSelect,
) {
  return {
    id: document.id,
    revisionId: revision.id,
    title: revision.title,
    revision: revision.revision,
    content: revision.content,
    contentHash: revision.contentHash,
    createdAt: document.createdAt.toISOString(),
    updatedAt: revision.createdAt.toISOString(),
    status: "business_draft" as const,
    templateVersion: document.templateVersionId ?? null,
    // The form a document was started with, which never changes (forms v2).
    form:
      document.formEdition && document.formDigest
        ? { version: 2 as const, edition: document.formEdition, digest: document.formDigest }
        : null,
  };
}
export async function listDocuments(actor: WorkspaceActor) {
  const { db, valoDocumentRevisions, valoDocuments } = await import("@workspace/db");
  const rows = await db
    .select({ document: valoDocuments, revision: valoDocumentRevisions })
    .from(valoDocuments)
    .innerJoin(
      valoDocumentRevisions,
      and(
        eq(valoDocumentRevisions.documentId, valoDocuments.id),
        eq(valoDocumentRevisions.workspaceId, actor.workspaceId),
        eq(valoDocumentRevisions.revision, valoDocuments.currentRevision),
      ),
    )
    .where(eq(valoDocuments.workspaceId, actor.workspaceId))
    .orderBy(desc(valoDocuments.updatedAt))
    .limit(200);
  return rows.map(({ document, revision }) => serialize(document, revision));
}
export async function getDocument(actor: WorkspaceActor, id: string) {
  const { db, valoDocumentRevisions, valoDocuments } = await import("@workspace/db");
  const [row] = await db
    .select({ document: valoDocuments, revision: valoDocumentRevisions })
    .from(valoDocuments)
    .innerJoin(
      valoDocumentRevisions,
      and(
        eq(valoDocumentRevisions.documentId, valoDocuments.id),
        eq(valoDocumentRevisions.workspaceId, actor.workspaceId),
        eq(valoDocumentRevisions.revision, valoDocuments.currentRevision),
      ),
    )
    .where(and(eq(valoDocuments.id, id), eq(valoDocuments.workspaceId, actor.workspaceId)));
  if (!row) throw new ValoProblem(404, "This document was not found in your workspace.");
  return serialize(row.document, row.revision);
}
export async function listRevisions(actor: WorkspaceActor, id: string) {
  const { db, valoDocumentRevisions, valoDocuments } = await import("@workspace/db");
  const [document] = await db
    .select()
    .from(valoDocuments)
    .where(and(eq(valoDocuments.id, id), eq(valoDocuments.workspaceId, actor.workspaceId)));
  if (!document) throw new ValoProblem(404, "This document was not found in your workspace.");
  const revisions = await db
    .select()
    .from(valoDocumentRevisions)
    .where(
      and(eq(valoDocumentRevisions.documentId, id), eq(valoDocumentRevisions.workspaceId, actor.workspaceId)),
    )
    .orderBy(desc(valoDocumentRevisions.revision))
    .limit(100);
  return revisions.map((revision) => serialize(document, revision));
}
async function appendRevision(
  tx: Tx,
  actor: WorkspaceActor,
  id: string,
  revision: number,
  input: z.infer<typeof documentInput>,
  origin = "manual",
) {
  const { valoDocumentRevisions } = await import("@workspace/db");
  // The hash binds the title and entire canonical document, not only its visible text.
  const created = singleRow(
    await tx
      .insert(valoDocumentRevisions)
      .values({
        id: randomUUID(),
        workspaceId: actor.workspaceId,
        documentId: id,
        revision,
        title: input.title,
        content: input.content,
        contentHash: sha256(serializeRevision(input)),
        actorId: actor.identityId,
        origin,
      })
      .returning(),
  );
  await recordWorkspaceEvent(tx, actor, "document.revision_saved", id, revision);
  return created;
}
async function createDocumentRecordInTransaction(
  tx: Tx,
  actor: WorkspaceActor,
  raw: unknown,
  origin: "manual" | "customer_ai" = "manual",
) {
  const { valoDocuments } = await import("@workspace/db");
  const input = documentInput.parse(raw);
  // A form document starts only from its form (`startFormDocument`), with its edition recorded.
  assertPlainContent(input.content);
  const id = randomUUID();
  await authorizeWorkspaceWrite(tx, actor);
  const form = guidedDataFromBlocks(input.content.blocks);
  if (form) await assertFormAvailable(tx, form.templateId);
  await limitWorkspaceWrite(tx, actor, "document");
  const document = singleRow(
    await tx
      .insert(valoDocuments)
      .values({ id, workspaceId: actor.workspaceId, currentRevision: 1 })
      .returning(),
  );
  const revision = await appendRevision(tx, actor, id, 1, input, origin);
  return { document, revision };
}
export async function createDocument(actor: WorkspaceActor, raw: unknown) {
  const { db } = await import("@workspace/db");
  const { document, revision } = await db.transaction((tx) =>
    createDocumentRecordInTransaction(tx, actor, raw),
  );
  return serialize(document, revision);
}
/** AI acceptance and document creation share one transaction and one tenant check. */
export async function createDocumentInTransaction(
  tx: Tx,
  actor: WorkspaceActor,
  raw: unknown,
  origin: "manual" | "customer_ai" = "manual",
) {
  return (await createDocumentRecordInTransaction(tx, actor, raw, origin)).document.id;
}
export async function saveDocument(actor: WorkspaceActor, id: string, raw: unknown) {
  const { db, valoDocumentRevisions, valoDocuments } = await import("@workspace/db");
  const { expectedRevision, ...input } = documentUpdate.parse(raw);
  const { document, revision } = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(valoDocuments)
      .where(and(eq(valoDocuments.id, id), eq(valoDocuments.workspaceId, actor.workspaceId)))
      .for("update");
    if (!existing) throw new ValoProblem(404, "This document was not found in your workspace.");
    await authorizeWorkspaceWrite(tx, actor);
    if (existing.currentRevision !== expectedRevision)
      throw new ValoProblem(
        409,
        "This document was saved somewhere else after you opened it. Your text was not overwritten. Compare it with the newest version.",
        existing.currentRevision,
      );
    const [current] = await tx
      .select({ title: valoDocumentRevisions.title, content: valoDocumentRevisions.content })
      .from(valoDocumentRevisions)
      .where(
        and(
          eq(valoDocumentRevisions.documentId, id),
          eq(valoDocumentRevisions.workspaceId, actor.workspaceId),
          eq(valoDocumentRevisions.revision, expectedRevision),
        ),
      );
    // A form document's content is exactly what its answers make from its edition; any other
    // document holds no form document's parts.
    if (existing.formEdition && existing.formDigest)
      await checkFormContent(tx, { id, formDigest: existing.formDigest }, input.content);
    else assertPlainContent(input.content);
    if (current?.content.financialInput && !input.content.financialInput)
      throw new ValoProblem(
        422,
        "This document's amounts are worked out by Valo and cannot be taken out of it. To write without them, start a blank document.",
      );
    const oldGuided = current ? guidedDataFromBlocks(documentInput.parse(current).content.blocks) : null;
    const nextGuided = guidedDataFromBlocks(input.content.blocks);
    if (oldGuided && oldGuided.templateId !== nextGuided?.templateId)
      throw new ValoProblem(
        422,
        "This document is made from a set of questions, and they cannot be taken out of it. To write without them, start a blank document.",
      );
    // Adding a form's questions to a document that had none starts that form.
    if (nextGuided && !oldGuided) await assertFormAvailable(tx, nextGuided.templateId);
    await limitWorkspaceWrite(tx, actor, "document");
    const savedRevision = await appendRevision(tx, actor, id, expectedRevision + 1, input);
    const updatedDocument = singleRow(
      await tx
        .update(valoDocuments)
        .set({ currentRevision: expectedRevision + 1, updatedAt: new Date() })
        .where(and(eq(valoDocuments.id, id), eq(valoDocuments.workspaceId, actor.workspaceId)))
        .returning(),
    );
    return { document: updatedDocument, revision: savedRevision };
  });
  return serialize(document, revision);
}
/**
 * Starts a document from a free template's form (forms v2): from the most recently released edition
 * of its wording, while the form fits it. Its answers start as given, as when it is made like another
 * of the same form, or else empty apart from the saved business name. The document records the
 * edition and its text's SHA-256, which never change.
 */
export async function startFormDocument(actor: WorkspaceActor, raw: unknown) {
  const { templateId, title, formAnswers } = StartFormDocumentBody.strict().parse(raw);
  const { db, valoDocuments } = await import("@workspace/db");
  const { document, revision } = await db.transaction(async (tx) => {
    await authorizeWorkspaceWrite(tx, actor);
    const form = await freeFormEdition(tx, templateId);
    await limitWorkspaceWrite(tx, actor, "document");
    let answers;
    if (formAnswers) answers = startingAnswers(form.spec, formAnswers);
    else {
      // The saved business name is filled in as the issuing business, as the questions-only form's
      // starter fills it in, and only when it is a valid answer. Nothing else is assumed.
      answers = emptyFormData(form.spec);
      const name = await savedBusinessName(tx, actor);
      const issuer = form.spec.fields.find((field) => field.id === "issuerName");
      if (name && issuer && !guidedFieldIssue(issuer, name)) answers.values.issuerName = name;
    }
    const { unfilled: _unfilled, ...content } = formDocumentContent(form.spec, form.text, answers);
    const input = documentInput.parse({ title: title ?? form.spec.title, content });
    const id = randomUUID();
    const document = singleRow(
      await tx
        .insert(valoDocuments)
        .values({
          id,
          workspaceId: actor.workspaceId,
          currentRevision: 1,
          formVersion: 2,
          formEdition: form.edition,
          formDigest: form.digest,
        })
        .returning(),
    );
    const revision = await appendRevision(tx, actor, id, 1, input);
    return { document, revision };
  });
  return serialize(document, revision);
}
/**
 * The templates whose form a workspace can start now: each free template with a v2 form and a released
 * edition of its wording that the form fits, with that edition's version. The starter starts any
 * other template with its questions only, so that no start is refused in the ordinary course.
 */
export async function listFormTemplates(actor: WorkspaceActor) {
  const { db } = await import("@workspace/db");
  return db.transaction(async (tx) => {
    await authorizeWorkspaceRead(tx, actor);
    const templates: { templateId: string; editionVersion: number }[] = [];
    for (const templateId of Object.keys(GUIDED_SPECS_V2)) {
      try {
        const form = await freeFormEdition(tx, templateId);
        templates.push({ templateId, editionVersion: form.editionVersion });
      } catch (error) {
        // No released edition, one the form does not fit, or a premium template: not startable.
        if (!(error instanceof ValoProblem) || (error.status !== 404 && error.status !== 409)) throw error;
      }
    }
    return { templates };
  });
}
/** The form text of the edition a workspace's document was started with, for its editor to fill. */
export async function getDocumentForm(actor: WorkspaceActor, id: string) {
  const { db, valoDocuments } = await import("@workspace/db");
  const form = await db.transaction(async (tx) => {
    // The database function answers only for the scoped workspace; the workspace filter stays too.
    const [document] = await tx
      .select({ id: valoDocuments.id })
      .from(valoDocuments)
      .where(and(eq(valoDocuments.id, id), eq(valoDocuments.workspaceId, actor.workspaceId)));
    return document ? documentFormText(tx, id) : undefined;
  });
  if (!form) throw new ValoProblem(404, "This document is not made from a form.");
  return { edition: form.edition, editionVersion: form.version, title: form.title, formText: form.form_text };
}
