import { and, desc, eq, getTableColumns, inArray, isNotNull, sql } from "drizzle-orm";
import { baselineTemplates, sha256 } from "@workspace/valo-core";
import {
  DecideOwnerGuidanceBody,
  LiftOwnerGuidanceHoldBody,
  RefreshOwnerGuidanceBody,
} from "@workspace/api-zod";
import { registeredManualGuidance, checkManualRegulatorySources } from "./regulatory-evidence";
import { guidancePolicy } from "../publication";
import type { db, valoManualRegulatoryChecks } from "@workspace/db";
import { ValoProblem } from "../../platform/valo-problem";
import { asDevelopmentOwner, type StaffActor } from "../staff";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Check = typeof valoManualRegulatoryChecks.$inferSelect;
const conflict = () =>
  new ValoProblem(409, "The draft or its source check changed. Reopen the article before signing.");

const asOwner = <T>(actor: StaffActor, work: (tx: Tx) => Promise<T>) =>
  asDevelopmentOwner(actor, work).catch((error: unknown) => {
    // The panel reads each version's record (docs/architecture/guidance-record.md), which a database
    // the guidance record migration has not reached has no columns for; it says so, as the staff
    // library does.
    const e = error as { cause?: { code?: string }; code?: string };
    if ((e.cause ?? e).code === "42703")
      throw new ValoProblem(
        503,
        "Apply the latest editorial library migrations before signing regulatory guides.",
      );
    throw error;
  });
/** The registered title of a template number a regulatory article's record names. */
const templateTitle = (number: string) =>
  baselineTemplates.find((entry) => entry.id === number)?.title ?? null;

function holdsFor(check: Check | undefined, row: { title: string; body: string }) {
  if (!check || check.title !== row.title || check.bodySha256 !== sha256(row.body))
    return ["There is no source check for this exact title and text."];
  if (
    Date.now() - +check.checkedAt > 86_400_000 ||
    +check.checkedAt > Date.now() ||
    check.sources.some(
      (s) =>
        !(Date.parse(s.validThrough) > Date.now()) ||
        !(Date.parse(s.retrievedAt) <= Date.now() && Date.parse(s.retrievedAt) > Date.now() - 86_400_000),
    )
  )
    return ["Refresh the official sources before signing this version."];
  return check.holds;
}

export function listOwnerGuidance(actor: StaffActor, page: number) {
  return asOwner(actor, async (tx) => {
    const { valoManualLibrary: t, valoManualRegulatoryChecks: c } = await import("@workspace/db");
    const current = tx
      .selectDistinctOn([t.itemId], {
        itemId: t.itemId,
        version: t.version,
        digest: t.digest,
        title: t.title,
        body: t.body,
        state: t.state,
        // The version's record, which the owner signs with its text (docs/architecture/guidance-record.md).
        appliesTo: t.appliesTo,
        actionEvidence: t.actionEvidence,
        relatedTemplates: t.relatedTemplates,
      })
      .from(t)
      .where(eq(t.kind, "regulatory_article"))
      .orderBy(t.itemId, desc(t.version))
      .as("current");
    const rows = await tx
      .select()
      .from(current)
      .orderBy(current.title, current.itemId)
      .offset((page - 1) * 50)
      .limit(51);
    const entries = rows.slice(0, 50);
    const latest = await tx
      .selectDistinctOn([c.candidateId])
      .from(c)
      .orderBy(c.candidateId, desc(c.checkedAt), desc(c.id));
    const live = entries.length
      ? await tx
          .select({ id: t.id, itemId: t.itemId, version: t.version, digest: t.digest })
          .from(t)
          .where(
            and(
              eq(t.state, "published"),
              inArray(
                t.itemId,
                entries.map((x) => x.itemId),
              ),
            ),
          )
      : [];
    // Every version of these articles that was released: signing a later one says what changed
    // (docs/architecture/guidance-currency.md, slice 3).
    const releases = entries.length
      ? await tx
          .select({ itemId: t.itemId, version: t.version })
          .from(t)
          .where(
            and(
              isNotNull(t.publishedAt),
              inArray(
                t.itemId,
                entries.map((x) => x.itemId),
              ),
            ),
          )
      : [];
    // The holds Content editors placed on the published guides, which only the owner lifts
    // (docs/architecture/library-holds.md, slice 2).
    const { holdRecord, holdsReady, openHold } = await import("../manual-library");
    const libraryHolds = new Map<string, ReturnType<typeof holdRecord>>();
    if (live.length && (await holdsReady(tx)))
      for (const released of live)
        libraryHolds.set(released.itemId, holdRecord(await openHold(tx, released.id)));
    return {
      hasMore: rows.length > 50,
      items: entries.map((row) => {
        const check = latest.find((x) => x.title === row.title);
        const holds = holdsFor(check, row);
        const released = live.find((r) => r.itemId === row.itemId);
        const earlier = releases
          .filter((r) => r.itemId === row.itemId && r.version < row.version)
          .map((r) => r.version);
        return {
          ...row,
          relatedTemplates: (row.relatedTemplates ?? []).map((number) => ({
            number,
            title: templateTitle(number),
          })),
          checkId: check?.id ?? null,
          checkedAt: check?.checkedAt.toISOString() ?? null,
          holds,
          sources: (check?.sources ?? []).map(({ url, title, locator }) => ({ url, title, locator })),
          live: released ? { version: released.version, digest: released.digest } : null,
          previousRelease: earlier.length ? Math.max(...earlier) : null,
          libraryHold: libraryHolds.get(row.itemId) ?? null,
        };
      }),
    };
  });
}

export async function refreshOwnerSources(actor: StaffActor, itemId: string, body: unknown) {
  const input = RefreshOwnerGuidanceBody.strict().parse(body);
  const draft = await asOwner(actor, async (tx) => {
    const { valoManualLibrary: t } = await import("@workspace/db");
    const [latest] = await tx
      .select({ title: t.title, body: t.body, version: t.version, digest: t.digest })
      .from(t)
      .where(and(eq(t.itemId, itemId), eq(t.kind, "regulatory_article")))
      .orderBy(desc(t.version))
      .limit(1);
    if (!latest || latest.version !== input.version || latest.digest !== input.digest) throw conflict();
    return latest;
  });
  const id = await registeredManualGuidance(draft.title, draft.body);
  if (!id)
    throw new ValoProblem(
      409,
      "The current text needs a registered claim map before its sources can be checked.",
    );
  const [result] = await checkManualRegulatorySources([id]);
  return result!;
}

export function decideOwnerGuidance(actor: StaffActor, itemId: string, body: unknown) {
  const input = DecideOwnerGuidanceBody.strict().parse(body);
  if (!input.confirmed) throw new ValoProblem(422, "Confirm the selected article and sources.");
  return asOwner(actor, async (tx) => {
    if (input.action === "publish") {
      const { policy } = await guidancePolicy();
      if (
        !policy.ownerApproved ||
        !policy.allowedClasses.includes("sourced_guidance") ||
        !policy.jurisdictions.includes("NG")
      )
        throw new ValoProblem(
          409,
          "The owner’s publication restrictions currently hold Nigerian regulatory guidance.",
        );
    }
    const { valoManualLibrary: t, valoManualRegulatoryChecks: c } = await import("@workspace/db");
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${itemId},811))`);
    // An article has no form text, and a database the form text migration has not reached yet has no
    // such column: the signing reads neither.
    const { formText: _formText, ...articleColumns } = getTableColumns(t);
    const [target] = await tx
      .select(articleColumns)
      .from(t)
      .where(and(eq(t.itemId, itemId), eq(t.version, input.version), eq(t.kind, "regulatory_article")));
    if (!target || target.digest !== input.digest) throw conflict();
    const now = new Date();
    if (input.action === "withdraw") {
      if (target.state !== "withdrawn") {
        if (target.state !== "published") throw conflict();
        await tx
          .update(t)
          .set({ state: "withdrawn", closedBy: actor.identityId, closedAt: now })
          .where(eq(t.id, target.id));
      }
      return { itemId, version: target.version, state: "withdrawn" as const };
    }
    const [latest] = await tx
      .select({ id: t.id })
      .from(t)
      .where(eq(t.itemId, itemId))
      .orderBy(desc(t.version))
      .limit(1);
    if (latest?.id !== target.id || !input.checkId) throw conflict();
    if (target.state === "published" && target.regulatoryCheckId === input.checkId)
      return { itemId, version: target.version, state: "published" as const };
    if (target.state !== "draft") throw conflict();
    // A regulatory article is released only with whom it applies to (CMP-001's scope), which the database
    // also requires (docs/architecture/guidance-record.md).
    if (target.appliesTo === null)
      throw new ValoProblem(
        409,
        "This version does not say whom it applies to. A Content editor saves a new version that says it before you sign.",
      );
    if (target.createdBy === actor.identityId)
      throw new ValoProblem(403, "A different Content editor must prepare the draft for owner sign-off.");
    const [check] = await tx.select().from(c).where(eq(c.id, input.checkId));
    if (!check || holdsFor(check, target).length || !check.sources.length)
      throw new ValoProblem(409, "The exact draft needs a recent source check with every claim resolved.");
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${check.candidateId},812))`);
    const [newest] = await tx
      .select({ id: c.id })
      .from(c)
      .where(eq(c.candidateId, check.candidateId))
      .orderBy(desc(c.checkedAt), desc(c.id))
      .limit(1);
    if (newest?.id !== check.id) throw conflict();
    const [duplicate] = await tx
      .select({ itemId: t.itemId })
      .from(t)
      .innerJoin(c, eq(c.id, t.regulatoryCheckId))
      .where(and(eq(c.candidateId, check.candidateId), eq(t.state, "published")));
    if (duplicate && duplicate.itemId !== itemId)
      throw new ValoProblem(
        409,
        "This regulatory article already has a published entry. Use its existing revision history.",
      );
    // A version that follows an earlier release says what changed, as in the staff library
    // (docs/architecture/guidance-currency.md, slice 3). The owner writes it when signing.
    const { recordChange } = await import("../manual-library");
    await recordChange(tx, target, input.change, actor.identityId);
    await tx
      .update(t)
      .set({ state: "replaced", closedAt: now, closedBy: actor.identityId })
      .where(and(eq(t.itemId, itemId), eq(t.state, "published")));
    await tx
      .update(t)
      .set({
        state: "published",
        regulatoryCheckId: check.id,
        publishedAt: now,
        publishedBy: actor.identityId,
      })
      .where(eq(t.id, target.id));
    return { itemId, version: target.version, state: "published" as const };
  });
}
/**
 * The development owner lifts the hold a Content editor placed on a published regulatory guide, with why
 * (docs/architecture/library-holds.md, slice 2). Only the owner lifts it, as only the owner releases one
 * (decision 0018); the database refuses anyone else, and never changes the lifting.
 */
export async function liftOwnerGuidanceHold(actor: StaffActor, itemId: string, body: unknown) {
  const input = LiftOwnerGuidanceHoldBody.strict().parse(body);
  const reason = input.reason.trim();
  if (reason.length < 20 || reason.length > 1000)
    throw new ValoProblem(422, "Say why the hold is lifted, in 20 to 1,000 characters.");
  return asOwner(actor, async (tx) => {
    const { valoManualLibrary: t, valoManualHoldLifts } = await import("@workspace/db");
    const { holdsReady, openHold } = await import("../manual-library");
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${itemId},811))`);
    const [published] = await tx
      .select({ id: t.id, version: t.version, digest: t.digest })
      .from(t)
      .where(and(eq(t.itemId, itemId), eq(t.kind, "regulatory_article"), eq(t.state, "published")));
    if (!published || published.version !== input.version || published.digest !== input.digest)
      throw conflict();
    const hold = (await holdsReady(tx)) ? await openHold(tx, published.id) : null;
    if (!hold) throw new ValoProblem(409, "This guide is not held.");
    await tx.insert(valoManualHoldLifts).values({ hold: hold.id, reason, liftedBy: actor.identityId });
    return { itemId, version: published.version, state: "published" as const };
  });
}
