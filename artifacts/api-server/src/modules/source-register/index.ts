/**
 * The source register (docs/architecture/source-register.md, slice 1, ADM-003): the official sources as
 * staff keep them, each a series of versions that are never changed or removed. A Content editor files
 * the regulatory sources kept in the repository, with what its claim maps and amendment records say of
 * them, and records each correction, retirement or return as a new version with why. The fetcher still
 * reads only the addresses in code. Development only, as the source controls are.
 */
import { desc, eq, sql } from "drizzle-orm";
import { allSourceLeads } from "@workspace/valo-core";
import { STATES } from "@workspace/valo-core/checker-questionnaire";
import { ReviseSourceRegisterEntryBody } from "@workspace/api-zod";
import type { db } from "@workspace/db";
import { ValoProblem } from "../../platform/valo-problem";
import { assertDevelopmentRuntime } from "../../platform/valo-development-runtime";
import { repositorySourceFacts } from "../publication";
import {
  holdRetiredSourceDependants,
  lockSourceState,
  requireSourceStaff,
  type SourceStaffActor,
} from "../sources";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Where a source applies: Nigeria as a whole, or one of the states the requirements check lists. */
export const sourceJurisdictions = ["Nigeria", ...STATES] as const;
/** The regulatory leads kept in the repository, which the register files. The provider's terms and the
 * quality documents are not sources of law, and stay in code only. */
export const repositorySources = () => allSourceLeads.filter((lead) => lead.category === "regulatory");
const filedReason = "Filed from the official sources kept in the repository.";

/** A day the calendar has, as YYYY-MM-DD: 30 February is refused, where Date.parse would move it to March. */
function realDay(day: string) {
  const parsed = new Date(day + "T00:00:00Z");
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day;
}
function pgCode(error: unknown) {
  const e = error as { cause?: { code?: string }; code?: string };
  return (e.cause ?? e).code;
}
async function asEditor<T>(
  actor: SourceStaffActor,
  work: (tx: Tx) => Promise<T>,
  options: { sourceState?: boolean } = {},
) {
  assertDevelopmentRuntime();
  const { db } = await import("@workspace/db");
  try {
    return await db.transaction(async (tx) => {
      // A change that can stop a watch takes the source-state lock first, as the daily check and the
      // source controls do, so that it and they wait on the same lock before any watch row.
      if (options.sourceState) await lockSourceState(tx, true);
      await requireSourceStaff(tx, actor, "content");
      return work(tx);
    });
  } catch (error) {
    // A database the register migration has not reached has no register.
    if (pgCode(error) === "42P01")
      throw new ValoProblem(503, "Apply the source register migration before using the register.");
    throw error;
  }
}

/** Every version of every entry, newest first, with each entry's watch as the daily check left it. */
async function read(tx: Tx) {
  const { valoSourceRegister: r } = await import("@workspace/db");
  const versions = await tx.select().from(r).orderBy(r.sourceId, desc(r.version));
  const watches = (
    await tx.execute(
      sql`select source_id, checked_at, failure_code, next_check_at, stopped_at from valo_source_watches`,
    )
  ).rows as {
    source_id: string;
    checked_at: Date | null;
    failure_code: string | null;
    next_check_at: Date | null;
    stopped_at: Date | null;
  }[];
  // The versions bound to each source that are not held yet: what retiring it would hold.
  const resting = new Map(
    (
      await tx.execute(sql`select b.source_id, count(distinct (b.target_kind, b.target_id))::int as n
        from valo_source_release_bindings b
        where not exists (select 1 from valo_source_impacts i where i.target_kind = b.target_kind and i.target_id = b.target_id)
        group by b.source_id`)
    ).rows.map((row) => [String(row.source_id), Number(row.n)]),
  );
  const iso = (value: Date | string | null) => (value === null ? null : new Date(value).toISOString());
  const entries = new Map<string, (typeof versions)[number][]>();
  for (const version of versions)
    entries.set(version.sourceId, [...(entries.get(version.sourceId) ?? []), version]);
  const filed = new Set(entries.keys());
  return {
    entries: [...entries.values()].map(([latest, ...earlier]) => {
      const watch = watches.find((row) => row.source_id === latest!.sourceId);
      const view = (version: (typeof versions)[number]) => ({
        version: version.version,
        title: version.title,
        authority: version.authority,
        jurisdiction: version.jurisdiction,
        instrument: version.instrument,
        versionInForce: version.versionInForce,
        effectiveFrom: version.effectiveFrom,
        status: version.status,
        reason: version.reason,
        createdBy: version.createdBy,
        createdAt: version.createdAt.toISOString(),
      });
      return {
        sourceId: latest!.sourceId,
        url: latest!.url,
        ...view(latest!),
        earlier: earlier.map(view),
        restingVersions: resting.get(latest!.sourceId) ?? 0,
        watch: watch
          ? {
              checkedAt: iso(watch.checked_at),
              failureCode: watch.failure_code,
              nextCheckAt: iso(watch.next_check_at),
              stoppedAt: iso(watch.stopped_at),
            }
          : null,
      };
    }),
    unfiled: repositorySources().filter((lead) => !filed.has(lead.id)).length,
    jurisdictions: [...sourceJurisdictions],
  };
}

export function listSourceRegister(actor: SourceStaffActor) {
  return asEditor(actor, read);
}

/** Files each regulatory lead kept in the repository that the register does not hold yet, as its first
 * version. Filing twice files nothing more. */
export function fileRepositorySources(actor: SourceStaffActor) {
  return asEditor(actor, async (tx) => {
    const { valoSourceRegister: r } = await import("@workspace/db");
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('valo-source-register-filing', 813))`);
    const filed = new Set((await tx.select({ sourceId: r.sourceId }).from(r)).map((row) => row.sourceId));
    const missing = repositorySources().filter((lead) => !filed.has(lead.id));
    if (missing.length)
      await tx.insert(r).values(
        missing.map((lead) => ({
          sourceId: lead.id,
          version: 1,
          title: lead.title,
          url: lead.url,
          ...repositorySourceFacts(lead.id, lead.url),
          jurisdiction: "Nigeria",
          versionInForce: null,
          status: "active" as const,
          reason: filedReason,
          createdBy: actor.identityId,
        })),
      );
    return read(tx);
  });
}

/** Records the next version of an entry: its corrected fields, or its retirement or return, with why.
 * The title and address stay its own. */
export function reviseSourceEntry(actor: SourceStaffActor, sourceId: string, value: unknown) {
  const input = ReviseSourceRegisterEntryBody.strict().parse(value);
  const text = (field: string | null) => (field?.trim() ? field.trim() : null);
  const authority = text(input.authority),
    versionInForce = text(input.versionInForce),
    reason = input.reason.trim();
  if (!(sourceJurisdictions as readonly string[]).includes(input.jurisdiction))
    throw new ValoProblem(422, "Choose Nigeria or one of the listed states.");
  if (input.instrument === "official_page" && input.effectiveFrom !== null)
    throw new ValoProblem(
      422,
      "An official page says what it says when it is read: it has no day it took effect.",
    );
  if (input.effectiveFrom !== null && !realDay(input.effectiveFrom))
    throw new ValoProblem(422, "Enter the day the version took effect as a real date.");
  if (reason.length < 20 || reason.length > 1000)
    throw new ValoProblem(422, "Say why, in 20 to 1,000 characters.");
  return asEditor(
    actor,
    async (tx) => {
      const { valoSourceRegister: r } = await import("@workspace/db");
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${sourceId}, 813))`);
      const [latest] = await tx
        .select()
        .from(r)
        .where(eq(r.sourceId, sourceId))
        .orderBy(desc(r.version))
        .limit(1);
      if (!latest) throw new ValoProblem(404, "This source is not in the register.");
      if (latest.version !== input.baseVersion)
        throw new ValoProblem(409, "This source changed. Reopen the register before correcting it.");
      const next = {
        authority,
        jurisdiction: input.jurisdiction,
        instrument: input.instrument,
        versionInForce,
        effectiveFrom: input.effectiveFrom,
        status: input.status,
      };
      if (
        (Object.keys(next) as (keyof typeof next)[]).every((field) => (latest[field] ?? null) === next[field])
      )
        throw new ValoProblem(422, "Nothing changed. Correct a field, or retire or bring back the source.");
      await tx.insert(r).values({
        sourceId,
        version: latest.version + 1,
        title: latest.title,
        url: latest.url,
        ...next,
        reason,
        createdBy: actor.identityId,
      });
      // The database stops a retired source's watch and restarts it when the source comes back; what
      // rested on a retired source is held now, before anything can go on resting on it.
      if (next.status === "retired" && latest.status !== "retired")
        await holdRetiredSourceDependants(tx, sourceId, latest.version + 1);
      return read(tx);
    },
    { sourceState: true },
  );
}
