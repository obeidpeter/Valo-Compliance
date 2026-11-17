import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { publicationSchema } from "@workspace/valo-core";
import { ValoProblem } from "./valo-problem";
export type SourceTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type SourceReader = Pick<SourceTx, "execute">;
export const sourceTime = (value: unknown) =>
  value instanceof Date ? value.getTime() : Date.parse(String(value));
export type SourceTarget = "content" | "rule";
/** All final source-dependent actions share this lock; a committed hold wins
 * against a later dispatch. Already-started external work cannot be recalled. */
export async function lockSourceState(tx: SourceReader, write = false) {
  await tx.execute(
    write ? sql`select pg_advisory_xact_lock(7502601)` : sql`select pg_advisory_xact_lock_shared(7502601)`,
  );
}
export async function sourceTargetAllowed(
  tx: SourceReader,
  kind: SourceTarget,
  id: string,
  raw: unknown,
  now = new Date(),
) {
  const parsed = publicationSchema.safeParse(raw);
  if (!parsed.success) return false;
  const b = parsed.data,
    checked = Date.parse(b.candidate.sourceCheckDate);
  const cadence = b.candidate.risk === "general" ? 90 : 30;
  if (!Number.isFinite(checked) || checked > +now || checked + cadence * 86400000 <= +now) return false;
  const held =
    await tx.execute(sql`select id from valo_source_impacts where (target_kind=${kind} and target_id=${id}::uuid) or
  (${kind}='rule' and target_kind='content' and (target_id::text=${b.candidate.id} or (target_key=${b.candidate.id} and target_version=${b.candidate.version}))) limit 1`);
  if (held.rows.length) return false;
  if (!b.sources.length) return b.candidate.evidenceMode === "original_operational";
  const result =
    await tx.execute(sql`select b.source_id,b.bundle_source_id,b.source_hash,b.raw_hash,w.url,w.last_raw_hash,w.checked_at,w.failure_code
   from valo_source_release_bindings b join valo_source_watches w using(source_id)
   where b.target_kind=${kind} and b.target_id=${id}::uuid`);
  if (result.rows.length !== b.sources.length) return false;
  return b.sources.every((source) =>
    result.rows.some(
      (row) =>
        row.bundle_source_id === source.id &&
        row.source_hash === source.hash &&
        row.url === source.url &&
        row.raw_hash === row.last_raw_hash &&
        !row.failure_code &&
        row.checked_at &&
        sourceTime(row.checked_at) <= +now &&
        sourceTime(row.checked_at) + 86400000 > +now,
    ),
  );
}
/** Pause is independent of budget/merchant/release approval; resume never grants any of them. */
export async function assertSafetyActive(tx: SourceReader, key: "ai" | "checkout") {
  await lockSourceState(tx);
  const result = await tx.execute(
    sql`select key from valo_safety_switches where key=${key === "ai" ? "all_ai" : "checkout"} and enabled=false`,
  );
  if (result.rows.length)
    throw new ValoProblem(
      503,
      `${key === "ai" ? "AI assistance" : "Checkout"} is temporarily paused. Existing workspace records remain available.`,
    );
}
export async function withSafetyDispatch<T>(key: "ai" | "checkout", run: () => Promise<T>) {
  return db.transaction(async (tx) => {
    await assertSafetyActive(tx, key);
    return run();
  });
}
