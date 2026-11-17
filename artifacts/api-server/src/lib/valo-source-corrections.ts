import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { type SourceTx, type SourceTarget, lockSourceState } from "./valo-source-state";
import { ValoProblem } from "./valo-problem";
export type ImpactInput = {
  kind: SourceTarget;
  id: string;
  reason: string;
  actor: string;
  dedupe: string;
  action?: "hold" | "withdraw";
  causeKey?: string;
  sourceId?: string;
  oldSnapshotId?: string | null;
  newSnapshotId?: string | null;
};
/** Called under the exclusive source-state lock. The immutable impact itself
 * blocks reads immediately; bounded fan-out may then survive worker restarts. */
export async function recordSourceImpact(tx: SourceTx, input: ImpactInput) {
  const row =
    input.kind === "content"
      ? (
          await tx.execute(
            sql`select template_id as key,version from valo_content_versions where id=${input.id}::uuid for update`,
          )
        ).rows[0]
      : (
          await tx.execute(
            sql`select rule_id as key,version from valo_rule_releases where id=${input.id}::uuid for update`,
          )
        ).rows[0];
  if (!row) throw new ValoProblem(404, "The selected version does not exist.");
  const id = randomUUID();
  const result = await tx.execute(sql`insert into valo_source_impacts
  (id,dedupe_key,target_kind,target_id,target_key,target_version,source_id,old_snapshot_id,new_snapshot_id,reason,actor_id,action,phase)
  values(${id}::uuid,${input.dedupe},${input.kind},${input.id}::uuid,${String(row.key)},${Number(row.version)},
   ${input.sourceId ?? null},${input.oldSnapshotId ?? null}::uuid,${input.newSnapshotId ?? null}::uuid,${input.reason},${input.actor},${input.action ?? "hold"},${input.kind === "content" ? "derived" : "tasks"})
  on conflict(dedupe_key) do nothing returning id`);
  const impactId = String(
    result.rows[0]?.id ??
      (await tx.execute(sql`select id from valo_source_impacts where dedupe_key=${input.dedupe}`)).rows[0]!
        .id,
  );
  await tx.execute(
    sql`insert into valo_source_review_work(id,impact_id) values(${randomUUID()}::uuid,${impactId}::uuid) on conflict(impact_id) do nothing`,
  );
  return impactId;
}
/** Only enqueue under the source-change transaction: current gates already see
 * the new hash/failure. Dependency fan-out is a separate bounded durable job. */
export async function impactSourceDependants(
  tx: SourceTx,
  sourceId: string,
  reason: string,
  key: string,
  newSnapshotId: string | null,
) {
  const watch = (
    await tx.execute(
      sql`select last_raw_hash,failure_code from valo_source_watches where source_id=${sourceId}`,
    )
  ).rows[0];
  await tx.execute(sql`insert into valo_source_dependency_jobs(id,source_id,dedupe_key,reason,new_snapshot_id,observed_hash)
  values(${randomUUID()}::uuid,${sourceId},${key},${reason},${newSnapshotId}::uuid,${newSnapshotId && !watch?.failure_code ? String(watch?.last_raw_hash) : null}) on conflict(dedupe_key) do nothing`);
}
export async function processSourceDependencyJob() {
  return db.transaction(async (tx) => {
    await lockSourceState(tx, true);
    const job = (
      await tx.execute(
        sql`select * from valo_source_dependency_jobs where status='pending' order by created_at,id for update skip locked limit 1`,
      )
    ).rows[0];
    if (!job) return false;
    const rows = (
      await tx.execute(sql`select b.target_kind,b.target_id,min(b.snapshot_id::text) as old_snapshot_id
   from valo_source_release_bindings b where b.source_id=${String(job.source_id)} and b.created_at<=${job.created_at}
   and (${job.observed_hash}::text is null or b.raw_hash<>${job.observed_hash})
   and (b.target_kind,b.target_id)>(${job.cursor_kind ?? ""},${job.cursor_id ?? "00000000-0000-0000-0000-000000000000"}::uuid)
   and not exists(select 1 from valo_source_impacts i where i.target_kind=b.target_kind and i.target_id=b.target_id)
   group by b.target_kind,b.target_id order by b.target_kind,b.target_id limit 50`)
    ).rows;
    for (const b of rows)
      await recordSourceImpact(tx, {
        kind: b.target_kind as SourceTarget,
        id: String(b.target_id),
        sourceId: String(job.source_id),
        oldSnapshotId: String(b.old_snapshot_id),
        newSnapshotId: job.new_snapshot_id ? String(job.new_snapshot_id) : null,
        reason: String(job.reason),
        actor: "service:source-monitor",
        causeKey: String(job.dedupe_key),
        dedupe: `${String(job.dedupe_key)}:${String(b.target_kind)}:${String(b.target_id)}`,
      });
    const last = rows.at(-1);
    await tx.execute(sql`update valo_source_dependency_jobs set cursor_kind=${last?.target_kind ?? job.cursor_kind},cursor_id=${last?.target_id ?? job.cursor_id}::uuid,
   status=${rows.length < 50 ? "complete" : "pending"},completed_at=case when ${rows.length < 50} then now() else null end where id=${String(job.id)}::uuid`);
    return true;
  });
}
/** Exact requirement version relationship only. Future corrected versions are
 * not made stale by an old version's hold. The read gate covers this edge before
 * this queued fan-out reaches tasks or notices. */
export async function processDerivedImpact() {
  return db.transaction(async (tx) => {
    await lockSourceState(tx, true);
    const impact = (
      await tx.execute(
        sql`select * from valo_source_impacts where phase='derived' order by created_at,id for update skip locked limit 1`,
      )
    ).rows[0];
    if (!impact) return false;
    const rows = (
      await tx.execute(sql`select id from valo_rule_releases where id>${impact.cursor_id ?? "00000000-0000-0000-0000-000000000000"}::uuid and
   (rule->>'requirementVersionId'=${String(impact.target_id)} or (rule->>'requirementVersionId'=${String(impact.target_key)} and version=${Number(impact.target_version)}))
   order by id limit 50`)
    ).rows;
    for (const row of rows) {
      if (
        (
          await tx.execute(
            sql`select id from valo_source_impacts where target_kind='rule' and target_id=${String(row.id)}::uuid limit 1`,
          )
        ).rows.length
      )
        continue;
      await recordSourceImpact(tx, {
        kind: "rule",
        id: String(row.id),
        reason: String(impact.reason),
        actor: String(impact.actor_id),
        action: impact.action as "hold" | "withdraw",
        sourceId: impact.source_id ? String(impact.source_id) : undefined,
        oldSnapshotId: impact.old_snapshot_id ? String(impact.old_snapshot_id) : null,
        newSnapshotId: impact.new_snapshot_id ? String(impact.new_snapshot_id) : null,
        dedupe: `derived:${String(impact.id)}:${String(row.id)}`,
      });
    }
    await tx.execute(
      sql`update valo_source_impacts set phase=${rows.length < 50 ? "tasks" : "derived"},cursor_id=${rows.length === 50 ? String(rows.at(-1)!.id) : null}::uuid where id=${String(impact.id)}::uuid`,
    );
    return true;
  });
}
const notice =
  "This saved item used a source or version that is now held or withdrawn. Review the current guidance before acting. Your original assessment and document files are unchanged; source-linked reminders are paused.";
type Impact = {
  id: string;
  target_kind: SourceTarget;
  target_id: string;
  target_key: string;
  target_version: number;
  phase: string;
  cursor_id: string | null;
};
/** One transaction handles at most 200 records in one phase. The cursor and
 * effects commit together. A failed/abandoned transaction resumes safely. */
export async function processSourceImpact() {
  if (await processDerivedImpact()) return true;
  return db.transaction(async (tx) => {
    const impact = (
      await tx.execute(sql`select * from valo_source_impacts where phase not in ('complete','derived')
   order by created_at,id for update skip locked limit 1`)
    ).rows[0] as Impact | undefined;
    if (!impact) return false;
    const cursor = impact.cursor_id ?? "00000000-0000-0000-0000-000000000000";
    let rows: { id: string; workspace_id: string }[] = [];
    if (impact.phase === "tasks" && impact.target_kind === "rule")
      rows = (
        await tx.execute(sql`select id,workspace_id from valo_tasks
   where rule_id=${impact.target_key} and rule_version=${impact.target_version} and id>${cursor}::uuid order by id limit 200`)
      ).rows as typeof rows;
    if (impact.phase === "assessments")
      rows = (
        await tx.execute(sql`select id,workspace_id from valo_assessments a
   where id>${cursor}::uuid and exists(select 1 from jsonb_array_elements(a.result->'items') i where
    (${impact.target_kind}='rule' and i->>'ruleId'=${impact.target_key} and i->>'ruleVersion'=${String(impact.target_version)}) or
    (${impact.target_kind}='content' and (i->>'requirementVersionId'=${impact.target_id} or (i->>'requirementVersionId'=${impact.target_key} and i->>'ruleVersion'=${String(impact.target_version)})))) order by id limit 200`)
      ).rows as typeof rows;
    if (impact.phase === "documents" && impact.target_kind === "content")
      rows = (
        await tx.execute(sql`select id,workspace_id from valo_documents
   where template_version_id=${impact.target_id}::uuid and id>${cursor}::uuid order by id limit 200`)
      ).rows as typeof rows;
    if (impact.phase === "purchases" && impact.target_kind === "content")
      rows = (
        await tx.execute(sql`select id,workspace_id from valo_orders
   where line->>'contentVersionId'=${impact.target_id} and id>${cursor}::uuid order by id limit 200`)
      ).rows as typeof rows;
    // Serialize notice admission with privacy quarantine, in stable tenant order.
    // A completed erasure must not be repopulated by a later correction batch.
    const workspaces = [...new Set(rows.map((r) => r.workspace_id))].sort();
    for (const workspaceId of workspaces)
      await tx.execute(sql`select id from valo_workspaces where id=${workspaceId}::uuid for share`);
    for (const row of rows) {
      if (
        (
          await tx.execute(
            sql`select id from valo_privacy_tombstones where workspace_id=${row.workspace_id}::uuid limit 1`,
          )
        ).rows.length
      )
        continue;
      if (impact.phase === "tasks") {
        await tx.execute(sql`update valo_reminder_outbox set status='cancelled',reason='SOURCE_CORRECTION_REQUIRED',lease_token=null,lease_until=null,next_attempt_at=null
     where task_id=${row.id}::uuid and workspace_id=${row.workspace_id}::uuid and status not in ('sent','cancelled')`);
        await tx.execute(
          sql`update valo_tasks set needs_review=true,updated_at=now() where id=${row.id}::uuid and workspace_id=${row.workspace_id}::uuid`,
        );
      }
      await tx.execute(sql`insert into valo_correction_notices(id,workspace_id,impact_id,entity_kind,entity_id,message)
    values(${randomUUID()}::uuid,${row.workspace_id}::uuid,${impact.id}::uuid,${impact.phase},${row.id}::uuid,${notice}) on conflict do nothing`);
    }
    const phases = ["tasks", "assessments", "documents", "purchases", "complete"];
    const next = rows.length === 200 ? impact.phase : phases[phases.indexOf(impact.phase) + 1]!;
    await tx.execute(sql`update valo_source_impacts set phase=${next},cursor_id=${rows.length === 200 ? rows.at(-1)!.id : null}::uuid,
   completed_at=case when ${next}='complete' then now() else null end where id=${impact.id}::uuid`);
    return true;
  });
}
/** Daily source availability and monthly/quarterly substantive reviews are
 * separate. Neither a successful fetch nor a staff click renews review dates. */
export async function queueExpiredSourceReviews(now = new Date()) {
  return db.transaction(async (tx) => {
    await lockSourceState(tx, true);
    const stale = await tx.execute(
      sql`select source_id from valo_source_watches where checked_at is null or checked_at<=${new Date(+now - 86400000)} or failure_code is not null order by source_id limit 100`,
    );
    for (const row of stale.rows)
      await impactSourceDependants(
        tx,
        String(row.source_id),
        "Daily source check is overdue or unavailable.",
        `stale:${String(row.source_id)}:${now.toISOString().slice(0, 10)}`,
        null,
      );
    const versions =
      await tx.execute(sql`select 'content' as kind,id from valo_content_versions c where status='published' and
   (review_by<=${now} or (bundle->'candidate'->>'sourceCheckDate')::timestamptz+
    case when bundle->'candidate'->>'risk'='general' then interval '90 days' else interval '30 days' end<=${now})
   and not exists(select 1 from valo_source_impacts i where i.target_kind='content' and i.target_id=c.id)
   union all select 'rule' as kind,id from valo_rule_releases r where status='published' and
    ((rule->>'reviewBy')::timestamptz<=${now} or (rule->>'sourceCheckedAt')::timestamptz+case when publication_bundle->'candidate'->>'risk'='general' then interval '90 days' else interval '30 days' end<=${now})
   and not exists(select 1 from valo_source_impacts i where i.target_kind='rule' and i.target_id=r.id) limit 50`);
    for (const row of versions.rows)
      await recordSourceImpact(tx, {
        kind: row.kind as SourceTarget,
        id: String(row.id),
        reason: "The scheduled substantive source review is due.",
        actor: "service:source-monitor",
        dedupe: `review-due:${String(row.kind)}:${String(row.id)}`,
      });
  });
}
