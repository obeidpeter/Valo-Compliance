import { and, desc, eq, getTableColumns, ilike, isNull, ne, or, sql } from "drizzle-orm";
import { baselineTemplates, coveragePlan, digest, sha256 } from "@workspace/valo-core";
import { ActOnManualLibraryBody, SaveManualLibraryDraftBody } from "@workspace/api-zod";
import type { db, valoManualLibrary } from "@workspace/db";
import type { SourceStaffActor } from "../sources";
import { ValoProblem } from "../../platform/valo-problem";
import { assertDevelopmentRuntime, isDevelopmentRuntime } from "../../platform/valo-development-runtime";
import type { EditorialFile } from "./files";
import {
  assertAccountNotErasedOrSuspended,
  authorizeWorkspaceWrite,
  type WorkspaceActor,
} from "../workspaces";

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
async function detail(tx: Tx, row: RevisionMeta) {
  const { valoManualLibrary: t } = await import("@workspace/db");
  const [live] = await tx
    .select({ version: t.version, digest: t.digest })
    .from(t)
    .where(and(eq(t.itemId, row.itemId), eq(t.state, "published")));
  return {
    ...summary(row),
    id: row.id,
    body: row.body,
    digest: row.digest,
    fileFormat: row.fileFormat,
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
    if (e.code === "42P01")
      throw new ValoProblem(503, "Apply the editorial library migration before using the publisher.");
    if (e.code === "23505")
      throw new ValoProblem(
        409,
        e.constraint === "valo_manual_one_intro"
          ? "This industry already has an introduction. Edit its existing entry or withdraw it first."
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
export async function saveManualDraft(actor: SourceStaffActor, itemId: string, value: unknown) {
  const { readEditorialUpload, wordFromText } = await import("./files");
  const input = SaveManualLibraryDraftBody.strict().parse(value);
  const title = input.title.trim();
  if (!title || hasControlCharacters(title)) throw new ValoProblem(422, "Enter a title on one line.");
  if (isManualTemplate(input.kind)) {
    const registered = baselineTemplates.find((entry) => entry.title.toLowerCase() === title.toLowerCase());
    if (registered && (registered.access === "premium") !== (input.kind === "premium_template"))
      throw new ValoProblem(422, "Choose the access level registered for this template.");
  }
  const premium = input.kind === "premium_template";
  if (premium && (input.fileMode === "text" || !input.body.trim() || input.body.trim().length > 600))
    throw new ValoProblem(
      422,
      "Choose a template file and enter a separate public description of up to 600 characters.",
    );
  if (
    (input.industry !== null && !sectors.has(input.industry)) ||
    (input.kind === "industry_introduction" && !input.industry)
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
      const hash = digest({
        kind: input.kind,
        industry: input.industry,
        title,
        body,
        fileFormat: file?.format ?? null,
        fileHash: file ? sha256(file.bytes) : null,
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
            sql`${regulatoryEnabled} and (
        select newest.evidence_sha256 = ${c.evidenceSha256} and cardinality(newest.holds) = 0
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
      const prior = await db
        .select(fields)
        .from(t)
        .where(and(released, ne(t.kind, "regulatory_article")))
        .orderBy(desc(t.publishedAt), t.itemId);
      return prior.map((row) => ({ ...row, regulatorySources: null, sourceCheckedAt: null }));
    } catch (priorError) {
      if (pgError(priorError).code === "42P01") return [];
      throw priorError;
    }
  }
}
