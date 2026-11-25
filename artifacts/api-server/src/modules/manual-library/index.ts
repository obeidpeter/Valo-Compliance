import { randomUUID } from "node:crypto";
import { and, desc, eq, getTableColumns, ilike, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { baselineTemplates, coveragePlan, digest, sha256 } from "@workspace/valo-core";
import { FormTextError, parseFormText } from "@workspace/valo-core/form-text";
import { formFit } from "@workspace/valo-core/guided-runtime-v2";
import { GUIDED_SPECS_V2 } from "@workspace/valo-core/guided-specs-v2";
import type { GuidedTemplateId } from "@workspace/valo-core/guided";
import {
  ActOnManualLibraryBody,
  LoadRetainedDraftsBody,
  SaveManualLibraryDraftBody,
} from "@workspace/api-zod";
import type { db, valoManualLibrary } from "@workspace/db";
import type { SourceStaffActor } from "../sources";
import { ValoProblem } from "../../platform/valo-problem";
import { assertDevelopmentRuntime, isDevelopmentRuntime } from "../../platform/valo-development-runtime";
import type { EditorialFile } from "./files";
import { authorizeWorkspaceWrite, type WorkspaceActor } from "../workspaces";

type Revision = typeof valoManualLibrary.$inferSelect;
type RevisionMeta = Omit<Revision, "fileBytes">;
export const isManualTemplate = (kind: Revision["kind"]) =>
  kind === "template" || kind === "premium_template";
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const sectors = new Set(coveragePlan().industries.map((i) => i.slug));
const missing = () => new ValoProblem(404, "This library item is unavailable.");
const conflict = () =>
  new ValoProblem(409, "This item changed. Reopen the latest version before continuing.");
function metadataColumns(t: typeof valoManualLibrary) {
  const { fileBytes: _bytes, ...columns } = getTableColumns(t);
  return columns;
}
/** Escapes SQL LIKE wildcards so staff title searches match literal characters safely. */
export function escapeLikePattern(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}
function summary(row: RevisionMeta) {
  return {
    itemId: row.itemId,
    title: row.title,
    version: row.version,
    kind: row.kind,
    state: row.state,
    industry: row.industry,
  };
}
/** The registered template an entry is filed as, by its title, as the access check finds it. */
const registeredTemplate = (title: string) =>
  baselineTemplates.find((entry) => entry.title.toLowerCase() === title.toLowerCase());
/**
 * How a revision's form text fits the fill-in form of the template it is filed as (forms v2): the
 * staff preview of the fit. A form is joined only to an edition whose text it fits.
 */
export function formTextFit(row: Pick<Revision, "title" | "formText">) {
  if (row.formText === null) return null;
  const template = registeredTemplate(row.title);
  if (!template) return { templateId: null, state: "no_template" as const, problems: [] };
  const spec = GUIDED_SPECS_V2[template.id as GuidedTemplateId];
  if (!spec) return { templateId: template.id, state: "no_form" as const, problems: [] };
  let problems: string[];
  try {
    problems = formFit(spec, parseFormText(row.formText));
  } catch (error) {
    if (!(error instanceof FormTextError)) throw error;
    problems = [error.message];
  }
  return {
    templateId: template.id,
    state: problems.length ? ("does_not_fit" as const) : ("fits" as const),
    problems: problems.slice(0, 200).map((problem) => problem.slice(0, 400)),
  };
}
async function detail(tx: Tx, row: RevisionMeta) {
  const { valoManualLibrary: t } = await import("@workspace/db");
  const [live] = await tx
    .select({ version: t.version, digest: t.digest })
    .from(t)
    .where(and(eq(t.itemId, row.itemId), eq(t.state, "published")));
  // The related guides by name, for the editor: each item's latest version, and whether a version of
  // it is live now.
  const related = row.relatedItems?.length
    ? await tx
        .selectDistinctOn([t.itemId], { itemId: t.itemId, title: t.title, kind: t.kind })
        .from(t)
        .where(inArray(t.itemId, row.relatedItems))
        .orderBy(t.itemId, desc(t.version))
    : [];
  const liveRelated = new Set(
    row.relatedItems?.length
      ? (
          await tx
            .select({ itemId: t.itemId })
            .from(t)
            .where(and(inArray(t.itemId, row.relatedItems), eq(t.state, "published")))
        ).map((entry) => entry.itemId)
      : [],
  );
  return {
    ...summary(row),
    id: row.id,
    body: row.body,
    digest: row.digest,
    fileFormat: row.fileFormat,
    formText: row.formText,
    formFit: formTextFit(row),
    purpose: row.purpose,
    needs: row.needs,
    limits: row.limits,
    relatedItems: row.relatedItems ?? [],
    relatedGuides: (row.relatedItems ?? []).map((itemId) => {
      const found = related.find((entry) => entry.itemId === itemId);
      return {
        itemId,
        title: found?.title ?? null,
        kind: found?.kind ?? null,
        live: liveRelated.has(itemId),
      };
    }),
    aiDrafted: row.aiDrafted,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    publishedAt: row.publishedAt?.toISOString() ?? null,
    publishedBy: row.publishedBy,
    live: live ?? null,
  };
}
function pgError(error: unknown) {
  const e = error as { cause?: { code?: string; constraint?: string }; code?: string; constraint?: string };
  return e.cause ?? e;
}
async function withEditor<T>(actor: SourceStaffActor, work: (tx: Tx) => Promise<T>, itemId?: string) {
  assertDevelopmentRuntime();
  const [{ db }, { requireSourceStaff }] = await Promise.all([import("@workspace/db"), import("../sources")]);
  try {
    return await db.transaction(async (tx) => {
      if (itemId) await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${itemId}::text,811))`);
      await requireSourceStaff(tx, actor, "content");
      return work(tx);
    });
  } catch (error) {
    const e = pgError(error);
    if (e.code === "42P01" || e.code === "42703")
      throw new ValoProblem(503, "Apply the editorial library migration before using the publisher.");
    if (e.code === "23505")
      throw new ValoProblem(
        409,
        e.constraint === "valo_manual_one_intro"
          ? "This industry already has an introduction. Edit its existing entry or withdraw it first."
          : e.constraint === "valo_manual_one_pack"
            ? "This industry already has an industry pack. Edit its existing entry or withdraw it first."
            : "This revision already exists. Reopen the item.",
      );
    throw error;
  }
}
export const authorizeManualEditor = (actor: SourceStaffActor) => withEditor(actor, async () => undefined);
export type ManualLibraryListFilters = {
  page: number;
  q?: string | undefined;
  kind?: Revision["kind"] | undefined;
  state?: Revision["state"] | undefined;
  industry?: string | undefined;
};
export async function listManualLibrary(
  actor: SourceStaffActor,
  pageOrFilters: number | ManualLibraryListFilters,
) {
  const filters: ManualLibraryListFilters =
    typeof pageOrFilters === "number" ? { page: pageOrFilters } : pageOrFilters;
  if (!Number.isInteger(filters.page) || filters.page < 1 || filters.page > 10000)
    throw new ValoProblem(422, "Choose a page between 1 and 10,000.");
  const q = filters.q?.trim();
  const industry = filters.industry?.trim();
  if (industry && industry !== "__general__" && !sectors.has(industry))
    throw new ValoProblem(422, "Choose a listed industry filter.");
  return withEditor(actor, async (tx) => {
    const { valoManualLibrary: t } = await import("@workspace/db");
    const latest = tx
      .selectDistinctOn([t.itemId], {
        itemId: t.itemId,
        version: t.version,
        title: t.title,
        kind: t.kind,
        state: t.state,
        industry: t.industry,
        createdAt: t.createdAt,
      })
      .from(t)
      .orderBy(t.itemId, desc(t.version))
      .as("latest");
    const conditions = [
      q ? ilike(latest.title, `%${escapeLikePattern(q)}%`) : undefined,
      filters.kind ? eq(latest.kind, filters.kind) : undefined,
      filters.state ? eq(latest.state, filters.state) : undefined,
      industry === "__general__"
        ? isNull(latest.industry)
        : industry
          ? eq(latest.industry, industry)
          : undefined,
    ];
    const items = await tx
      .select()
      .from(latest)
      .where(and(...conditions))
      .orderBy(desc(latest.createdAt), latest.itemId)
      .offset((filters.page - 1) * 50)
      .limit(51);
    return { items: items.slice(0, 50), hasMore: items.length > 50 };
  });
}
async function latestRevision(tx: Tx, itemId: string) {
  const { valoManualLibrary: t } = await import("@workspace/db");
  return (
    await tx.select(metadataColumns(t)).from(t).where(eq(t.itemId, itemId)).orderBy(desc(t.version)).limit(1)
  )[0];
}
export async function getManualRevision(actor: SourceStaffActor, itemId: string) {
  return withEditor(
    actor,
    async (tx) => {
      const row = await latestRevision(tx, itemId);
      if (!row) throw missing();
      return detail(tx, row);
    },
    itemId,
  );
}
const normalize = (s: string) => s.replace(/\r\n?/g, "\n").trim();
function hasControlCharacters(value: string, multiline = false) {
  for (const character of value)
    if (character.charCodeAt(0) < 32 && !(multiline && (character === "\n" || character === "\t")))
      return true;
  return false;
}
/** The most items a template's needs list holds, and the longest each may be. */
const NEEDS_LINES = 12,
  NEEDS_LINE_LENGTH = 120;
/**
 * A template's entry details as a draft gives them (docs/architecture/library-entries.md), checked and
 * normalised: what it is for, what a customer needs (one item to a line), its limits, its related
 * guides' library items and whether AI drafted it. Each one left out is null. Only a template has them.
 */
export function entryDetails(input: {
  kind: Revision["kind"];
  purpose?: string | null | undefined;
  needs?: string | null | undefined;
  limits?: string | null | undefined;
  relatedItems?: readonly string[] | undefined;
  aiDrafted?: boolean | null | undefined;
}) {
  const text = (value: string | null | undefined) => (value?.trim() ? normalize(value) : null);
  const purpose = text(input.purpose),
    limits = text(input.limits);
  const lines = (input.needs ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const relatedItems = input.relatedItems?.length ? [...new Set(input.relatedItems)] : null;
  const aiDrafted = input.aiDrafted ?? null;
  const details = { purpose, needs: lines.length ? lines.join("\n") : null, limits, relatedItems, aiDrafted };
  if (Object.values(details).every((detail) => detail === null)) return details;
  if (!isManualTemplate(input.kind))
    throw new ValoProblem(
      422,
      "Only a template says what it is for, what you need, its limits, its related guides and how it was written. Clear them to save this item.",
    );
  if (purpose !== null && (purpose.length > 400 || hasControlCharacters(purpose, true)))
    throw new ValoProblem(422, "Say what the template is for in up to 400 characters.");
  if (limits !== null && (limits.length > 800 || hasControlCharacters(limits, true)))
    throw new ValoProblem(422, "Give the template's limits in up to 800 characters.");
  if (
    lines.length > NEEDS_LINES ||
    lines.some((line) => line.length > NEEDS_LINE_LENGTH || hasControlCharacters(line))
  )
    throw new ValoProblem(
      422,
      `List what a customer needs in up to ${NEEDS_LINES} lines of up to ${NEEDS_LINE_LENGTH} characters each, one item to a line.`,
    );
  if (relatedItems !== null && relatedItems.length > 6)
    throw new ValoProblem(422, "Choose up to 6 related guides.");
  return details;
}
export async function saveManualDraft(actor: SourceStaffActor, itemId: string, value: unknown) {
  const { readEditorialUpload, wordFromText } = await import("./files");
  const input = SaveManualLibraryDraftBody.strict().parse(value);
  const title = input.title.trim();
  if (!title || hasControlCharacters(title)) throw new ValoProblem(422, "Enter a title on one line.");
  if (isManualTemplate(input.kind)) {
    const registered = registeredTemplate(title);
    if (registered && (registered.access === "premium") !== (input.kind === "premium_template"))
      throw new ValoProblem(422, "Choose the access level registered for this template.");
  }
  // A template's form text, for its fill-in form: read now, so that only text the forms can fill is
  // saved. Empty means the version has none.
  const formText = input.formText?.trim() ? normalize(input.formText) : null;
  if (formText !== null) {
    if (!isManualTemplate(input.kind))
      throw new ValoProblem(422, "Only a template has form text. Clear the form text to save this item.");
    try {
      parseFormText(formText);
    } catch (error) {
      if (!(error instanceof FormTextError)) throw error;
      throw new ValoProblem(
        422,
        `The form text cannot be read at line ${error.line}: ${error.reason}. Correct it, then save again.`,
      );
    }
  }
  const details = entryDetails(input);
  const premium = input.kind === "premium_template";
  if (premium && (input.fileMode === "text" || !input.body.trim() || input.body.trim().length > 600))
    throw new ValoProblem(
      422,
      "Choose a template file and enter a separate public description of up to 600 characters.",
    );
  if (
    (input.industry !== null && !sectors.has(input.industry)) ||
    ((input.kind === "industry_introduction" || input.kind === "industry_pack") && !input.industry)
  )
    throw new ValoProblem(422, "Choose a listed industry for this item.");
  if (
    (input.fileMode === "upload") !== Boolean(input.upload) ||
    (input.fileMode === "keep" && !isManualTemplate(input.kind))
  )
    throw new ValoProblem(422, "Choose text, an uploaded file, or the saved template file.");
  const upload = input.upload
    ? await readEditorialUpload(input.upload.format, input.upload.base64)
    : undefined;
  const body = normalize(input.body || upload?.text || "");
  if (!body || body.length > 60000 || hasControlCharacters(body, true))
    throw new ValoProblem(
      422,
      "Provide readable text of up to 60,000 characters. For a scanned file, paste its text or a template description.",
    );
  return withEditor(
    actor,
    async (tx) => {
      const { valoManualLibrary: t } = await import("@workspace/db");
      const latest = await latestRevision(tx, itemId);
      if (latest && latest.kind !== input.kind)
        throw new ValoProblem(409, "The content type is fixed when the first draft is saved.");
      let file: EditorialFile | undefined;
      if (isManualTemplate(input.kind)) {
        if (input.fileMode === "keep") {
          const [base] = await tx
            .select({ bytes: t.fileBytes, format: t.fileFormat })
            .from(t)
            .where(and(eq(t.itemId, itemId), eq(t.version, input.baseVersion)));
          if (!base?.bytes || !base.format) throw new ValoProblem(422, "Choose a file for this template.");
          file = { bytes: base.bytes, format: base.format };
        } else file = upload?.file ?? wordFromText(title, body);
      }
      // Form text joins the digest only when present, so every earlier revision keeps its digest.
      const hash = digest({
        kind: input.kind,
        industry: input.industry,
        title,
        body,
        fileFormat: file?.format ?? null,
        fileHash: file ? sha256(file.bytes) : null,
        ...(formText === null ? {} : { formText }),
        // So do the entry details, each one only when given (docs/architecture/library-entries.md).
        ...Object.fromEntries(Object.entries(details).filter(([, detail]) => detail !== null)),
      });
      const [retry] = await tx.select(metadataColumns(t)).from(t).where(eq(t.id, input.requestId));
      if (retry) {
        if (
          retry.itemId !== itemId ||
          retry.version !== input.baseVersion + 1 ||
          retry.createdBy !== actor.identityId ||
          retry.digest !== hash ||
          latest?.id !== retry.id
        )
          throw conflict();
        return detail(tx, retry);
      }
      if ((latest?.version ?? 0) !== input.baseVersion) throw conflict();
      const [row] = await tx
        .insert(t)
        .values({
          id: input.requestId,
          itemId,
          version: input.baseVersion + 1,
          slug: "manual-" + itemId,
          kind: input.kind,
          industry: input.industry,
          title,
          body,
          digest: hash,
          fileFormat: file?.format ?? null,
          fileBytes: file?.bytes ?? null,
          formText,
          ...details,
          createdBy: actor.identityId,
        })
        .returning(metadataColumns(t));
      return detail(tx, row!);
    },
    itemId,
  );
}
export async function actOnManualRevision(actor: SourceStaffActor, itemId: string, value: unknown) {
  const input = ActOnManualLibraryBody.strict().parse(value);
  return withEditor(
    actor,
    async (tx) => {
      const { valoManualLibrary: t } = await import("@workspace/db");
      const latest = await latestRevision(tx, itemId);
      if (!latest) throw missing();
      if (latest.kind === "regulatory_article")
        throw new ValoProblem(
          409,
          "This regulatory article stays in draft until the owner checks its sources.",
        );
      const [target] = await tx
        .select(metadataColumns(t))
        .from(t)
        .where(and(eq(t.itemId, itemId), eq(t.version, input.version)));
      if (!target || target.digest !== input.digest) throw conflict();
      const closed = { closedBy: actor.identityId, closedAt: new Date() };
      if (input.action === "publish") {
        if (target.id !== latest.id) throw conflict();
        if (target.state === "published") return detail(tx, latest);
        if (target.state !== "draft") throw conflict();
        // The database releases a template only with these details; say so before it refuses.
        if (
          isManualTemplate(target.kind) &&
          (target.purpose === null || target.limits === null || target.aiDrafted === null)
        )
          throw new ValoProblem(
            422,
            "Say what this template is for, give its limits and say whether AI drafted it, then save it again before you publish it.",
          );
        await tx
          .update(t)
          .set({ ...closed, state: "replaced" })
          .where(and(eq(t.itemId, itemId), eq(t.state, "published")));
        await tx
          .update(t)
          .set({ state: "published", publishedBy: actor.identityId, publishedAt: new Date() })
          .where(eq(t.id, target.id));
      } else {
        if (target.state === "withdrawn") return detail(tx, latest);
        if (target.state !== "published") throw conflict();
        // A withdrawal records why, and the customers who bought or used the version are told it: the
        // reason is written first, so that the notices the withdrawal writes carry it
        // (docs/architecture/editions.md, slice 3).
        const reason = input.reason?.trim() ?? "";
        if (reason.length < 20)
          throw new ValoProblem(
            422,
            "Say why this version is withdrawn, in 20 to 1,000 characters. The customers who bought or used it see this reason.",
          );
        const { valoManualWithdrawals } = await import("@workspace/db");
        await tx
          .insert(valoManualWithdrawals)
          .values({ edition: target.id, reason, recordedBy: actor.identityId });
        await tx
          .update(t)
          .set({ ...closed, state: "withdrawn" })
          .where(eq(t.id, target.id));
      }
      return detail(tx, (await latestRevision(tx, itemId))!);
    },
    itemId,
  );
}
function attachment(row: Pick<Revision, "slug" | "version" | "fileBytes" | "fileFormat"> | undefined) {
  if (!row?.fileBytes || !row.fileFormat) throw missing();
  return {
    bytes: row.fileBytes,
    format: row.fileFormat,
    filename: row.slug + "-v" + row.version + "." + row.fileFormat,
  };
}
export async function privateManualFile(actor: SourceStaffActor, itemId: string, version: number) {
  return withEditor(actor, async (tx) => {
    const { valoManualLibrary: t } = await import("@workspace/db");
    return attachment(
      (
        await tx
          .select()
          .from(t)
          .where(and(eq(t.itemId, itemId), eq(t.version, version)))
      )[0],
    );
  });
}
export async function releasedManualFile(id: string, identityId: string) {
  assertDevelopmentRuntime();
  const { assertAccountNotErasedOrSuspended } = await import("../workspaces");
  await assertAccountNotErasedOrSuspended(identityId);
  const { db, valoManualLibrary: t } = await import("@workspace/db");
  return attachment(
    (
      await db
        .select({ slug: t.slug, version: t.version, fileBytes: t.fileBytes, fileFormat: t.fileFormat })
        .from(t)
        .where(and(eq(t.id, id), eq(t.kind, "template"), eq(t.state, "published")))
    )[0],
  );
}
export async function purchasedManualFile(actor: WorkspaceActor, id: string) {
  assertDevelopmentRuntime();
  const { db } = await import("@workspace/db");
  return db.transaction(async (tx) => {
    const { rows } = await tx.execute<{
      slug: string;
      version: number;
      format: "docx" | "pdf";
      bytes: Buffer;
    }>(sql`select slug, version, format, bytes from public.valo_manual_purchased_file(${id}::uuid)`);
    await authorizeWorkspaceWrite(tx, actor);
    if (!rows[0])
      throw new ValoProblem(403, "This workspace needs an active purchase for this template version.");
    const { slug, version, format, bytes } = rows[0];
    return attachment({ slug, version, fileFormat: format, fileBytes: bytes });
  });
}
/**
 * The staff library's released templates, as a workspace saves them and is suggested them
 * (docs/architecture/library-entries.md, slice 2). A customer request cannot read the editorial table,
 * so this reads them through its owner's function: what the library lists of each, and no more.
 */
export async function liveLibraryTemplates(tx: Pick<Tx, "execute">) {
  const { rows } = await tx.execute<{
    id: string;
    item_id: string;
    slug: string;
    kind: "template" | "premium_template";
    title: string;
    version: number;
    industry: string | null;
    purpose: string | null;
    summary: string;
    published_at: Date | string;
  }>(sql`select * from public.valo_live_manual_templates()`);
  return rows.map((row) => ({
    id: row.id,
    itemId: row.item_id,
    slug: row.slug,
    kind: row.kind,
    title: row.title,
    version: row.version,
    industry: row.industry,
    purpose: row.purpose,
    body: row.summary,
    publishedAt: new Date(row.published_at),
    sourceCheckedAt: null,
  }));
}
/** A released free template's text, for a workspace's copy of it (slice 3). A premium template has none
 * here: its text is in its file alone. */
export async function freeLibraryEdition(tx: Pick<Tx, "execute">, id: string) {
  const { rows } = await tx.execute<{ edition: string; version: number; title: string; body: string }>(
    sql`select edition, version, title, body from public.valo_free_library_edition(${id}::uuid)`,
  );
  return rows[0] ?? null;
}
/** Existing readers may still run against the schema preceding the additive migration. */
export async function releasedManualEntries(
  slugOrOptions?: string | { slug?: string | undefined; summaryOnly?: boolean | undefined },
) {
  if (!isDevelopmentRuntime()) return [];
  const options = typeof slugOrOptions === "string" ? { slug: slugOrOptions } : (slugOrOptions ?? {});
  const { guidancePolicy } = await import("../publication");
  const { policy } = await guidancePolicy();
  const regulatoryEnabled =
    policy.ownerApproved &&
    policy.allowedClasses.includes("sourced_guidance") &&
    policy.jurisdictions.includes("NG");
  const { db, valoManualLibrary: t, valoManualRegulatoryChecks: c } = await import("@workspace/db");
  const {
    fileBytes: _bytes,
    createdBy: _creator,
    closedBy: _closer,
    publishedBy: _editor,
    regulatoryCheckId: _privateCheck,
    // Form text is read only by staff and, through the forms, by the customers it is for (DOC-004).
    formText: _formText,
    body: fullBody,
    ...restFields
  } = getTableColumns(t);
  const fields = {
    ...restFields,
    body: options.summaryOnly ? sql<string>`left(${fullBody}, 600)` : fullBody,
  };
  const released = and(eq(t.state, "published"), options.slug ? eq(t.slug, options.slug) : undefined);
  try {
    return await db
      .select({ ...fields, regulatorySources: c.sources, sourceCheckedAt: c.checkedAt })
      .from(t)
      .leftJoin(c, eq(c.id, t.regulatoryCheckId))
      .where(
        and(
          released,
          or(
            ne(t.kind, "regulatory_article"),
            // The newest check has the evidence the guide was signed on, with each source's bytes or with
            // each web page's words in their place (docs/architecture/guidance-currency.md). The words are
            // read through each row's JSON, so a database the words migration has not reached yet keeps
            // comparing bytes alone.
            sql`${regulatoryEnabled} and (
        select (newest.evidence_sha256 = ${c.evidenceSha256}
            or to_jsonb(newest)->>'words_sha256' = to_jsonb(${c})->>'words_sha256')
          and cardinality(newest.holds) = 0
          and newest.checked_at between clock_timestamp() - interval '30 days' and clock_timestamp()
          and not exists (select from jsonb_array_elements(newest.sources) ref where coalesce((ref->>'validThrough')::timestamptz,'-infinity') <= clock_timestamp())
        from valo_manual_regulatory_checks newest where newest.candidate_id = ${c.candidateId}
        order by newest.checked_at desc, newest.id desc limit 1) is true`,
          ),
        ),
      )
      .orderBy(desc(t.publishedAt), t.itemId);
  } catch (error) {
    if (!["42P01", "42703"].includes(pgError(error).code ?? "")) throw error;
    try {
      // Before the entry-details migration (docs/architecture/library-entries.md) the table has none of
      // their columns; read the rest, and no details.
      const {
        purpose: _purpose,
        needs: _needs,
        limits: _limits,
        relatedItems: _related,
        aiDrafted: _aiDrafted,
        ...older
      } = fields;
      const prior = await db
        .select(older)
        .from(t)
        .where(and(released, ne(t.kind, "regulatory_article")))
        .orderBy(desc(t.publishedAt), t.itemId);
      return prior.map((row) => ({
        ...row,
        purpose: null,
        needs: null,
        limits: null,
        relatedItems: null,
        aiDrafted: null,
        regulatorySources: null,
        sourceCheckedAt: null,
      }));
    } catch (priorError) {
      if (pgError(priorError).code === "42P01") return [];
      throw priorError;
    }
  }
}

/** How many retained drafts one request files. The screen asks again until none is left, so no
 * single request runs long. */
export const RETAINED_DRAFTS_PER_REQUEST = 20;
type RetainedState = "not_in_library" | Revision["state"];

/**
 * Where each draft kept in the repository stands in the library: not filed yet, or the state of the
 * library item it was filed as, or found under (the same kind and title, or for an introduction or a
 * pack the same industry), whether a published version is on the site now, and for a regulatory
 * guide its latest source check.
 */
export async function retainedDraftStatus(actor: SourceStaffActor) {
  const { retainedDrafts, retainedItemId } = await import("./retained");
  const { proposedFormText } = await import("./form-text-maps");
  const drafts = await retainedDrafts();
  // The form text proposed for each template that has a map, by its hash.
  const proposals = new Map<string, string>();
  for (const draft of drafts)
    if (draft.template) {
      const proposal = await proposedFormText(draft.retainedId);
      if (proposal !== null) proposals.set(draft.retainedId, sha256(proposal));
    }
  const { library, checks } = await withEditor(actor, async (tx) => {
    const { valoManualLibrary: t, valoManualRegulatoryChecks: c } = await import("@workspace/db");
    const library = await tx
      .select({
        itemId: t.itemId,
        version: t.version,
        kind: t.kind,
        title: t.title,
        industry: t.industry,
        state: t.state,
        formTextSha256: sql<string | null>`encode(sha256(convert_to(${t.formText}, 'UTF8')), 'hex')`,
        hasDetails: sql<boolean>`${t.purpose} IS NOT NULL`,
      })
      .from(t);
    const checks = await tx
      .selectDistinctOn([c.candidateId], {
        candidateId: c.candidateId,
        checkedAt: c.checkedAt,
        holds: c.holds,
        sources: c.sources,
      })
      .from(c)
      .orderBy(c.candidateId, desc(c.checkedAt), desc(c.id));
    return { library, checks };
  });
  const items = new Map<string, { itemId: string; latest: (typeof library)[number]; live: number | null }>();
  for (const row of library) {
    const item = items.get(row.itemId) ?? { itemId: row.itemId, latest: row, live: null };
    if (row.version > item.latest.version) item.latest = row;
    if (row.state === "published") item.live = row.version;
    items.set(row.itemId, item);
  }
  const shownItems = new Set((await releasedManualEntries({ summaryOnly: true })).map((row) => row.itemId));
  const sameIndustry = (kind: string) => kind === "industry_introduction" || kind === "industry_pack";
  const status = drafts.map((draft) => {
    const own = items.get(retainedItemId(draft.retainedId));
    const found =
      own ??
      [...items.values()]
        .filter(
          ({ latest }) =>
            latest.kind === draft.kind &&
            (sameIndustry(draft.kind)
              ? latest.industry === draft.industry
              : latest.title.toLowerCase() === draft.title.toLowerCase()),
        )
        .sort((a, b) => Number(b.live !== null) - Number(a.live !== null))[0];
    const check = checks.find((row) => row.candidateId === draft.retainedId);
    const validThrough = check?.sources
      .map((source) => source.validThrough)
      .sort()
      .at(0);
    const state: RetainedState = !found
      ? "not_in_library"
      : found.live !== null
        ? "published"
        : found.latest.state;
    const proposal = proposals.get(draft.retainedId);
    return {
      retainedId: draft.retainedId,
      kind: draft.kind,
      title: draft.title,
      industry: draft.industry,
      itemId: found?.itemId ?? null,
      state,
      version: found?.latest.version ?? null,
      liveVersion: found?.live ?? null,
      shown: Boolean(found && shownItems.has(found.itemId)),
      // Whether the item's latest version carries the form text proposed for its fill-in form.
      formText: !proposal
        ? null
        : found?.latest.formTextSha256 === proposal
          ? ("filed" as const)
          : ("proposed" as const),
      // Whether the item's latest version says what it is for, its limits and how it was written.
      // A template without them waits for the details proposed for it.
      details: !draft.template ? null : found?.latest.hasDetails ? ("filed" as const) : ("proposed" as const),
      sourceCheck:
        draft.kind === "regulatory_article" && check
          ? {
              checkedAt: check.checkedAt.toISOString(),
              holds: check.holds.length,
              validThrough: validThrough ?? null,
            }
          : null,
    };
  });
  return {
    items: status,
    notInLibrary: status.filter((item) => item.state === "not_in_library").length,
    published: status.filter((item) => item.state === "published").length,
    shown: status.filter((item) => item.shown).length,
  };
}

/** The filed templates whose latest version lacks the form text proposed for them. */
const withoutFormText = (status: Awaited<ReturnType<typeof retainedDraftStatus>>) =>
  status.items.filter((item) => item.formText === "proposed" && item.itemId !== null);
/** The filed templates whose latest version lacks its entry details. */
const withoutDetails = (status: Awaited<ReturnType<typeof retainedDraftStatus>>) =>
  status.items.filter((item) => item.details === "proposed" && item.itemId !== null);
/** The entry details a template filed from its retained draft is given, as a draft gives them. */
async function proposedDetails(retainedId: string) {
  const { RETAINED_ENTRY_DETAILS } = await import("./retained-entry-details");
  const { retainedItemId } = await import("./retained");
  const proposal = RETAINED_ENTRY_DETAILS[retainedId];
  if (!proposal) return {};
  return {
    purpose: proposal.purpose,
    needs: proposal.needs.join("\n"),
    limits: proposal.limits,
    relatedItems: proposal.guides.map(retainedItemId),
    // The intake manifest records that the retained drafts were written in a ChatGPT conversation.
    aiDrafted: true,
  };
}
/** A revision's entry details, as a new draft version of it carries them forward. */
const keptDetails = (latest: Awaited<ReturnType<typeof getManualRevision>>) => ({
  purpose: latest.purpose,
  needs: latest.needs,
  limits: latest.limits,
  relatedItems: latest.relatedItems,
  aiDrafted: latest.aiDrafted,
});

/**
 * Files the next retained drafts that are not in the library as private drafts, through the same
 * draft check as an editor's own (`saveManualDraft`), under the editor who asked. A template gets the
 * reviewed route's blank Word master, made from the same section, and the form text proposed for its
 * fill-in form, if a map is written for it, and the entry details proposed for it
 * (`retained-entry-details.ts`). With `form_text`, files instead a new draft version of each filed
 * template whose latest version lacks its proposed form text, keeping that version's title, text, file
 * and entry details; with `details`, one of each filed template whose latest version lacks its entry
 * details, with the details proposed for it. Nothing is published: each draft waits for an editor to
 * preview and publish it, and a regulatory guide for the owner's source check.
 */
export async function loadRetainedDrafts(actor: SourceStaffActor, value: unknown) {
  const { load } = LoadRetainedDraftsBody.strict().parse(value);
  const { retainedDrafts, retainedItemId, retainedTemplateFile } = await import("./retained");
  const { proposedFormText } = await import("./form-text-maps");
  const before = await retainedDraftStatus(actor);
  const loaded: string[] = [];
  if (load === "form_text" || load === "details") {
    const waiting = load === "form_text" ? withoutFormText : withoutDetails;
    for (const item of waiting(before).slice(0, RETAINED_DRAFTS_PER_REQUEST)) {
      const latest = await getManualRevision(actor, item.itemId!);
      try {
        // A new draft version keeps the latest one's title, text and file, and its form text and entry
        // details unless they are what this request files.
        await saveManualDraft(actor, latest.itemId, {
          requestId: randomUUID(),
          baseVersion: latest.version,
          title: latest.title,
          kind: latest.kind,
          industry: latest.industry,
          body: latest.body,
          fileMode: latest.fileFormat ? "keep" : "text",
          formText: load === "form_text" ? await proposedFormText(item.retainedId) : latest.formText,
          ...(load === "details" ? await proposedDetails(item.retainedId) : keptDetails(latest)),
        });
        loaded.push(item.retainedId);
      } catch (error) {
        // Another editor saved a version a moment ago: the next request sees it.
        if (!(error instanceof ValoProblem && error.status === 409)) throw error;
      }
    }
    const status = await retainedDraftStatus(actor);
    return { loaded, remaining: waiting(status).length, status };
  }
  const drafts = new Map((await retainedDrafts()).map((draft) => [draft.retainedId, draft]));
  for (const item of before.items
    .filter((entry) => entry.state === "not_in_library")
    .slice(0, RETAINED_DRAFTS_PER_REQUEST)) {
    const draft = drafts.get(item.retainedId)!;
    const file = draft.template ? await retainedTemplateFile(draft.template) : undefined;
    const formText = draft.template ? await proposedFormText(draft.retainedId) : null;
    try {
      await saveManualDraft(actor, retainedItemId(draft.retainedId), {
        requestId: randomUUID(),
        baseVersion: 0,
        title: draft.title,
        kind: draft.kind,
        industry: draft.industry,
        body: draft.body,
        fileMode: file ? "upload" : "text",
        ...(file ? { upload: { format: "docx", base64: file.toString("base64") } } : {}),
        ...(formText === null ? {} : { formText }),
        ...(draft.template ? await proposedDetails(draft.retainedId) : {}),
      });
      loaded.push(draft.retainedId);
    } catch (error) {
      // Another editor filed the same draft a moment ago: it is in the library either way.
      if (!(error instanceof ValoProblem && error.status === 409)) throw error;
    }
  }
  const status = await retainedDraftStatus(actor);
  return { loaded, remaining: status.notInLibrary, status };
}
