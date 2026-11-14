import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {createHash} from "node:crypto";
import {additionalInferenceAllocation,inferenceProposal,requestDigest} from "./inference-budget";
import type {FiniteManifest,FiniteWork} from "./inference-batch-dispatch";
import type {InferenceBudgetStore} from "./inference-budget-store";
const root=resolve(import.meta.dirname,"../../../..");
const sha=(bytes:Buffer)=>createHash("sha256").update(bytes).digest("hex");
type SourceRef={path:string;sha256:string};
export type FiniteAllocationPackage={version:3;kind:"finite-inference-package";preparedAt:string;
  policyVersion:string;allocation:typeof additionalInferenceAllocation;
  sourceFiles:SourceRef[];contentIds:string[];
  corpora:{name:"editorial"|"checker"|"customer-ai";cases:{id:string;hash:string}[]}[];
  laneAttemptLimits:{publication:216;editorial_evaluation:68;checker_challenge:80;customer:94};
  allowedRoles:readonly["factual","challenge","customer"];
  supportedPreparers:readonly string[];
  holds:string[]};
const scopePaths=["docs/registers/content-inventory.json","docs/content-candidates/r1-content-intake-manifest.json",
  "docs/evaluation-candidates/editorial.json","docs/evaluation-candidates/checker.json","docs/evaluation-candidates/customer-ai.json"] as const;
/** Reads the actual finite inventory/corpora. Scope is not readiness: unfinished
 * preparers remain held, and actual source/rights/currentness gates still run. */
export async function prepareFiniteAllocationPackage(now=new Date()):Promise<FiniteAllocationPackage>{
  const sources=await Promise.all(scopePaths.map(async path=>{const bytes=await readFile(resolve(root,path));
    return{path,sha256:sha(bytes),value:JSON.parse(bytes.toString())};}));
  const intake=sources[1]!.value as {templates:{id:string}[];guidance:{id:string}[]};
  const corpora=sources.slice(2).map(source=>{
    const name=source.path.split("/").at(-1)!.replace(".json","") as FiniteAllocationPackage["corpora"][number]["name"];
    const cases=(source.value as {cases:Record<string,unknown>[]}).cases.map(row=>{
      const id=row.id??row.caseID??row.caseId??row.scenarioId??row.scenarioID;
      if(typeof id!=="string"||!id)throw Error("PACKAGE_CORPUS_ID_INVALID");return{id,hash:requestDigest(row)};
    });
    if(cases.length!==({editorial:60,checker:80,"customer-ai":60})[name]||new Set(cases.map(c=>c.id)).size!==cases.length)
      throw Error("PACKAGE_CORPUS_CHANGED");
    return{name,cases};
  });
  return{version:3,kind:"finite-inference-package",preparedAt:now.toISOString(),policyVersion:inferenceProposal.priceVersion,
    allocation:{...additionalInferenceAllocation},sourceFiles:sources.map(({path,sha256})=>({path,sha256})),
    contentIds:[...new Set([...intake.templates,...intake.guidance].map(c=>c.id))].sort(),corpora,
    laneAttemptLimits:{publication:216,editorial_evaluation:68,checker_challenge:80,customer:94},
    allowedRoles:["factual","challenge","customer"],supportedPreparers:["operational-template-pair-v1"],
    holds:["Only the existing TPL-07 exact operational review preparer is executable in this revision.",
      "Other content and all evaluation lanes require their real request preparers and eligibility checks before delegated admission.",
      "The allocation is a maximum additional spend, not a guarantee of completing every permitted attempt."]};
}
export function allocationPackageId(value:FiniteAllocationPackage){return`finite-package:${requestDigest(value)}`;}
export function validateAllocationPackage(value:FiniteAllocationPackage){
  if(value.version!==3||value.kind!=="finite-inference-package"||!Number.isFinite(Date.parse(value.preparedAt))||
    value.policyVersion!==inferenceProposal.priceVersion||requestDigest(value.allocation)!==requestDigest(additionalInferenceAllocation)||
    requestDigest(value.laneAttemptLimits)!==requestDigest({publication:216,editorial_evaluation:68,checker_challenge:80,customer:94})||
    requestDigest(value.allowedRoles)!==requestDigest(["factual","challenge","customer"])||
    !Array.isArray(value.contentIds)||!value.contentIds.length||new Set(value.contentIds).size!==value.contentIds.length||
    value.sourceFiles.length!==scopePaths.length||value.sourceFiles.some((f,i)=>f.path!==scopePaths[i]||!/^[a-f0-9]{64}$/.test(f.sha256)))
    throw Error("ALLOCATION_PACKAGE_INVALID");
  for(const[name,count]of Object.entries({editorial:60,checker:80,"customer-ai":60})){
    const corpus=value.corpora.filter(c=>c.name===name);
    if(corpus.length!==1||corpus[0]!.cases.length!==count||new Set(corpus[0]!.cases.map(c=>c.id)).size!==count||
      corpus[0]!.cases.some(c=>!c.id||!/^[a-f0-9]{64}$/.test(c.hash)))throw Error("ALLOCATION_PACKAGE_INVALID");
  }
}
export function assertWorkPackageMembership(work:FiniteWork,pkg:FiniteAllocationPackage,contentId:string|null){
  validateAllocationPackage(pkg);
  if(!pkg.allowedRoles.includes(work.role)||work.role==="customer"&&work.lane!=="customer")throw Error("WORK_OUTSIDE_PACKAGE");
  if(work.bindings.corpus){
    const corpus=pkg.corpora.find(c=>c.name===work.bindings.corpus),row=corpus?.cases.find(c=>c.id===work.bindings.caseId);
    if(!row||row.hash!==work.caseHash)throw Error("WORK_OUTSIDE_PACKAGE");
  }
  if(work.lane==="publication"&&(!contentId||!pkg.contentIds.includes(contentId)))throw Error("WORK_OUTSIDE_PACKAGE");
  // Scope may authorize these lanes, but scope alone cannot manufacture an
  // implemented safe request preparer or weaken the actual readiness checks.
  if(work.lane!=="publication"||contentId!=="TPL-07"||!work.bindings.operationalPlan)
    throw Error("PACKAGE_EXECUTABLE_PREPARER_UNAVAILABLE");
}
async function packageRow(c:import("pg").PoolClient,schema:string,id:string,admitting:boolean){
  const row=(await c.query(`SELECT * FROM "${schema}".valo_inference_batches WHERE id=$1 FOR SHARE`,[id])).rows[0];
  if(!row||!row.approved_by||row.approved_by==="finite-package-delegate"||!row.approval_reference||!row.approved_at||
    admitting&&!row.enabled)throw Error("ALLOCATION_PACKAGE_NOT_AUTHORIZED");
  const pkg=row.manifest as FiniteAllocationPackage;validateAllocationPackage(pkg);
  const approvedAt=Date.parse(row.approved_at),expiresAt=Date.parse(row.expires_at);
  if(row.policy_hash!==requestDigest(inferenceProposal)||row.manifest_hash!==requestDigest(pkg)||
    id!==allocationPackageId(pkg)||!Number.isFinite(approvedAt)||!Number.isFinite(expiresAt)||
    approvedAt>Date.now()||Date.parse(pkg.preparedAt)>approvedAt||admitting&&expiresAt<=Date.now())
    throw Error("ALLOCATION_PACKAGE_EXPIRED_OR_CHANGED");
  if(admitting){
    for(const source of pkg.sourceFiles)if(sha(await readFile(resolve(root,source.path)))!==source.sha256)
      throw Error("ALLOCATION_PACKAGE_SOURCE_CHANGED");
  }
  return{row,pkg};
}
/** Reuse the existing immutable package for fresh exact submanifests. A new
 * child timestamp never creates a new owner-approval requirement. */
export async function readApprovedFiniteAllocationPackage(pool:Pick<import("pg").Pool,"connect">,id:string){
  const c=await pool.connect();
  try{await c.query("BEGIN READ ONLY");const {pkg,row}=await packageRow(c,"public",id,true);
    await c.query("COMMIT");return{pkg,expiresAt:new Date(row.expires_at).toISOString()};
  }catch(error){await c.query("ROLLBACK");throw error;}finally{c.release();}
}
export async function assertDelegatedBatchAuthority(c:import("pg").PoolClient,schema:string,
  child:{manifest:FiniteManifest;manifest_hash:string;approved_by:string;approval_reference:string;approved_at:unknown;expires_at:unknown},
  admitting=true){
  const id=child.manifest.packageId;if(!id)throw Error("ALLOCATION_PACKAGE_REQUIRED");
  const {row,pkg}=await packageRow(c,schema,id,admitting);
  if(child.approved_by!=="finite-package-delegate"||child.approval_reference!==`delegate:${requestDigest({packageId:id,
      packageHash:row.manifest_hash,manifestHash:child.manifest_hash})}`||
    Date.parse(String(child.approved_at))<Date.parse(row.approved_at)||
    Date.parse(String(child.expires_at))>Date.parse(row.expires_at))throw Error("DELEGATED_APPROVAL_BINDING_INVALID");
  if(admitting){
    for(const work of child.manifest.works){
      const content=work.bindings.candidateVersionId?(await c.query(`SELECT template_id FROM "${schema}".valo_content_versions WHERE id=$1`,
        [work.bindings.candidateVersionId])).rows[0]?.template_id:null;
      assertWorkPackageMembership(work,pkg,content??null);
    }
  }
  return pkg;
}
/** Server-only automatic admission inside a previously owner-approved finite
 * package. It cannot create/enable the parent approval or reset its ledger. */
export async function registerPreparedInferenceSubmanifest(store:InferenceBudgetStore,manifest:FiniteManifest,
  expiresAt:string,recheck:(work:FiniteWork)=>Promise<void>){
  if(process.env.NODE_ENV!=="development"||process.env.REPLIT_DEPLOYMENT||!manifest.packageId||
    store.allocationId()!==additionalInferenceAllocation.id)throw Error("DELEGATED_REGISTRATION_HELD");
  const manifestHash=requestDigest(manifest),batchId=`finite-submanifest:${manifestHash}`;
  return store.mutate("finite-submanifest-admitted",async(s,c)=>{
    const {row,pkg}=await packageRow(c,store.schemaName(),manifest.packageId!,true);
    const expiry=Date.parse(expiresAt);
    if(!Number.isFinite(expiry)||expiry<=Date.now()||expiry>Date.parse(row.expires_at))throw Error("SUBMANIFEST_EXPIRY_INVALID");
    for(const work of manifest.works){
      const content=work.bindings.candidateVersionId?(await c.query(`SELECT template_id FROM "${store.schemaName()}".valo_content_versions WHERE id=$1`,
        [work.bindings.candidateVersionId])).rows[0]?.template_id:null;
      assertWorkPackageMembership(work,pkg,content??null);await recheck(work);
    }
    const reference=`delegate:${requestDigest({packageId:manifest.packageId,packageHash:row.manifest_hash,manifestHash})}`;
    await c.query(`INSERT INTO "${store.schemaName()}".valo_inference_batches
      (id,policy_hash,manifest_hash,manifest,enabled,approved_by,approval_reference,approved_at,expires_at)
      VALUES($1,$2,$3,$4,true,'finite-package-delegate',$5,now(),$6) ON CONFLICT(id) DO NOTHING`,
      [batchId,requestDigest(inferenceProposal),manifestHash,JSON.stringify(manifest),reference,expiresAt]);
    const saved=(await c.query(`SELECT * FROM "${store.schemaName()}".valo_inference_batches WHERE id=$1 FOR SHARE`,[batchId])).rows[0];
    if(!saved||saved.manifest_hash!==manifestHash||requestDigest(saved.manifest)!==manifestHash||!saved.enabled)
      throw Error("SUBMANIFEST_REGISTRATION_CONFLICT");
    await assertDelegatedBatchAuthority(c,store.schemaName(),saved);
    return{state:s,value:{batchId,manifestHash,packageId:manifest.packageId,providerCalls:0}};
  });
}
