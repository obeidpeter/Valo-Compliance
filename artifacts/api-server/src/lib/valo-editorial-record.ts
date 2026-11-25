import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { evaluatePublication, publicationSchema } from "@workspace/valo-core";
import { ValoProblem } from "../platform/valo-problem";
import { requireSourceStaff, type SourceStaffActor } from "../modules/sources";
import { sourceTime } from "../modules/sources";

type Checks = { result: "pass" | "fail" | "not_run" }[];
const counts = (checks: Checks) => ({
  passed: checks.filter((c) => c.result === "pass").length,
  failed: checks.filter((c) => c.result === "fail").length,
  notRun: checks.filter((c) => c.result === "not_run").length,
});
const date = (value: unknown) => (value ? new Date(sourceTime(value)).toISOString() : null);
// A finding is reviewer prose; the screen shows enough of each to read why a version is held.
const finding = (text: string) => (text.length > 600 ? `${text.slice(0, 600)}…` : text);

/**
 * ADM-002: one content or rule version's publication record for content staff. It shows what the
 * stored bundle passes or holds on right now, the drafting and review runs with their models, run
 * IDs, verdicts and findings, the check counts, any safety holds and the publication audit. It
 * reads only global editorial tables, needs an active content role and fresh MFA, records the
 * access, and approves, publishes or holds nothing. The publisher still rechecks every gate
 * against the retained evidence before a release.
 */
export async function editorialRecord(
  actor: SourceStaffActor,
  kind: "content" | "rule",
  id: string,
  now = new Date(),
) {
  return db.transaction(async (tx) => {
    const assignment = await requireSourceStaff(tx, actor, "content");
    await tx.execute(
      sql`insert into valo_staff_access_audit(id,assignment_id,actor_id,area,object,reason) values(${randomUUID()}::uuid,${assignment}::uuid,${actor.identityId},'content',${`${kind}_version:${id}`},${`Read the publication record of ${kind} version ${id}`})`,
    );
    const [row] = (
      kind === "content"
        ? await tx.execute(sql`select id,template_id as key,version,status,bundle,review_by,published_at,withdrawn_reason
            from valo_content_versions where id=${id}::uuid`)
        : await tx.execute(sql`select id,rule_id as key,version,status,publication_bundle as bundle,null as review_by,published_at,null as withdrawn_reason
            from valo_rule_releases where id=${id}::uuid`)
    ).rows;
    if (!row) throw new ValoProblem(404, "No such version.");
    const audit =
      kind === "content"
        ? (
            await tx.execute(
              sql`select action,actor,reason,created_at from valo_publication_audit where version_id=${id}::uuid order by created_at,id limit 100`,
            )
          ).rows
        : [];
    const holds = (
      await tx.execute(
        sql`select action,reason,phase,created_at,completed_at from valo_source_impacts where target_kind=${kind} and target_id=${id}::uuid order by created_at,id limit 100`,
      )
    ).rows;
    const check = evaluatePublication(row.bundle, now);
    const parsed = publicationSchema.safeParse(row.bundle);
    const bundle = parsed.success ? parsed.data : null;
    const run = (r: { runId: string; model: string; promptVersion: string }) => ({
      runId: r.runId,
      model: r.model,
      promptVersion: r.promptVersion,
    });
    return {
      kind,
      id: String(row.id),
      key: String(row.key),
      version: Number(row.version),
      status: String(row.status),
      reviewBy: date(row.review_by),
      publishedAt: date(row.published_at),
      withdrawnReason: row.withdrawn_reason ? String(row.withdrawn_reason) : null,
      candidateHash: bundle?.candidate.hash ?? null,
      manifestStatus: bundle?.manifest.status ?? null,
      check: { checkedAt: now.toISOString(), decision: check.decision, reasons: check.reasons },
      draftRun: bundle ? run(bundle.draftRun) : null,
      reviews: (bundle?.reviews ?? []).map((r) => ({
        ...run(r),
        role: r.role,
        verdict: r.verdict,
        findings: r.findings.slice(0, 20).map(finding),
        receivedOtherVerdict: r.receivedOtherVerdict,
      })),
      mechanicalChecks: counts(bundle?.mechanicalChecks ?? []),
      enhancedChecks: counts(bundle?.enhancedChecks ?? []),
      audit: audit.map((a) => ({
        action: String(a.action),
        actor: String(a.actor),
        reason: String(a.reason),
        at: date(a.created_at)!,
      })),
      safetyHolds: holds.map((h) => ({
        action: String(h.action),
        reason: String(h.reason),
        phase: String(h.phase),
        createdAt: date(h.created_at)!,
        completedAt: date(h.completed_at),
      })),
      notice:
        "This record approves, publishes and holds nothing. The check reads the stored bundle now; the publisher rechecks every gate against the retained evidence before any release. AI reviews are not professional legal, tax or regulatory review.",
    };
  });
}
