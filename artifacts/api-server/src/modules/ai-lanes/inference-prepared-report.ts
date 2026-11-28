import { allocationPackageId, type FiniteAllocationPackage } from "../ai";
import type { finiteManifestProposal } from "../ai";
type Proposal = ReturnType<typeof finiteManifestProposal>;
/** A package identifier is a selector, not authority. Callers must load and
 * verify its durable owner approval before using the returned identifier. */
export function parseFinitePreparationOptions(extra: string[]) {
  if (new Set(extra).size !== extra.length || extra.length > 20)
    throw Error("FINITE_PREPARATION_OPTIONS_INVALID");
  let retry = false,
    guidePairs = false,
    practicalPairs = false,
    reminderInventoryPairs = false,
    rulePairs = false,
    packageId: string | undefined;
  // Prepared candidates are private artifacts until their reviews pass (decision 0014), so each
  // is named by its exact artifact: --candidate=<artifact id>:<artifact sha256>.
  const candidates: { id: string; hash: string; extension: "json" }[] = [];
  for (const option of extra) {
    if (option === "--with-schema-retry") retry = true;
    // A new package for the review pairs of guides (decision 0017), in place of the templates' one.
    else if (option === "--guide-pairs") guidePairs = true;
    // A new package for the review pairs of requirements-check rules on the reviewed route
    // (docs/architecture/reviewed-route.md, part 3).
    else if (option === "--rule-pairs") rulePairs = true;
    else if (option === "--practical-guide-pairs" || option === "--reminder-inventory-pairs") {
      if (practicalPairs) throw Error("FINITE_PREPARATION_OPTIONS_INVALID");
      practicalPairs = true;
      reminderInventoryPairs = option === "--reminder-inventory-pairs";
    } else if (/^--package=finite-package:[a-f0-9]{64}$/.test(option)) {
      if (packageId) throw Error("FINITE_PREPARATION_OPTIONS_INVALID");
      packageId = option.slice("--package=".length);
    } else if (/^--candidate=[a-f0-9-]{36}:[a-f0-9]{64}$/.test(option)) {
      const [id, hash] = option.slice("--candidate=".length).split(":") as [string, string];
      if (candidates.some((c) => c.id === id)) throw Error("FINITE_PREPARATION_OPTIONS_INVALID");
      candidates.push({ id, hash, extension: "json" });
    } else throw Error("FINITE_PREPARATION_OPTIONS_INVALID");
  }
  if (
    [guidePairs, practicalPairs, rulePairs].filter(Boolean).length > 1 ||
    ((guidePairs || practicalPairs || rulePairs) && (retry || packageId)) ||
    (practicalPairs && candidates.length > 2)
  )
    throw Error("FINITE_PREPARATION_OPTIONS_INVALID");
  return {
    retry,
    packageId,
    candidates,
    guidePairs,
    ...(practicalPairs ? { practicalPairs: true as const } : {}),
    ...(reminderInventoryPairs ? { reminderInventoryPairs: true as const } : {}),
    ...(rulePairs ? { rulePairs: true as const } : {}),
  };
}
/** Select one immutable pair or customer case; never silently pick a candidate.
 * The single-proposal shape is retained for already-created private reports. */
export function selectPreparedProposal(
  report: { package: FiniteAllocationPackage; proposal?: Proposal | null; proposals?: Proposal[] },
  candidateVersionId?: string,
): Proposal {
  const proposals = report.proposals ?? (report.proposal ? [report.proposal] : []);
  const customer = candidateVersionId?.startsWith("customer:")
    ? candidateVersionId.slice("customer:".length)
    : null;
  const selected = candidateVersionId
    ? proposals.filter(
        (p) =>
          p.manifest.works.length > 0 &&
          p.manifest.works.every((w) =>
            customer
              ? w.lane === "customer" && w.bindings.corpus === "customer-ai" && w.bindings.caseId === customer
              : w.bindings.candidateVersionId === candidateVersionId,
          ),
      )
    : proposals;
  if (selected.length !== 1) throw Error("EXACT_PREPARED_CANDIDATE_REQUIRED");
  const proposal = selected[0]!;
  if (!report.package || proposal.manifest.packageId !== allocationPackageId(report.package))
    throw Error("PREPARED_PACKAGE_BINDING_INVALID");
  return proposal;
}
