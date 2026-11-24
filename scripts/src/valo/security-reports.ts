import { relative, sep } from "node:path";

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
};

/**
 * Dependency advisories the merge gate tolerates after review, each only within the dependency
 * subtrees that were reviewed. Every path to the package, as the audit reports it and as the
 * installed tree shows it (the audit names one path per vulnerable version), must lie within
 * them; any other path, including the same chain reached as a production dependency, still
 * blocks. Remove an entry once a fixed release can be adopted.
 */
// None is tolerated today. The one there was, GHSA-fc5q-39xc-vjpf in picomatch (reviewed on
// 17 November 2026), is withdrawn: GitHub's page for it says so from 18 November 2026, and on
// 24 November 2026 `pnpm audit --json` reported no advisory for the lockfile. Should it return,
// the gate blocks it until it is reviewed again.
export const REVIEWED_DEPENDENCY_ADVISORIES: readonly ReviewedAdvisory[] = [];

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

/**
 * The audit's verdict with raw descriptions stripped. An advisory listed in `review.advisories`
 * is set aside only when every path the audit reports for it, and every installed path to its
 * package (`review.installedPaths`), lies within a reviewed subtree; the audit's own totals must then be
 * fully accounted for by the advisories set aside.
 */
export function dependencySummary(
  input: unknown,
  review: { advisories?: readonly ReviewedAdvisory[]; installedPaths?: Record<string, string[]> } = {},
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
  const findings: { id: string; package: string; severity?: string | undefined }[] = [];
  const reviewed: { id: string; package: string; paths: string[] }[] = [];
  let reviewedBlocking = 0;
  for (const a of Object.values(raw.advisories ?? {})) {
    const id = a.github_advisory_id ?? String(a.id);
    const name = String(a.module_name ?? "unknown")
      .replace(/[^a-zA-Z0-9@/_.-]/g, "")
      .slice(0, 120);
    const entry = review.advisories?.find((r) => r.id === id && r.package === a.module_name);
    const reported = (a.findings ?? []).flatMap((f) => f.paths ?? []);
    const installed = review.installedPaths?.[String(a.module_name)] ?? [];
    const paths = [...new Set([...reported, ...installed])].sort();
    const reviewedPath = (path: string) => entry!.within.some((prefix) => path.startsWith(prefix));
    if (entry && reported.length && installed.length && paths.every(reviewedPath)) {
      reviewed.push({ id, package: name, paths });
      if (blocking(a.severity)) reviewedBlocking += Math.max(1, a.findings?.length ?? 0);
      continue;
    }
    findings.push({ id, package: name, severity: a.severity });
  }
  const blocked =
    findings.some((f) => blocking(f.severity)) || counts.critical! + counts.high! > reviewedBlocking;
  return { status: blocked ? "blocked" : "pass", counts, findings, reviewed };
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
