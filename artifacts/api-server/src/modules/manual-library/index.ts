import { and, desc, eq, getTableColumns, sql } from "drizzle-orm";
import { coveragePlan, digest, sha256 } from "@workspace/valo-core";
import { ActOnManualLibraryBody, SaveManualLibraryDraftBody } from "@workspace/api-zod";
import type { db, valoManualLibrary } from "@workspace/db";
import { requireSourceStaff, type SourceStaffActor } from "../sources";
import { ValoProblem } from "../../platform/valo-problem";
import { assertDevelopmentRuntime, isDevelopmentRuntime } from "../../platform/valo-development-runtime";
import { readEditorialUpload, wordFromText, type EditorialFile } from "./files";

type Revision = typeof valoManualLibrary.$inferSelect;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const sectors = new Set(coveragePlan().industries.map((i) => i.slug));
const missing = () => new ValoProblem(404, "This library item is unavailable.");
const conflict = () =>
  new ValoProblem(409, "This item changed. Reopen the latest version before continuing.");
function summary(row: Revision) {
  return {
    itemId: row.itemId,
    title: row.title,
    version: row.version,
    kind: row.kind,
    state: row.state,
    industry: row.industry,
  };
}
async function detail(tx: Tx, row: Revision) {
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
  const { db } = await import("@workspace/db");
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
export async function listManualLibrary(actor: SourceStaffActor, page: number) {
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
    const items = await tx
      .select()
      .from(latest)
      .orderBy(desc(latest.createdAt), latest.itemId)
      .offset((page - 1) * 50)
      .limit(51);
    return { items: items.slice(0, 50), hasMore: items.length > 50 };
  });
}
async function latestRevision(tx: Tx, itemId: string) {
  const { valoManualLibrary: t } = await import("@workspace/db");
  return (await tx.select().from(t).where(eq(t.itemId, itemId)).orderBy(desc(t.version)).limit(1))[0];
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
  const input = SaveManualLibraryDraftBody.strict().parse(value);
  const title = input.title.trim();
  if (!title || hasControlCharacters(title)) throw new ValoProblem(422, "Enter a title on one line.");
  if (
    (input.industry !== null && !sectors.has(input.industry)) ||
    (input.kind === "industry_introduction" && !input.industry)
  )
    throw new ValoProblem(422, "Choose a listed industry for this item.");
  if (
    (input.fileMode === "upload") !== Boolean(input.upload) ||
    (input.fileMode === "keep" && input.kind !== "template")
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
      if (input.kind === "template") {
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
      const [retry] = await tx.select().from(t).where(eq(t.id, input.requestId));
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
        .returning();
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
        .select()
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
export async function releasedManualFile(id: string) {
  assertDevelopmentRuntime();
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
/** Existing readers may still run against the schema preceding the additive migration. */
export async function releasedManualEntries(slug?: string) {
  if (!isDevelopmentRuntime()) return [];
  const { db, valoManualLibrary: t } = await import("@workspace/db");
  const {
    fileBytes: _bytes,
    createdBy: _creator,
    closedBy: _closer,
    publishedBy: _editor,
    ...fields
  } = getTableColumns(t);
  try {
    return await db
      .select(fields)
      .from(t)
      .where(and(eq(t.state, "published"), slug ? eq(t.slug, slug) : undefined))
      .orderBy(desc(t.publishedAt), t.itemId);
  } catch (error) {
    if (pgError(error).code === "42P01") return [];
    throw error;
  }
}
