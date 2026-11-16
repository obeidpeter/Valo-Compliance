import { allocationPackageId, type FiniteAllocationPackage } from "./inference-allocation-package";
import type { finiteManifestProposal } from "./inference-manifest";
type Proposal = ReturnType<typeof finiteManifestProposal>;
/** A package identifier is a selector, not authority. Callers must load and
 * verify its durable owner approval before using the returned identifier. */
export function parseFinitePreparationOptions(extra: string[]) {
  if (new Set(extra).size !== extra.length || extra.length > 2)
    throw Error("FINITE_PREPARATION_OPTIONS_INVALID");
  let retry = false,
    packageId: string | undefined;
  for (const option of extra) {
    if (option === "--with-schema-retry") retry = true;
    else if (/^--package=finite-package:[a-f0-9]{64}$/.test(option)) {
      if (packageId) throw Error("FINITE_PREPARATION_OPTIONS_INVALID");
      packageId = option.slice("--package=".length);
    } else throw Error("FINITE_PREPARATION_OPTIONS_INVALID");
  }
  return { retry, packageId };
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
