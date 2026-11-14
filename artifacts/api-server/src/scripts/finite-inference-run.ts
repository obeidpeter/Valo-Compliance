import {mkdir,writeFile} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {resolve} from "node:path";
import {desc} from "drizzle-orm";
import {publicationSchema} from "@workspace/valo-core";
import {assertDevelopmentRuntime} from "../lib/valo-development-runtime";
import {requestDigest} from "../lib/inference-budget";
import {prepareOperationalFiniteManifest,finiteManifestProposal} from "../lib/inference-manifest";
import type {FiniteManifest} from "../lib/inference-batch-dispatch";
import {prepareFiniteAllocationPackage,allocationPackageId,registerPreparedInferenceSubmanifest,readApprovedFiniteAllocationPackage} from "../lib/inference-allocation-package";

/** No approval/enable operation exists in this command. Preparation creates
 * exact, disabled private artifacts; execution can only use an existing owner
 * approval independently verified by the production dispatcher. */
async function main(){
  assertDevelopmentRuntime();
  const [{db,pool,valoContentVersions},{readOperationalInferenceReadiness},{assertFiniteWorkBindings},
    {withApprovedInferencePair},{saveOperationalReviewPlan,executeOperationalReviewPlan},
    {getPublicationArtifact,putPublicationArtifact},{publicationWorkspaceRoot},{InferenceBudgetStore}]=await Promise.all([
    import("@workspace/db"),import("../lib/inference-operational-ready"),import("../lib/inference-work-bindings"),
    import("../lib/managed-inference"),import("../editorial/operational-review"),import("../editorial/publication-artifacts"),
    import("../editorial/operational-policy"),import("../lib/inference-budget-store")]);
  try{
  const[mode,batchId,...extra]=process.argv.slice(2);
  if(mode==="--admit"){
    const[artifactHash]=extra;
    if(extra.length!==1||!batchId||!/^[a-f0-9-]{36}$/.test(batchId)||!artifactHash||!/^[a-f0-9]{64}$/.test(artifactHash))
      throw Error("FINITE_RUN_ARGUMENTS_INVALID");
    const report=JSON.parse((await getPublicationArtifact({id:batchId,hash:artifactHash,extension:"json"})).toString());
    if(!report.proposal?.manifest||!report.package||
      report.proposal.manifest.packageId!==allocationPackageId(report.package))throw Error("PREPARED_PACKAGE_BINDING_INVALID");
    const admitted=await registerPreparedInferenceSubmanifest(new InferenceBudgetStore(pool,"public","additional-new"),
      report.proposal.manifest,report.proposal.expiresAt,assertFiniteWorkBindings);
    console.log(JSON.stringify(admitted));return;
  }
  if(extra.length||!["--prepare","--execute"].includes(mode??"")||
    mode==="--prepare"&&batchId&&!/^finite-package:[a-f0-9]{64}$/.test(batchId)||
    mode==="--execute"&&(!batchId||!/^[-a-zA-Z0-9_:]{1,160}$/.test(batchId)))throw Error("FINITE_RUN_ARGUMENTS_INVALID");
  if(mode==="--prepare"){
    const existingPackage=batchId?await readApprovedFiniteAllocationPackage(pool,batchId):null;
    const allocationPackage=existingPackage?.pkg??await prepareFiniteAllocationPackage(),packageId=allocationPackageId(allocationPackage);
    const latest=new Map<string,typeof valoContentVersions.$inferSelect>();
    for(const row of await db.select().from(valoContentVersions).orderBy(desc(valoContentVersions.version)))
      if(!latest.has(row.templateId))latest.set(row.templateId,row);
    const holds:{candidateVersionId:string;templateId:string;reason:string}[]=[];
    let prepared:null|ReturnType<typeof finiteManifestProposal>=null;
    for(const row of latest.values()){
      if(row.templateId!=="TPL-07"){
        holds.push({candidateVersionId:row.id,templateId:row.templateId,reason:"CANDIDATE_REQUEST_PREPARER_UNAVAILABLE"});continue;
      }
      try{
        const current=await readOperationalInferenceReadiness(row.id);
        const plan=await saveOperationalReviewPlan(current.candidate,current.rightsInput,current.provenanceInput,
          current.exportReport,current.serverEvidence);
        const manifest=prepareOperationalFiniteManifest({candidateVersionId:row.id,candidateHash:row.candidateHash,
          bundleHash:requestDigest(current.bundle),sourceHashes:current.bundle.sources.map(s=>s.hash),sourceFiles:[],plan});
        manifest.packageId=packageId;
        for(const work of manifest.works)await assertFiniteWorkBindings(work);
        prepared=finiteManifestProposal(manifest,existingPackage?
          new Date(Math.min(Date.parse(existingPackage.expiresAt),Date.parse(plan.manifest.expiresAt))).toISOString():plan.manifest.expiresAt);
      }catch(error){holds.push({candidateVersionId:row.id,templateId:row.templateId,
        reason:error instanceof Error&&/^[A-Z_]{3,100}$/.test(error.message)?error.message:"FINITE_PREPARATION_FAILED"});}
    }
    const report={preparedAt:new Date().toISOString(),scope:"one finite additional allocation with automatic exact submanifest admission",
      packageId,package:allocationPackage,ownerApprovalScope:"finite-allocation-package",ownerApproved:!!existingPackage,
      executableScope:"first exact operational review pair only",
      latestCandidatesInspected:latest.size,proposal:prepared,holds,providerCalls:0,approvalRowsWritten:0,
      nonpublicationCorpora:"Original 80/60/60 case rosters are frozen in the proposed package; executable preparers remain held.",
      excluded:["authoring","real customer confidential data","production","payments","emails"],
      readiness:prepared?"disabled proposal ready for exact-manifest review":"no eligible prepared work"};
    const artifact=await putPublicationArtifact(Buffer.from(JSON.stringify(report)),"json");
    const dir=resolve(publicationWorkspaceRoot(),"generated-artifacts/valo-completion");
    await mkdir(dir,{recursive:true,mode:0o700});
    const path=resolve(dir,`finite-inference-proposal-${randomUUID()}.json`);
    await writeFile(path,JSON.stringify({...report,privateReportArtifact:artifact},null,2)+"\n",{flag:"wx",mode:0o600});
    console.log(JSON.stringify({ready:prepared!==null,manifestHash:prepared?.manifestHash??null,
      attemptCount:prepared?.attemptCount??0,holds:holds.length,providerCalls:0,ownerApproved:false,
      privateReportArtifact:artifact,report:path}));return;
  }
  const row=(await pool.query("SELECT manifest,manifest_hash FROM valo_inference_batches WHERE id=$1",[batchId])).rows[0];
  if(!row||requestDigest(row.manifest)!==row.manifest_hash)throw Error("INFERENCE_MANIFEST_INVALID");
  const manifest=row.manifest as FiniteManifest;
  if(manifest.version!==2||manifest.works.length!==2)throw Error("RUNNER_SCOPE_UNSUPPORTED");
  const[first,second]=manifest.works;
  if(!first||!second||first.lane!=="publication"||second.lane!=="publication"||!first.pair||first.pair!==second.pair||
    !first.bindings.candidateVersionId||first.bindings.candidateVersionId!==second.bindings.candidateVersionId||
    !first.bindings.operationalPlan||requestDigest(first.bindings.operationalPlan)!==requestDigest(second.bindings.operationalPlan))
    throw Error("RUNNER_PAIR_BINDING_INVALID");
  const current=await readOperationalInferenceReadiness(first.bindings.candidateVersionId);
  const artifact=first.bindings.operationalPlan;
  const retained=JSON.parse((await getPublicationArtifact(artifact)).toString());
  const plan={manifest:retained.manifest,entries:retained.entries,artifact} as Awaited<ReturnType<typeof saveOperationalReviewPlan>>;
  // Rebuild at the original timestamp: owner approval is for this exact roster,
  // never for newly generated requests, a refreshed timestamp, or extra retries.
  const expected=prepareOperationalFiniteManifest({candidateVersionId:current.row.id,candidateHash:current.row.candidateHash,
    bundleHash:requestDigest(publicationSchema.parse(current.row.bundle)),sourceHashes:current.bundle.sources.map(s=>s.hash),
    sourceFiles:[],plan},new Date(manifest.preparedAt));
  expected.packageId=manifest.packageId;
  if(requestDigest(expected)!==row.manifest_hash)throw Error("RUNNER_MANIFEST_CHANGED");
  for(const work of manifest.works)await assertFiniteWorkBindings(work);
  const reviews=await withApprovedInferencePair(batchId!,first.pair,
    ()=>executeOperationalReviewPlan(plan,current.candidate,current.serverEvidence));
  const report={completedAt:new Date().toISOString(),batchId,manifestHash:row.manifest_hash,
    reviews:reviews.map(r=>({role:r.record.role,artifact:r.artifact,providerResponseId:r.record.providerResponseId})),
    expectedIndependentReviews:2,complete:reviews.length===2,publicationAccepted:false};
  const resultArtifact=await putPublicationArtifact(Buffer.from(JSON.stringify(report)),"json");
  console.log(JSON.stringify({...report,resultArtifact}));
  }finally{await pool.end();}
}
main().catch(error=>{console.error(error instanceof Error&&/^[A-Z_]{3,100}$/.test(error.message)?error.message:
  "FINITE_INFERENCE_RUN_FAILED");process.exitCode=1;});
