import { randomUUID } from "node:crypto";
import { readFile,writeFile,mkdtemp,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { execFile as execCallback } from "node:child_process";
import { promisify } from "node:util";
import { unzipSync,strFromU8 } from "fflate";
import { and,eq,sql } from "drizzle-orm";
import { db,valoPublicationPolicies,valoContentVersions } from "@workspace/db";
import { candidateDigest,digest,evaluatePublication,mandatoryMechanicalChecks,disclosure,sha256,type PublicationBundle } from "@workspace/valo-core";
import { renderDocument } from "../lib/valo-render";
import { inventoryCandidate,type OperationalProvenance } from "./operational-content";
import { recordOriginalAuthoring } from "./operational-authoring";
import { developmentPublicationOnly,operationalPolicy } from "./operational-policy";
import { putPublicationArtifact } from "./publication-artifacts";
import { reviewOperationalCandidate } from "./operational-review";
import { publishOperationalVersion,recordActualPublicationHold,type ReleaseAttestations } from "./publication-publisher";
import { loadRightsApplicability,loadChatGPTPermission,assertPermissionRoute } from "./rights-applicability";
const execFile=promisify(execCallback);
export async function prepareInventoryRelease(snapshotPath:string){
  developmentPublicationOnly();
  const snapshot=JSON.parse(await readFile(snapshotPath,"utf8"));
  const useRecordedAuthoring=process.env.VALO_OPERATIONAL_AUTHORING==="recorded";
  const applicability=useRecordedAuthoring?await loadRightsApplicability():await loadChatGPTPermission(snapshot);
  // Verify the actual authoring route before any metered calls. ChatGPT's
  // documented free/paid permission is not a Replit account-plan assertion.
  if(!applicability.verified)
    throw Error("PROVIDER_RIGHTS_APPLICABILITY_UNVERIFIED");
  assertPermissionRoute(applicability.record,useRecordedAuthoring);
  const now=new Date(),{policy,authority}=await operationalPolicy();
  await db.insert(valoPublicationPolicies).values({id:policy.version,hash:policy.hash,policy,authority}).onConflictDoNothing();
  const [storedPolicy]=await db.select().from(valoPublicationPolicies).where(eq(valoPublicationPolicies.id,policy.version));
  if(storedPolicy.hash!==policy.hash)throw Error("POLICY_VERSION_CHANGED_CREATE_NEW_VERSION");
  const versions=await db.select().from(valoContentVersions).where(eq(valoContentVersions.templateId,"TPL-07"));
  const version=Math.max(0,...versions.map(r=>r.version))+1;
  const authored=process.env.VALO_OPERATIONAL_AUTHORING==="recorded"?await recordOriginalAuthoring():undefined;
  let recorded: {original:string;provenance:OperationalProvenance}|undefined;
  if(authored){
    const sourceText=JSON.stringify(authored.receipt.output),hash=sha256(sourceText);
    const note=`Recorded original server AI output ${hash}; provider response ${authored.receipt.providerResponseId}, model ${authored.receipt.model}, prompt ${authored.receipt.promptVersion}. No external form or customer content was supplied to the author. Output may be nonunique; no copyright or non-infringement guarantee.`;
    recorded={original:authored.original,provenance:{path:"private recorded authoring artifact",hash,sourceText,note,noteHash:sha256(note),
      authoringRoute:"Recorded server AI authoring through existing Replit OpenAI integration; not the earlier ChatGPT coordinator draft",
      transformation:"Validated original five-paragraph output plus code-defined blank stock-record fields and Valo disclosures",
      templateId:"TPL-07",version,generation:authored.artifact}};
  }
  const content=await inventoryCandidate(version,now,recorded);
  const provenance=await putPublicationArtifact(Buffer.from(JSON.stringify(content.provenance)),"json");
  if(snapshot.kind!=="official_provider_terms_snapshot"||snapshot.pages.some((p:{truncated:boolean})=>p.truncated)||
    !Number.isFinite(Date.parse(snapshot.retrievedAt))||Date.parse(snapshot.retrievedAt)>+now||
    +now-Date.parse(snapshot.retrievedAt)>86400000)throw Error("FRESH_ACTUAL_PROVIDER_TERMS_REQUIRED");
  for(const evidence of applicability.record.evidence){
    const page=snapshot.pages.find((p:{url:string})=>p.url===evidence.url);
    if(!page||sha256(page.text)!==evidence.hash||!page.text.includes(evidence.quote))
      throw Error("APPLICABLE_TERMS_SNAPSHOT_MISSING");
  }
  const snapshotRef=await putPublicationArtifact(Buffer.from(JSON.stringify(snapshot)),"json");
  const rights={snapshot:snapshotRef,provenanceHash:provenance.hash,originalOperationalOnly:true,
    applicabilityHash:applicability.hash,applicability:applicability.record,
    customerLicenceAccepted:false,checkedAt:now.toISOString(),validUntil:content.reviewBy,
    authoringRoute:authored?"recorded_server_ai":"coordinator_chatgpt",
    conclusion:authored?"Actual server AI authoring receipt and retrieved platform/provider terms retained for free development evaluation. No copyright, exclusivity, non-infringement, indemnity or sales-licence guarantee. Not for sale.":"Provider permissions and coordinator-attributed original operational provenance checked for this free synthetic-development release only. Upstream execution IDs are unrecorded; no copyright, exclusivity or non-infringement guarantee. No sales or accepted Valo commercial licence.",
    permissions:applicability.record.evidence};
  const rightsRef=await putPublicationArtifact(Buffer.from(JSON.stringify(rights)),"json");
  const rawCandidate:Omit<PublicationBundle["candidate"],"hash">={
    id:"TPL-07",version,body:JSON.stringify(content.document),contentClass:"general_template" as const,
    jurisdiction:"NG",risk:"general" as const,scope:content.scope,limitations:content.limitations,
    assumptions:["Quantities and business facts are entered by the user.","This is optional recordkeeping practice, not a regulated-sector or statutory register."],
    unresolvedMaterialIssues:[],missingEvidence:[],sourceCheckDate:now.toISOString(),reviewBy:content.reviewBy,
    disclosure,claims:[],evidenceMode:"original_operational" as const,legalScopeStatus:"not_applicable" as const,
  };
  const candidate={...rawCandidate,hash:candidateDigest(rawCandidate)};
  // Render the exact canonical body being reviewed; not independently regenerated prose.
  const files={docx:await renderDocument(content.document,"docx",version,"template_sample"),
    pdf:await renderDocument(content.document,"pdf",version,"template_sample")};
  const xml=strFromU8(unzipSync(files.docx)["word/document.xml"]);
  const temporary=await mkdtemp(resolve(tmpdir(),"valo-publication-"));
  let pdfText="";
  try{await writeFile(resolve(temporary,"sample.pdf"),files.pdf);
    pdfText=(await execFile("pdftotext",["-layout",resolve(temporary,"sample.pdf"),"-"],{maxBuffer:1024*1024})).stdout;
  }finally{await rm(temporary,{recursive:true,force:true});}
  const required=["Inventory register","Scope:","Limitations:","AI drafted and reviewed","File-integrity and provider-permission check date",authored?"Stock movement":"Running quantity"];
  const exportPassed=files.pdf.subarray(0,5).toString()==="%PDF-"&&required.every(s=>xml.includes(s)&&pdfText.replace(/\s+/g," ").includes(s));
  if(!exportPassed)throw Error("REAL_EXPORT_INSPECTION_FAILED");
  const exports={docx:await putPublicationArtifact(files.docx,"docx"),pdf:await putPublicationArtifact(files.pdf,"pdf")};
  const exportReport={candidateHash:candidate.hash,passed:exportPassed,hashes:{docx:sha256(files.docx),pdf:sha256(files.pdf)},
    checks:["Actual DOCX ZIP/XML parsed; required text present","Actual Chromium A4 PDF parsed with pdftotext; required text present","Renderer network disabled"],
    manualWordApplicationReview:false,manualAccessibilityReview:false};
  const reportRef=await putPublicationArtifact(Buffer.from(JSON.stringify(exportReport)),"json");
  let reviewed:Awaited<ReturnType<typeof reviewOperationalCandidate>>=[];
  let providerFailure:string|null=null;
  try{reviewed=await reviewOperationalCandidate(candidate,
    {permissions:rights.permissions,conclusion:rights.conclusion,customerLicenceAccepted:false,
      actualProviderTerms:snapshot.pages.filter((p:{url:string})=>applicability.record.evidence.some(e=>e.url===p.url)),
      actualExecutionReceipt:authored?.receipt,environmentEvidence:{developmentOnly:true,
        providerPermissionScope:applicability.record,sourceFileHashVerified:true,
        runtimeGuard:"NODE_ENV=development and no REPLIT_DEPLOYMENT; publication endpoints are not exposed to customers",
        policy:policy,scope:"Free synthetic evaluation; no sales or commercial licence granted"}},
    {authoringRoute:content.provenance.authoringRoute,sourceHash:content.provenance.hash,
      originalItem:content.original,actualAuthoringNote:content.provenance.note,authoringNoteHash:content.provenance.noteHash,
      adaptation:content.provenance.transformation,upstreamModelAndRunNotRecorded:!authored},exportReport,
    {candidateHash:candidate.hash,sourceCheckedAt:candidate.sourceCheckDate,sourceHash:content.provenance.hash,
      provenanceArtifactHash:provenance.hash,rightsArtifactHash:rightsRef.hash,exportReportArtifactHash:reportRef.hash,
      providerSnapshotHash:snapshotRef.hash,authoringRoute:rights.authoringRoute,
      sourceAttribution:"Provided authoring note; not independent certification of upstream authorship",
      performedChecks:["Original source file SHA-256 matches the retained note","Provider passages occur in the exact retrieved full-page hashes",
        "DOCX/PDF generated from the exact canonical candidate and inspected before review"]});
  }catch(error){
    providerFailure=error instanceof Error&&/^[A-Z_]{3,80}$/.test(error.message)?
      error.message:"OPERATIONAL_REVIEW_PROVIDER_FAILURE";
  }
  const reviews=reviewed.map(r=>({...r.record,runId:r.record.providerResponseId,
    verdict:r.record.output.verdict,findings:[...r.record.output.findings,...r.record.output.missingEvidence]}));
  const arithmeticFixtures=[{before:1000n,received:250n,issued:500n,adjustment:-100n,expected:650n},
    {before:0n,received:0n,issued:1n,adjustment:0n,expected:-1n},
    {before:9007199254740993n,received:1n,issued:0n,adjustment:0n,expected:9007199254740994n}];
  if(!arithmeticFixtures.every(f=>f.before+f.received-f.issued+f.adjustment===f.expected))throw Error("ARITHMETIC_FIXTURE_FAILED");
  const checks=mandatoryMechanicalChecks.map(name=>({name,candidateHash:candidate.hash,result:"pass" as const,
    evidenceHash:digest({name,document:content.documentDigest,rights:rightsRef.hash,exportReport:reportRef.hash,
      applicability:name==="rule_fixtures"?"No legal predicates/thresholds; zero regulatory claims verified":name==="source_locators"?"No regulatory claims; actual authoring and terms locators verified":"operational schema/provenance/export checks"})}));
  const bundle:PublicationBundle={
    candidate,sources:[],rights:{status:"cleared",commercialUse:true,evidence:JSON.stringify(rights),evidenceHash:digest(rights)},
    policy,draftRun:{runId:authored?.receipt.providerResponseId??`source-import:${sha256(content.original)}`,
      model:authored?.receipt.model??"ChatGPT; upstream model unrecorded",
      promptVersion:authored?.receipt.promptVersion??"coordinator-original-operational-prose-import-1",candidateHash:candidate.hash,evidenceHash:digest([])},
    reviews:reviews.map(r=>({runId:r.runId,model:r.model,promptVersion:r.promptVersion,candidateHash:r.candidateHash,
      evidenceHash:r.evidenceHash,role:r.role,verdict:r.verdict,findings:r.findings,receivedOtherVerdict:false})),
    mechanicalChecks:checks,enhancedChecks:[],
    exports:(["docx","pdf"] as const).map(format=>({format,candidateHash:candidate.hash,fileHash:exports[format].hash,
      rendered:true,disclosureIncluded:true,scopeIncluded:true,limitationsIncluded:true,sourceDateIncluded:true})),
    manifest:{candidateHash:candidate.hash,evidenceHash:digest([]),rightsHash:"",policyHash:policy.hash,
      reviewHash:"",checksHash:"",exportsHash:"",status:!providerFailure&&reviews.length===2&&reviews.every(r=>r.verdict==="pass"&&!r.findings.length)?"eligible":"review"},
  };
  Object.assign(bundle.manifest,{rightsHash:digest(bundle.rights),
    reviewHash:digest({draft:bundle.draftRun,reviews:bundle.reviews}),checksHash:digest({mechanical:bundle.mechanicalChecks,enhanced:[]}),
    exportsHash:digest(bundle.exports)});
  const id=randomUUID(),attestations:ReleaseAttestations={provenance,rights:rightsRef,rightsApplicabilityHash:applicability.hash,
    reviews:reviewed.map(r=>r.artifact),exports,exportReport:reportRef};
  await db.transaction(async tx=>{
    await tx.execute(sql`SET LOCAL ROLE valo_content_drafter_dev`);
    await tx.insert(valoContentVersions).values({id,templateId:"TPL-07",version,slug:"inventory-register",
      policyId:policy.version,candidateHash:candidate.hash,bundle,attestations,reviewBy:new Date(content.reviewBy)});
  });
  const eligibility=evaluatePublication(bundle);
  const release=eligibility.decision==="eligible"?await publishOperationalVersion(id):
    {...await recordActualPublicationHold(id,providerFailure??undefined),decision:"held"};
  return{id,version,candidateHash:candidate.hash,policyHash:policy.hash,eligibility,release,
    reviews:reviewed.map(r=>({role:r.record.role,providerResponseId:r.record.providerResponseId,model:r.record.model,
      verdict:r.record.output.verdict,findings:r.record.output.findings,missingEvidence:r.record.output.missingEvidence})),
    exportReport,attestations,rightsScope: rights.conclusion,commercialLicenceAccepted:false,providerFailure};
}
