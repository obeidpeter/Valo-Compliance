import { readFile } from "node:fs/promises";
import { z } from "zod";

/**
 * The release record (OPS-005 accepts "the release identifies commit, migration, content/rule
 * versions and known issues"). It names the release commit, the migrations the release ships and
 * those the database has applied, every content and rule version with its status, and the known
 * issues as committed at the release. It only reads.
 */
type Queryable = { query: (text: string) => Promise<{ rows: Record<string, unknown>[] }> };

const journalSchema = z.object({
  entries: z
    .array(z.object({ idx: z.number().int(), when: z.number().int(), tag: z.string().min(1) }))
    .min(1),
});
export const knownIssuesSchema = z
  .object({
    description: z.string().min(1),
    issues: z
      .array(
        z
          .object({
            id: z.string().regex(/^KI-\d{3}$/),
            summary: z.string().min(20).max(600),
            requirements: z.array(z.string().regex(/^[A-Z]{2,4}-\d{3}$/)),
          })
          .strict(),
      )
      .min(1),
  })
  .strict()
  .refine((list) => new Set(list.issues.map((issue) => issue.id)).size === list.issues.length, {
    message: "Each known issue needs its own ID",
  });

const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : null);

export async function buildReleaseRecord(
  db: Queryable,
  input: { releaseSha: string; journalPath: string; knownIssuesPath: string; now?: Date },
) {
  if (!/^[a-f0-9]{40}$/.test(input.releaseSha)) throw Error("RELEASE_SHA_REQUIRED");
  const journal = journalSchema.parse(JSON.parse(await readFile(input.journalPath, "utf8")));
  const known = knownIssuesSchema.parse(JSON.parse(await readFile(input.knownIssuesPath, "utf8")));
  const shipped = journal.entries.at(-1)!;
  // The migrator's ledger records each applied migration under the journal's timestamp for it.
  const [ledger] = (
    await db.query("select to_regclass('drizzle.__drizzle_migrations') is not null as present")
  ).rows;
  let applied: { count: number; latest: string | null; matchesShipped: boolean } | { ledger: "absent" } = {
    ledger: "absent",
  };
  if (ledger?.present === true) {
    const [row] = (
      await db.query(
        "select count(*)::int as count, max(created_at)::text as latest from drizzle.__drizzle_migrations",
      )
    ).rows;
    const count = Number(row?.count ?? 0),
      latestWhen = row?.latest == null ? null : Number(row.latest);
    applied = {
      count,
      latest: journal.entries.find((entry) => entry.when === latestWhen)?.tag ?? null,
      matchesShipped: count === journal.entries.length && latestWhen === shipped.when,
    };
  }
  const content = (
    await db.query(
      "select id, template_id, version, status, candidate_hash, published_at from valo_content_versions order by template_id, version",
    )
  ).rows.map((row) => ({
    versionId: String(row.id),
    templateId: String(row.template_id),
    version: Number(row.version),
    status: String(row.status),
    candidateHash: String(row.candidate_hash),
    publishedAt: iso(row.published_at),
  }));
  const rules = (
    await db.query(
      "select id, rule_id, version, status, manifest_hash, published_at from valo_rule_releases order by rule_id, version",
    )
  ).rows.map((row) => ({
    releaseId: String(row.id),
    ruleId: String(row.rule_id),
    version: Number(row.version),
    status: String(row.status),
    manifestHash: String(row.manifest_hash),
    publishedAt: iso(row.published_at),
  }));
  return {
    kind: "valo-release-record-v1" as const,
    releaseSha: input.releaseSha,
    recordedAt: (input.now ?? new Date()).toISOString(),
    migrations: { shipped: { count: journal.entries.length, latest: shipped.tag }, applied },
    content,
    rules,
    knownIssues: known.issues,
  };
}
