import {allocationPackageId,type FiniteAllocationPackage} from "./inference-allocation-package";
import type {finiteManifestProposal} from "./inference-manifest";
type Proposal=ReturnType<typeof finiteManifestProposal>;
/** Select one immutable pair; admission never silently chooses among candidates.
 * The single-proposal shape is retained for already-created private reports. */
export function selectPreparedProposal(report:{package:FiniteAllocationPackage;proposal?:Proposal|null;proposals?:Proposal[]},
  candidateVersionId?:string):Proposal{
  const proposals=report.proposals??(report.proposal?[report.proposal]:[]);
  const selected=candidateVersionId?proposals.filter(p=>p.manifest.works.every(w=>
    w.bindings.candidateVersionId===candidateVersionId)):proposals;
  if(selected.length!==1)throw Error("EXACT_PREPARED_CANDIDATE_REQUIRED");
  const proposal=selected[0]!;
  if(!report.package||proposal.manifest.packageId!==allocationPackageId(report.package))
    throw Error("PREPARED_PACKAGE_BINDING_INVALID");
  return proposal;
}
