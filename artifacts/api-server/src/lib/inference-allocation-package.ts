import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {createHash} from "node:crypto";
import {additionalInferenceAllocation,inferenceProposal,inferenceTimestamp,requestDigest} from "./inference-budget";
import type {FiniteManifest,FiniteWork} from "./inference-batch-dispatch";
import type {InferenceBudgetStore} from "./inference-budget-store";
import {assertDevelopmentRuntime} from "./valo-development-runtime";
import {operationalInferenceTemplateIds,supportsOperationalInferenceTemplate} from "./inference-operational-coverage";
const root=resolve(import.meta.dirname,"../../../..");
const sha=(bytes:Buffer)=>createHash("sha256").update(bytes).digest("hex");
type SourceRef={path:string;sha256:string};
type NamedContentSection={identity:string;sourcePath:string;heading:string;baselineSectionSha256:string;
  category:"practical-guide"|"industry-landing"|"industry-deeper-pack"};
export type FiniteAllocationPackage={version:3;kind:"finite-inference-package";preparedAt:string;
  policyVersion:string;allocation:typeof additionalInferenceAllocation;
  sourceFiles:SourceRef[];contentIds:string[];namedContentSections:NamedContentSection[];
  corpora:{name:"editorial"|"checker"|"customer-ai";cases:{id:string;hash:string}[]}[];
  laneAttemptLimits:{publication:216;editorial_evaluation:68;checker_challenge:80;customer:94};
  allowedRoles:readonly["factual","challenge","customer"];
  supportedPreparers:readonly string[];
  holds:string[]};
const scopePaths=["docs/registers/content-inventory.json","docs/content-candidates/r1-content-intake-manifest.json",
  "docs/evaluation-candidates/editorial.json","docs/evaluation-candidates/checker.json","docs/evaluation-candidates/customer-ai.json",
  "docs/content-candidates/practical-guide-candidates.md","docs/content-candidates/industry-content-candidates.md"] as const;
function namedSections(path:string,body:string):NamedContentSection[]{
  const headers=[...body.matchAll(/^#{1,3} .+$/gm)];
  return headers.flatMap((match,index):NamedContentSection[]=>{
    const heading=match[0].replace(/^#+ /,""),isGuide=path===scopePaths[5]&&/^## GUIDE-C\d{2} — /.test(match[0]);
    const industry=path===scopePaths[6]&&match[0].startsWith("### ");
    if(!isGuide&&!industry)return[];
    return[{identity:`${path}#${heading}`,sourcePath:path,heading,
      baselineSectionSha256:sha(Buffer.from(body.slice(match.index,headers[index+1]?.index??body.length))),
      category:isGuide?"practical-guide":heading.endsWith(" — deeper pack")?"industry-deeper-pack":"industry-landing"}];
  });
}
/** Reads the actual finite inventory/corpora. Scope is not readiness: unfinished
 * preparers remain held, and actual source/rights/currentness gates still run. */
export async function prepareFiniteAllocationPackage(now=new Date()):Promise<FiniteAllocationPackage>{
  const sources=await Promise.all(scopePaths.map(async path=>{const bytes=await readFile(resolve(root,path));
    return{path,sha256:sha(bytes),body:bytes.toString(),value:path.endsWith(".json")?JSON.parse(bytes.toString()):null};}));
  const intake=sources[1]!.value as {templates:{id:string}[];guidance:{id:string}[]};
  const corpora=sources.slice(2,5).map(source=>{
    const name=source.path.split("/").at(-1)!.replace(".json","") as FiniteAllocationPackage["corpora"][number]["name"];
    const cases=(source.value as {cases:Record<string,unknown>[]}).cases.map(row=>{
      const id=row.id??row.caseID??row.caseId??row.scenarioId??row.scenarioID;
      if(typeof id!=="string"||!id)throw Error("PACKAGE_CORPUS_ID_INVALID");return{id,hash:requestDigest(row)};
    });
    if(cases.length!==({editorial:60,checker:80,"customer-ai":60})[name]||new Set(cases.map(c=>c.id)).size!==cases.length)
      throw Error("PACKAGE_CORPUS_CHANGED");
    return{name,cases};
  });
  const sections=sources.slice(5).flatMap(source=>namedSections(source.path,source.body));
  for(const[category,count]of Object.entries({"practical-guide":12,"industry-landing":20,"industry-deeper-pack":6}))
    if(sections.filter(s=>s.category===category).length!==count)throw Error("PACKAGE_CONTENT_SECTIONS_CHANGED");
  return{version:3,kind:"finite-inference-package",preparedAt:now.toISOString(),policyVersion:inferenceProposal.priceVersion,
    allocation:{...additionalInferenceAllocation},sourceFiles:sources.map(({path,sha256})=>({path,sha256})),
    contentIds:[...new Set([...intake.templates,...intake.guidance].map(c=>c.id))].sort(),namedContentSections:sections,corpora,
    laneAttemptLimits:{publication:216,editorial_evaluation:68,checker_challenge:80,customer:94},
    allowedRoles:["factual","challenge","customer"],supportedPreparers:["operational-template-pair-v1"],
    holds:[`Supported exact operational preparers: ${operationalInferenceTemplateIds.join(", ")}; each requires a saved candidate and verified private evidence.`,
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
  if(!Array.isArray(value.namedContentSections)||value.namedContentSections.length!==38||
    new Set(value.namedContentSections.map(s=>s.identity)).size!==38||value.namedContentSections.some(s=>
      s.sourcePath!==scopePaths[5]&&s.sourcePath!==scopePaths[6]||
      s.identity!==`${s.sourcePath}#${s.heading}`||!/^[a-f0-9]{64}$/.test(s.baselineSectionSha256)))
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
  if(work.lane==="customer"&&work.bindings.corpus==="customer-ai"&&!contentId)return;
  // Scope may authorize these lanes, but scope alone cannot manufacture an
  // implemented safe request preparer or weaken the actual readiness checks.
  if(work.lane!=="publication"||!contentId||!supportsOperationalInferenceTemplate(contentId)||!work.bindings.operationalPlan)
    throw Error("PACKAGE_EXECUTABLE_PREPARER_UNAVAILABLE");
}
async function packageRow(c:import("pg").PoolClient,schema:string,id:string,admitting:boolean){
  const row=(await c.query(`SELECT * FROM "${schema}".valo_inference_batches WHERE id=$1 FOR SHARE`,[id])).rows[0];
  if(!row||!row.approved_by||row.approved_by==="finite-package-delegate"||!row.approval_reference||!row.approved_at||
    admitting&&!row.enabled)throw Error("ALLOCATION_PACKAGE_NOT_AUTHORIZED");
  const pkg=row.manifest as FiniteAllocationPackage;validateAllocationPackage(pkg);
  const approvedAt=inferenceTimestamp(row.approved_at),expiresAt=inferenceTimestamp(row.expires_at);
  if(row.policy_hash!==requestDigest(inferenceProposal)||row.manifest_hash!==requestDigest(pkg)||
    id!==allocationPackageId(pkg)||!Number.isFinite(approvedAt)||!Number.isFinite(expiresAt)||
    approvedAt>Date.now()||Date.parse(pkg.preparedAt)>approvedAt||admitting&&expiresAt<=Date.now())
    throw Error("ALLOCATION_PACKAGE_EXPIRED_OR_CHANGED");
  if(admitting){
    const actual=await Promise.all(pkg.sourceFiles.map(async source=>({source,bytes:await readFile(resolve(root,source.path))})));
    // The original evaluation oracle remains byte-pinned. Content scope is
    // its named identity; routine same-identity candidate revisions still need
    // full real readiness checks but do not require another spending approval.
    for(const {source,bytes}of actual.slice(2,5))if(sha(bytes)!==source.sha256)throw Error("ALLOCATION_PACKAGE_SOURCE_CHANGED");
    const intake=JSON.parse(actual[1]!.bytes.toString()) as {templates:{id:string}[];guidance:{id:string}[]};
    const ids=new Set([...intake.templates,...intake.guidance].map(x=>x.id));
    if(pkg.contentIds.some(id=>!ids.has(id)))throw Error("ALLOCATION_PACKAGE_CONTENT_IDENTITY_CHANGED");
    const sections=actual.slice(5).flatMap(x=>namedSections(x.source.path,x.bytes.toString()));
    if(pkg.namedContentSections.some(s=>!sections.some(current=>current.identity===s.identity)))
      throw Error("ALLOCATION_PACKAGE_CONTENT_IDENTITY_CHANGED");
  }
  return{row,pkg};
}
/** Reuse the existing immutable package for fresh exact submanifests. A new
 * child timestamp never creates a new owner-approval requirement. */
export async function readApprovedFiniteAllocationPackage(pool:Pick<import("pg").Pool,"connect">,id:string,schema="public"){
  assertDevelopmentRuntime();
  if(!/^[a-z_][a-z0-9_]*$/.test(schema))throw Error("INVALID_LEDGER_SCHEMA");
  const c=await pool.connect();
  // PostgreSQL row locks require an ordinary transaction. This path performs
  // only reads; it neither writes approval nor modifies the package.
  try{await c.query("BEGIN");const {pkg,row}=await packageRow(c,schema,id,true);
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
    inferenceTimestamp(child.approved_at)<inferenceTimestamp(row.approved_at)||
    inferenceTimestamp(child.expires_at)>inferenceTimestamp(row.expires_at))throw Error("DELEGATED_APPROVAL_BINDING_INVALID");
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
  assertDevelopmentRuntime();
  if(!manifest.packageId||
    store.allocationId()!==additionalInferenceAllocation.id)throw Error("DELEGATED_REGISTRATION_HELD");
  const manifestHash=requestDigest(manifest),batchId=`finite-submanifest:${manifestHash}`;
  return store.mutate("finite-submanifest-admitted",async(s,c)=>{
    const {row,pkg}=await packageRow(c,store.schemaName(),manifest.packageId!,true);
    const expiry=Date.parse(expiresAt);
    if(!Number.isFinite(expiry)||expiry<=Date.now()||expiry>inferenceTimestamp(row.expires_at))throw Error("SUBMANIFEST_EXPIRY_INVALID");
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

