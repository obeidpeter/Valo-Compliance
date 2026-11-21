import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { referenceFor } from "./source-fetch";
import { lockSourceState, sourceTime, type SourceTx } from "./valo-source-state";
import {
  impactSourceDependants,
  processSourceDependencyJob,
  processSourceImpact,
  queueExpiredSourceReviews,
} from "./valo-source-corrections";
import { assertDevelopmentRuntime } from "../../platform/valo-development-runtime";
export async function registerSourceWatch(tx: SourceTx, id: string) {
  const source = referenceFor(id); // No request URL or newly discovered domain is fetched.
  await tx.execute(
    sql`insert into valo_source_watches(source_id,url,risk) values(${source.id},${source.url},'high') on conflict(source_id) do nothing`,
  );
}
export async function scheduleSourceChecks(now = new Date()) {
  // The database client loads when a check runs, not with every reader of the source code.
  const { db } = await import("@workspace/db");
  return db.transaction(async (tx) => {
    const sources = await tx.execute(
      sql`select source_id from valo_source_watches where next_check_at<=${now} order by next_check_at,source_id for update skip locked limit 10`,
    );
    for (const source of sources.rows) {
      await tx.execute(
        sql`insert into valo_source_check_jobs(id,source_id,day,status) values(${randomUUID()}::uuid,${String(source.source_id)},${now.toISOString().slice(0, 10)}::date,'pending') on conflict(source_id,day) do nothing`,
      );
      await tx.execute(
        sql`update valo_source_watches set next_check_at=${new Date(+now + 86400000)} where source_id=${String(source.source_id)}`,
      );
    }
  });
}
type Claim = { id: string; source_id: string; token: string };
type Capture = {
  raw_checksum?: unknown;
  text_checksum?: unknown;
  mime?: unknown;
  extraction_version?: unknown;
};
const isPage = (capture: Capture) => capture.mime === "text/html" || capture.mime === "application/xhtml+xml";
/**
 * What a successful new capture means for a watched source.
 *
 * A file is compared by its bytes: a different file is a different text until someone has read it.
 * A web page is compared by the words read from it, because a page can return different bytes on
 * every request (an email-protection or anti-bot code) while saying the same words. A page counts
 * as saying the same words only when the watch's current capture and the new one are both pages,
 * were read by the same version of the extractor, and the words read are identical.
 */
export function captureOutcome(
  lastRawHash: unknown,
  current: Capture | undefined,
  next: Capture,
): "first" | "same_file" | "same_words" | "changed" {
  if (!lastRawHash) return "first";
  if (!next.raw_checksum || !next.text_checksum) return "changed";
  if (lastRawHash === next.raw_checksum) return "same_file";
  return current &&
    current.raw_checksum === lastRawHash &&
    isPage(current) &&
    isPage(next) &&
    current.text_checksum === next.text_checksum &&
    !!next.extraction_version &&
    current.extraction_version === next.extraction_version
    ? "same_words"
    : "changed";
}
export async function claimSourceCheck(now = new Date()): Promise<Claim | null> {
  const { db } = await import("@workspace/db");
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(7502602)`);
    if (
      (
        await tx.execute(
          sql`select id from valo_source_check_jobs where status='running' and lease_until>${now} limit 1`,
        )
      ).rows.length
    )
      return null;
    const row = (
      await tx.execute(sql`select id,source_id,attempts from valo_source_check_jobs
   where status='pending' or (status='running' and lease_until<=${now}) order by created_at,id for update skip locked limit 1`)
    ).rows[0];
    if (!row) return null;
    if (Number(row.attempts) >= 3) {
      await tx.execute(
        sql`update valo_source_check_jobs set status='complete',result='SOURCE_ATTEMPT_LIMIT',lease_token=null,lease_until=null where id=${String(row.id)}::uuid`,
      );
      await tx.execute(
        sql`update valo_source_watches set failure_code='SOURCE_ATTEMPT_LIMIT' where source_id=${String(row.source_id)}`,
      );
      return null;
    }
    const token = randomUUID();
    // Source fetch/extraction/storage has its own finite transport limits. The
    // five-minute lease bounds abandoned jobs; late results cannot win a new lease.
    await tx.execute(
      sql`update valo_source_check_jobs set status='running',attempts=attempts+1,lease_token=${token}::uuid,lease_until=${new Date(+now + 300000)} where id=${String(row.id)}::uuid`,
    );
    return { id: String(row.id), source_id: String(row.source_id), token };
  });
}
export async function completeSourceCheck(claim: Claim, snapshotId: string | null, now = new Date()) {
  const { db } = await import("@workspace/db");
  return db.transaction((tx) => completeSourceCheckIn(tx, claim, snapshotId, now));
}
/** The completion itself, on the caller's transaction. Only `completeSourceCheck` and tests call it. */
export async function completeSourceCheckIn(
  tx: SourceTx,
  claim: Claim,
  snapshotId: string | null,
  now = new Date(),
) {
  await lockSourceState(tx, true);
  const job = (
    await tx.execute(sql`select * from valo_source_check_jobs where id=${claim.id}::uuid for update`)
  ).rows[0];
  if (
    !job ||
    job.status !== "running" ||
    job.lease_token !== claim.token ||
    !job.lease_until ||
    sourceTime(job.lease_until) <= +now
  )
    return false;
  const prior = (
    await tx.execute(sql`select * from valo_source_watches where source_id=${claim.source_id} for update`)
  ).rows[0]!;
  const snapshot = snapshotId
    ? (
        await tx.execute(
          sql`select * from valo_source_snapshots where id=${snapshotId}::uuid and source_id=${claim.source_id}`,
        )
      ).rows[0]
    : null;
  const okay =
    !!snapshot &&
    snapshot.status === "retrieved_unreviewed" &&
    snapshot.raw_checksum &&
    snapshot.text_checksum &&
    snapshot.raw_object_key &&
    snapshot.text_object_key;
  const failure = okay ? null : String(snapshot?.failure_code ?? "SOURCE_CAPTURE_UNCONFIRMED");
  const current =
    okay && prior.last_snapshot_id
      ? (
          await tx.execute(
            sql`select raw_checksum,text_checksum,mime,extraction_version from valo_source_snapshots
   where id=${String(prior.last_snapshot_id)}::uuid and source_id=${claim.source_id}`,
          )
        ).rows[0]
      : undefined;
  const outcome = okay ? captureOutcome(prior.last_raw_hash, current, snapshot!) : null;
  const changed = outcome === "changed";
  // A page that says the same words under different bytes: the watch goes on naming the capture
  // it already holds, so whatever is bound to that capture stays bound. Only the time of the
  // check moves. The new capture is kept, and this job's record names it.
  const moveToNew = Boolean(okay) && outcome !== "same_words";
  await tx.execute(sql`update valo_source_check_jobs set status='complete',snapshot_id=${snapshot ? String(snapshot.id) : null}::uuid,
   result=${failure ?? (changed ? "SOURCE_CHANGED" : outcome === "same_words" ? "SOURCE_SAME_WORDS" : "SOURCE_CAPTURED")},lease_token=null,lease_until=null where id=${claim.id}::uuid`);
  await tx.execute(sql`update valo_source_watches set checked_at=${now},failure_code=${failure},
   last_snapshot_id=case when ${moveToNew} then ${snapshot ? String(snapshot.id) : null}::uuid else last_snapshot_id end,
   last_raw_hash=case when ${moveToNew} then ${snapshot ? String(snapshot.raw_checksum) : null} else last_raw_hash end where source_id=${claim.source_id}`);
  if (!okay || changed)
    await impactSourceDependants(
      tx,
      claim.source_id,
      okay
        ? "The official source bytes changed; claims require fresh review."
        : "The official source could not be verified by the daily check.",
      `check:${claim.id}`,
      snapshot ? String(snapshot.id) : null,
    );
  return true;
}
let captureInFlight: Promise<string> | null = null;
export async function reconcileSourceMonitoring() {
  assertDevelopmentRuntime();
  await scheduleSourceChecks();
  // One bounded source fetch per wake-up. No provider review or external message
  // is performed; required review work remains explicitly held for authorization.
  const claim = captureInFlight ? null : await claimSourceCheck();
  if (claim) {
    let id: string | null = null,
      timer: ReturnType<typeof setTimeout> | undefined;
    const capture = (async () =>
      (await (await import("./source-capture")).captureReference(claim.source_id)).id)();
    captureInFlight = capture;
    // The race below handles the capture's outcome; this chain only clears the in-flight marker.
    void capture
      .finally(() => {
        if (captureInFlight === capture) captureInFlight = null;
      })
      .catch(() => {});
    try {
      id = await Promise.race([
        capture,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(Error("SOURCE_CAPTURE_TIMEOUT")), 180000);
        }),
      ]);
    } catch {
      /* Unconfirmed capture is held; a late artifact cannot complete this job. */
    } finally {
      if (timer) clearTimeout(timer);
    }
    await completeSourceCheck(claim, id);
  }
  await queueExpiredSourceReviews();
  for (let n = 0; n < 8; n++) {
    const dependencies = await processSourceDependencyJob(),
      impact = await processSourceImpact();
    if (!dependencies && !impact) break;
  }
}
