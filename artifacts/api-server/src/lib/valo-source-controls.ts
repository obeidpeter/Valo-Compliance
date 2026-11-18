import { randomUUID, createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, valoStaffAssignments } from "@workspace/db";
import { z } from "zod";
import { allSourceLeads } from "@workspace/valo-core";
import { lockSourceState, sourceTime, type SourceTx, recordSourceImpact } from "../modules/sources";
import { registerSourceWatch } from "./valo-source-monitor";
import { ValoProblem } from "../platform/valo-problem";
import { assertDevelopmentRuntime } from "../platform/valo-development-runtime";
import {
  activeStaffAssignment,
  assertStaffAssignmentCurrent,
  requireFreshStaffSession,
  type StaffActor,
} from "../modules/staff";
import { authorizeWorkspaceWrite, type WorkspaceActor } from "./valo-store";
export type SourceStaffActor = StaffActor;
const base = { requestKey: z.string().uuid(), reason: z.string().trim().min(20).max(1000) };
export const sourceControlInput = z.discriminatedUnion("action", [
  z.object({ ...base, action: z.literal("watch_source"), sourceId: z.string().min(1).max(100) }).strict(),
  z
    .object({
      ...base,
      action: z.literal("hold_version"),
      kind: z.enum(["content", "rule"]),
      id: z.string().uuid(),
      version: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      ...base,
      action: z.literal("withdraw_version"),
      kind: z.enum(["content", "rule"]),
      id: z.string().uuid(),
      version: z.number().int().positive(),
    })
    .strict(),
  z.object({ ...base, action: z.literal("pause_service"), service: z.enum(["ai", "checkout"]) }).strict(),
  z.object({ ...base, action: z.literal("resume_service"), service: z.enum(["ai", "checkout"]) }).strict(),
]);
/** Staff reads and writes use the shared authority checks: fresh MFA, an active and
 * unexpired assignment for this area, and both re-checked after any row-lock wait. */
export async function requireSourceStaff(tx: SourceTx, actor: SourceStaffActor, area: "content" | "system") {
  requireFreshStaffSession(actor);
  const [row] = await tx
    .select({ id: valoStaffAssignments.id })
    .from(valoStaffAssignments)
    .where(
      and(
        eq(valoStaffAssignments.identityId, actor.identityId),
        eq(valoStaffAssignments.role, area),
        activeStaffAssignment(),
      ),
    )
    .for("share");
  if (!row) throw new ValoProblem(403, "An active role for this staff area is required.");
  await assertStaffAssignmentCurrent(tx, row.id);
  requireFreshStaffSession(actor);
  return row.id;
}
export async function sourceControls(actor: SourceStaffActor, area: "content" | "system", page = 1) {
  return db.transaction(async (tx) => {
    const assignment = await requireSourceStaff(tx, actor, area);
    await tx.execute(
      sql`insert into valo_staff_access_audit(id,assignment_id,actor_id,area,reason) values(${randomUUID()}::uuid,${assignment}::uuid,${actor.identityId},${area},'Read source/safety controls with active role and recent MFA')`,
    );
    const offset = (page - 1) * 50;
    const versions =
      area === "content"
        ? (
            await tx.execute(sql`select 'content' as kind,c.id,c.template_id as key,c.version,c.status,c.review_by,
    exists(select 1 from valo_source_impacts i where i.target_kind='content' and i.target_id=c.id) as safety_held
    from valo_content_versions c union all select 'rule' as kind,r.id,r.rule_id as key,r.version,r.status,null as review_by,
    exists(select 1 from valo_source_impacts i where i.target_kind='rule' and i.target_id=r.id) as safety_held from valo_rule_releases r
    order by key,version desc limit 51 offset ${offset}`)
          ).rows
        : [];
    const sources =
      area === "content"
        ? (
            await tx.execute(
              sql`select source_id,url,risk,checked_at,failure_code,next_check_at from valo_source_watches order by source_id limit 200`,
            )
          ).rows
        : [];
    const review =
      area === "content"
        ? (
            await tx.execute(
              sql`select w.id,w.status,i.target_kind,i.target_key,i.target_version,i.reason,i.created_at from valo_source_review_work w join valo_source_impacts i on i.id=w.impact_id order by i.created_at desc,i.id limit 50`,
            )
          ).rows
        : [];
    const services =
      area === "system"
        ? (
            await tx.execute(
              sql`select key,enabled,reason,updated_at from valo_safety_switches where key in ('all_ai','checkout') order by key`,
            )
          ).rows
        : [];
    const date = (value: unknown) => (value ? new Date(sourceTime(value)).toISOString() : null);
    return {
      area,
      page,
      hasMore: versions.length > 50,
      versions: versions.slice(0, 50).map((v) => ({
        kind: String(v.kind),
        id: String(v.id),
        key: String(v.key),
        version: Number(v.version),
        status: String(v.status),
        reviewBy: date(v.review_by),
        safetyHeld: Boolean(v.safety_held),
      })),
      sources: sources.map((v) => ({
        sourceId: String(v.source_id),
        url: String(v.url),
        risk: String(v.risk),
        checkedAt: date(v.checked_at),
        failureCode: v.failure_code ? String(v.failure_code) : null,
        nextCheckAt: date(v.next_check_at)!,
      })),
      review: review.map((v) => ({
        id: String(v.id),
        status: String(v.status),
        targetKind: String(v.target_kind),
        targetKey: String(v.target_key),
        targetVersion: Number(v.target_version),
        reason: String(v.reason),
        createdAt: date(v.created_at)!,
      })),
      services: services.map((v) => ({
        key: String(v.key),
        enabled: Boolean(v.enabled),
        reason: String(v.reason),
        updatedAt: date(v.updated_at)!,
      })),
      sourceChoices: area === "content" ? allSourceLeads.map((s) => ({ id: s.id, title: s.title })) : [],
      notice:
        "Safety holds apply immediately. A fetch never approves claims. Held versions need a new version through the existing editorial gates; reviews and external messages are not dispatched here.",
    };
  });
}
/**
 * What pausing or resuming a service does to customers, recorded with the reason and actor
 * (ADM-007). A pause refuses only new work of that service: free guidance, saved documents and
 * what customers already have stay available, because none of them reads the safety switches.
 */
async function serviceImpact(tx: SourceTx, service: "ai" | "checkout", paused: boolean) {
  if (!paused) return { restored: service === "ai" ? "AI drafting and review" : "new orders and checkout" };
  if (service === "ai")
    return {
      refused: "new AI drafting and review",
      unaffected: "free guidance, saved documents and accepted drafts",
    };
  const [open] = (
    await tx.execute(sql`select count(*)::int as n from valo_orders where status in ('created','pending')`)
  ).rows;
  return {
    refused: "new orders and checkout",
    unaffected: "free guidance, saved documents, completed purchases, entitlements and downloads",
    ordersAwaitingPayment: Number(open?.n ?? 0),
  };
}

export async function actOnSourceControls(actor: SourceStaffActor, raw: unknown) {
  assertDevelopmentRuntime();
  const input = sourceControlInput.parse(raw),
    area = "service" in input ? "system" : "content";
  const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  return db.transaction(async (tx) => {
    await lockSourceState(tx, true);
    const assignment = await requireSourceStaff(tx, actor, area);
    const prior = (
      await tx.execute(
        sql`select id,actor_id,payload_hash,current from valo_safety_control_audit where request_key=${input.requestKey}::uuid`,
      )
    ).rows[0];
    if (prior) {
      if (prior.actor_id !== actor.identityId || prior.payload_hash !== hash)
        throw new ValoProblem(409, "This action key belongs to another request.");
      return { auditId: String(prior.id), replayed: true, result: prior.current };
    }
    let previous: unknown = {},
      current: unknown = {},
      target = "";
    if ("service" in input) {
      target = input.service === "ai" ? "all_ai" : "checkout";
      previous = (
        await tx.execute(sql`select enabled,reason,actor_id from valo_safety_switches where key=${target}`)
      ).rows[0] ?? { configured: false };
      const enabled = input.action === "resume_service";
      await tx.execute(sql`insert into valo_safety_switches(key,enabled,reason,actor_id) values(${target},${enabled},${input.reason},${actor.identityId})
    on conflict(key) do update set enabled=excluded.enabled,reason=excluded.reason,actor_id=excluded.actor_id,updated_at=now()`);
      current = {
        service: input.service,
        paused: !enabled,
        customerImpact: await serviceImpact(tx, input.service, !enabled),
        notice:
          "This changes only the safety pause. Existing financial, merchant, publication and development restrictions still apply.",
      };
    } else if (input.action === "watch_source") {
      target = input.sourceId;
      if (!allSourceLeads.some((s) => s.id === input.sourceId))
        throw new ValoProblem(422, "Choose an existing allowlisted official source.");
      await registerSourceWatch(tx, input.sourceId);
      current = { sourceId: input.sourceId, status: "registered_for_daily_check", publication: "unchanged" };
    } else {
      target = `${input.kind}:${input.id}`;
      const row =
        input.kind === "content"
          ? (
              await tx.execute(
                sql`select status,version from valo_content_versions where id=${input.id}::uuid for update`,
              )
            ).rows[0]
          : (
              await tx.execute(
                sql`select status,version from valo_rule_releases where id=${input.id}::uuid for update`,
              )
            ).rows[0];
      if (!row) throw new ValoProblem(404, "The selected version does not exist.");
      if (Number(row.version) !== input.version)
        throw new ValoProblem(409, "The version changed. Refresh before taking an action.");
      previous = row;
      const impactId = await recordSourceImpact(tx, {
        kind: input.kind,
        id: input.id,
        reason: input.reason,
        actor: actor.identityId,
        action: input.action === "withdraw_version" ? "withdraw" : "hold",
        dedupe: `staff:${input.requestKey}`,
      });
      // The source impact is an append-only effective hold even for immutable
      // candidates or rules. No status/manifest/review receipt is manufactured.
      current = {
        kind: input.kind,
        id: input.id,
        version: input.version,
        impactId,
        effectiveStatus: input.action === "withdraw_version" ? "withdrawn" : "held",
      };
    }
    const id = randomUUID();
    await tx.execute(sql`insert into valo_safety_control_audit(id,request_key,actor_id,assignment_id,area,action,target,reason,previous,current,payload_hash)
   values(${id}::uuid,${input.requestKey}::uuid,${actor.identityId},${assignment}::uuid,${area},${input.action},${target},${input.reason},${JSON.stringify(previous)}::jsonb,${JSON.stringify(current)}::jsonb,${hash})`);
    return { auditId: id, replayed: false, result: current };
  });
}
export async function correctionNotices(actor: WorkspaceActor, page = 1) {
  return db.transaction(async (tx) => {
    await authorizeWorkspaceWrite(tx, actor);
    const rows = (
      await tx.execute(sql`select id,entity_kind,entity_id,message,created_at from valo_correction_notices
   where workspace_id=${actor.workspaceId}::uuid order by created_at desc,id limit 51 offset ${(page - 1) * 50}`)
    ).rows;
    return {
      page,
      hasMore: rows.length > 50,
      notices: rows.slice(0, 50).map((v) => ({
        id: String(v.id),
        entityKind: String(v.entity_kind),
        entityId: String(v.entity_id),
        message: String(v.message),
        createdAt: new Date(sourceTime(v.created_at)).toISOString(),
      })),
    };
  });
}
