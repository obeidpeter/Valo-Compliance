import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { sha256 } from "@workspace/valo-core";
import { DecideOwnerGuidanceBody, RefreshOwnerGuidanceBody } from "@workspace/api-zod";
import { registeredManualGuidance, checkManualRegulatorySources } from "./regulatory-evidence";
import { guidancePolicy } from "../publication";
import type { db, valoManualRegulatoryChecks } from "@workspace/db";
import { ValoProblem } from "../../platform/valo-problem";
import { assertDevelopmentRuntime } from "../../platform/valo-development-runtime";
import {
  activeStaffAssignment,
  assertStaffAssignmentCurrent,
  requireFreshStaffSession,
  type StaffActor,
} from "../staff";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Check = typeof valoManualRegulatoryChecks.$inferSelect;
const conflict = () =>
  new ValoProblem(409, "The draft or its source check changed. Reopen the article before signing.");

async function asOwner<T>(actor: StaffActor, work: (tx: Tx) => Promise<T>) {
  assertDevelopmentRuntime();
  requireFreshStaffSession(actor);
  const { db: store, valoStaffAssignments: a } = await import("@workspace/db");
  return store.transaction(async (tx) => {
    const [role] = await tx
      .select({ id: a.id })
      .from(a)
      .where(
        and(
          eq(a.identityId, actor.identityId),
          eq(a.role, "system"),
          eq(a.grantMode, "permanent"),
          activeStaffAssignment(),
        ),
      )
      .for("share");
    if (!role)
      throw new ValoProblem(403, "A permanent development owner with recent verification is required.");
    await assertStaffAssignmentCurrent(tx, role.id);
    const owner = await tx.execute(sql`select valo_manual_regulatory_owner(${actor.identityId}) as allowed`);
    if (!owner.rows[0]?.allowed)
      throw new ValoProblem(403, "Only the designated development owner can sign regulatory guidance.");
    return work(tx);
  });
}

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
          .select({ itemId: t.itemId, version: t.version, digest: t.digest })
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
    return {
      hasMore: rows.length > 50,
      items: entries.map((row) => {
        const check = latest.find((x) => x.title === row.title);
        const holds = holdsFor(check, row);
        const released = live.find((r) => r.itemId === row.itemId);
        return {
          ...row,
          checkId: check?.id ?? null,
          checkedAt: check?.checkedAt.toISOString() ?? null,
          holds,
          sources: (check?.sources ?? []).map(({ url, title, locator }) => ({ url, title, locator })),
          live: released ? { version: released.version, digest: released.digest } : null,
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
    const [target] = await tx
      .select()
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
