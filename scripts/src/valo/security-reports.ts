import { relative, sep } from "node:path";

/**
 * The roles that own a dependency advisory, as the specification names them. The owner names who
 * holds each role, outside this public repository.
 */
export const ADVISORY_OWNERS = ["Engineering lead", "Security lead"] as const;
export type AdvisoryOwner = (typeof ADVISORY_OWNERS)[number];

/**
 * How long an advisory may stay, in days (docs/valo/dependency-advisories.md). Development
 * defaults for the owner to confirm (docs/architecture/small-hardening.md, the owner's points):
 * a reviewed critical or high advisory is reviewed again within 30 days, a moderate one is fixed
 * within 30 days of being recorded, and a low one within 90.
 */
export const ADVISORY_TIME_FRAMES = { reviewed: 30, moderate: 30, low: 90 } as const;

export type ReviewedAdvisory = {
  id: string;
  package: string;
  /**
   * The reviewed dependency subtrees, as path prefixes written as the audit writes paths: the
   * importer, then each package ("lib__api-spec>orval>" is everything orval brings in as a
   * development dependency of lib/api-spec).
   */
  within: readonly string[];
  reason: string;
  reviewedOn: string;
  /** The role that owns the exception. */
  owner: AdvisoryOwner;
  /** The date by which it is reviewed again: at most 30 days after `reviewedOn`. */
  reviewBy: string;
};

/**
 * Dependency advisories the merge gate tolerates after review, each only within the dependency
 * subtrees that were reviewed. Every path to the package, as the audit reports it and as the
 * installed tree shows it (the audit names one path per vulnerable version), must lie within
 * them; any other path, including the same chain reached as a production dependency, still
 * blocks. Each names its owner and the date it is reviewed again, and the gate refuses one past
 * that date. Remove an entry once a fixed release can be adopted.
 */
// None is tolerated today. The one there was, GHSA-fc5q-39xc-vjpf in picomatch (reviewed on
// 17 November 2026), is withdrawn: GitHub's page for it says so from 18 November 2026, and on
// 24 November 2026 `pnpm audit --json` reported no advisory for the lockfile. Should it return,
// the gate blocks it until it is reviewed again.
export const REVIEWED_DEPENDENCY_ADVISORIES: readonly ReviewedAdvisory[] = [];

/** A moderate or low advisory the audit reports, recorded with the role that fixes it and by when. */
export type RecordedAdvisory = {
  id: string;
  package: string;
  severity: "moderate" | "low";
  reason: string;
  recordedOn: string;
  /** The role that fixes it. */
  owner: AdvisoryOwner;
  /** At most 30 days after `recordedOn` for a moderate advisory, 90 for a low one. */
  fixBy: string;
};

/**
 * The moderate and low advisories the audit reports, each until its date. One the audit reports
 * that is not recorded here, at its severity, blocks the merge, as does a record past its date.
 * Remove a record once its advisory is fixed.
 */
// None is recorded: on 26 November 2026 `pnpm audit --json` reported no advisory of any severity.
export const RECORDED_LOWER_ADVISORIES: readonly RecordedAdvisory[] = [];

const DAY = 86_400_000;
const isDate = (value: unknown): value is string =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
  new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);

/**
 * Why a record may not stand on `today` (a UTC date, YYYY-MM-DD), or undefined: it must name an
 * owner, be made on or before today, end within its time frame of being made, and not be past
 * its end.
 */
function recordProblem(made: unknown, ends: unknown, owner: unknown, days: number, today: string) {
  if (!(ADVISORY_OWNERS as readonly unknown[]).includes(owner)) return "ADVISORY_OWNER_MISSING";
  if (!isDate(made) || !isDate(ends)) return "ADVISORY_DATE_INVALID";
  if (made > today) return "ADVISORY_RECORDED_AFTER_TODAY";
  if (ends < made || (Date.parse(`${ends}T00:00:00Z`) - Date.parse(`${made}T00:00:00Z`)) / DAY > days)
    return "ADVISORY_DATE_BEYOND_ITS_TIME_FRAME";
  if (ends < today) return "ADVISORY_PAST_ITS_DATE";
  return undefined;
}

/** Every reviewed exception and lower-advisory record that may not stand on `today`. */
export function advisoryRecordProblems(
  reviewed: readonly ReviewedAdvisory[],
  lower: readonly RecordedAdvisory[],
  today: string,
) {
  if (!isDate(today)) throw Error("ADVISORY_TODAY_INVALID");
  const problems: { id: string; package: string; problem: string }[] = [];
  for (const r of reviewed) {
    const problem = recordProblem(r.reviewedOn, r.reviewBy, r.owner, ADVISORY_TIME_FRAMES.reviewed, today);
    if (problem) problems.push({ id: String(r.id), package: String(r.package), problem });
  }
  for (const r of lower) {
    const days = r.severity === "moderate" || r.severity === "low" ? ADVISORY_TIME_FRAMES[r.severity] : -1;
    const problem =
      days < 0 ? "ADVISORY_SEVERITY_NOT_LOWER" : recordProblem(r.recordedOn, r.fixBy, r.owner, days, today);
    if (problem) problems.push({ id: String(r.id), package: String(r.package), problem });
  }
  return problems;
}

type WhyNode = { dependencies?: Record<string, WhyNode> };
type WhyImporter = WhyNode & {
  path?: string;
  devDependencies?: Record<string, WhyNode>;
  optionalDependencies?: Record<string, WhyNode>;
};

/**
 * Every installed dependency path to `pkg` in `pnpm why <pkg> -r --json` output, written as the
 * audit writes paths ("lib__api-spec>orval>...>pkg"). A chain that starts from a production or
 * optional dependency names that kind after its importer, so it never matches a reviewed
 * development path.
 */
export function installedDependencyPaths(why: unknown, pkg: string, root: string): string[] {
  if (!Array.isArray(why)) throw Error("DEPENDENCY_PATHS_UNAVAILABLE");
  const paths = new Set<string>();
  const walk = (dependencies: Record<string, WhyNode> | undefined, trail: string) => {
    for (const [name, node] of Object.entries(dependencies ?? {})) {
      const here = `${trail}>${name}`;
      if (name === pkg) paths.add(here);
      walk(node.dependencies, here);
    }
  };
  for (const importer of why as WhyImporter[]) {
    if (typeof importer.path !== "string") throw Error("DEPENDENCY_PATHS_UNAVAILABLE");
    const label = relative(root, importer.path).split(sep).join("__") || ".";
    walk(importer.dependencies, `${label}(dependencies)`);
    walk(importer.devDependencies, label);
    walk(importer.optionalDependencies, `${label}(optionalDependencies)`);
  }
  return [...paths].sort();
}

type AuditAdvisory = {
  id?: number;
  module_name?: string;
  severity?: string;
  github_advisory_id?: string;
  findings?: { paths?: string[] }[];
};

const blocking = (severity: unknown) => severity === "critical" || severity === "high";
const lower = (severity: unknown) => severity === "moderate" || severity === "low";

/**
 * The audit's verdict with raw descriptions stripped, on `review.today` (a UTC date, YYYY-MM-DD;
 * today when not given). An advisory listed in `review.advisories` is set aside only when every
 * path the audit reports for it, and every installed path to its package (`review.installedPaths`),
 * lies within a reviewed subtree; a moderate or low one only when `review.lower` records it at its
 * severity. Every record must stand on that day, and the audit's own totals must be fully
 * accounted for by the advisories set aside.
 */
export function dependencySummary(
  input: unknown,
  review: {
    advisories?: readonly ReviewedAdvisory[];
    lower?: readonly RecordedAdvisory[];
    installedPaths?: Record<string, string[]>;
    today?: string;
  } = {},
) {
  const raw = input as {
    metadata?: { vulnerabilities?: Record<string, number> };
    advisories?: Record<string, AuditAdvisory>;
  };
  if (!raw.metadata?.vulnerabilities) throw Error("DEPENDENCY_AUDIT_UNAVAILABLE");
  const counts = Object.fromEntries(
    ["critical", "high", "moderate", "low", "info"].map((k) => [
      k,
      Number(raw.metadata!.vulnerabilities![k] ?? 0),
    ]),
  );
  const today = review.today ?? new Date().toISOString().slice(0, 10);
  const recordProblems = advisoryRecordProblems(review.advisories ?? [], review.lower ?? [], today);
  const standing = (id: string, name: unknown) =>
    !recordProblems.some((p) => p.id === id && p.package === name);
  const findings: { id: string; package: string; severity?: string | undefined }[] = [];
  const reviewed: { id: string; package: string; paths: string[]; owner: string; reviewBy: string }[] = [];
  const recorded: { id: string; package: string; severity: string; owner: string; fixBy: string }[] = [];
  let reviewedBlocking = 0,
    recordedLower = 0;
  for (const a of Object.values(raw.advisories ?? {})) {
    const id = a.github_advisory_id ?? String(a.id);
    const name = String(a.module_name ?? "unknown")
      .replace(/[^a-zA-Z0-9@/_.-]/g, "")
      .slice(0, 120);
    const occurrences = Math.max(1, a.findings?.length ?? 0);
    const entry = review.advisories?.find((r) => r.id === id && r.package === a.module_name);
    const reported = (a.findings ?? []).flatMap((f) => f.paths ?? []);
    const installed = review.installedPaths?.[String(a.module_name)] ?? [];
    const paths = [...new Set([...reported, ...installed])].sort();
    const reviewedPath = (path: string) => entry!.within.some((prefix) => path.startsWith(prefix));
    if (
      entry &&
      standing(id, a.module_name) &&
      reported.length &&
      installed.length &&
      paths.every(reviewedPath)
    ) {
      reviewed.push({ id, package: name, paths, owner: entry.owner, reviewBy: entry.reviewBy });
      if (blocking(a.severity)) reviewedBlocking += occurrences;
      else if (lower(a.severity)) recordedLower += occurrences;
      continue;
    }
    const record = review.lower?.find(
      (r) => r.id === id && r.package === a.module_name && r.severity === a.severity,
    );
    if (record && standing(id, a.module_name)) {
      recorded.push({
        id,
        package: name,
        severity: record.severity,
        owner: record.owner,
        fixBy: record.fixBy,
      });
      recordedLower += occurrences;
      continue;
    }
    findings.push({ id, package: name, severity: a.severity });
  }
  const blocked =
    recordProblems.length > 0 ||
    findings.some((f) => blocking(f.severity) || lower(f.severity)) ||
    counts.critical! + counts.high! > reviewedBlocking ||
    counts.moderate! + counts.low! > recordedLower;
  return { status: blocked ? "blocked" : "pass", counts, findings, reviewed, recorded, recordProblems };
}
export function secretSummary(input: unknown) {
  if (!Array.isArray(input)) throw Error("SECRET_SCAN_UNAVAILABLE");
  return {
    status: input.length ? "blocked" : "pass",
    count: input.length,
    findings: input.map((r) => ({
      rule: String(r.RuleID).slice(0, 100),
      file: String(r.File).slice(0, 300),
      line: Number(r.StartLine),
      commit: /^[a-f0-9]{40}$/.test(r.Commit) ? r.Commit : undefined,
    })),
  };
}
