import { sql } from "drizzle-orm";
import { assertDevelopmentRuntime } from "../../platform/valo-development-runtime";
import { checkManualRegulatorySources } from "./regulatory-evidence";

/** A guide is due a day after its newest check, or an hour after it when that check held it. */
export const GUIDANCE_CHECK_DUE = { afterPass: "1 day", afterHold: "1 hour" } as const;
/** The worker's queue lets a job run for five minutes; a check gets four of them. */
export const GUIDANCE_CHECK_BOUND_MS = 240_000;

/**
 * EDP-011, CMP-007 (docs/architecture/guidance-currency.md): the published regulatory guides whose
 * newest source check is due, the one due longest first. A guide is published when a version of it
 * is, on a check of its own candidate; one that is only drafted, withdrawn or replaced is never due.
 */
export async function dueGuidance(now = new Date()): Promise<string[]> {
  const { db } = await import("@workspace/db");
  const { rows } = await db.execute<{ candidate_id: string }>(sql`
    with published as (
      select distinct signed.candidate_id
      from valo_manual_library entry
      join valo_manual_regulatory_checks signed on signed.id = entry.regulatory_check_id
      where entry.state = 'published' and entry.kind = 'regulatory_article'
    ), newest as (
      select distinct on (k.candidate_id) k.candidate_id, k.checked_at, cardinality(k.holds) > 0 as held
      from valo_manual_regulatory_checks k
      join published p on p.candidate_id = k.candidate_id
      order by k.candidate_id, k.checked_at desc, k.id desc
    )
    select candidate_id from newest
    where checked_at <= ${now.toISOString()}::timestamptz - case when held
      then ${GUIDANCE_CHECK_DUE.afterHold}::interval else ${GUIDANCE_CHECK_DUE.afterPass}::interval end
    order by checked_at, candidate_id
    limit 30`);
  return rows.map((row) => row.candidate_id);
}

let inFlight: Promise<unknown> | null = null;

/**
 * The worker's `guidance` task. It checks the guide due, if any, with the owner's own source check,
 * which records its result as a check like any other: a guide whose sources say the same keeps
 * showing, and one whose source changed, could not be read or no longer matches its claims is held
 * until a check passes. The check reads before it writes and holds nothing while it reads. A check
 * that outlasts its bound fails this run; it may still record its result, and no other check starts
 * in this process until it ends.
 */
export async function checkDueGuidance({
  now = new Date(),
  check = checkManualRegulatorySources as (ids: readonly string[]) => Promise<unknown>,
  boundMs = GUIDANCE_CHECK_BOUND_MS,
  due = dueGuidance,
} = {}) {
  assertDevelopmentRuntime();
  if (inFlight) return null;
  const [id] = await due(now);
  if (!id) return null;
  const run = check([id]);
  inFlight = run;
  // The race below reports the check's outcome; this chain only clears the in-flight marker.
  void run
    .finally(() => {
      if (inFlight === run) inFlight = null;
    })
    .catch(() => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      run,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Error("GUIDANCE_CHECK_TIMEOUT")), boundMs);
      }),
    ]);
    return id;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
