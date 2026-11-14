import {versionedEvidencePath} from "../lib/versioned-evidence-path";
import assert from "node:assert/strict";
import { readFile,writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { eq,sql } from "drizzle-orm";
import { db,pool,valoContentVersions,valoPublicationAudit } from "@workspace/db";
import { loadChatGPTPermission } from "../editorial/rights-applicability";
import { prepareInventoryRelease } from "../editorial/operational-preparation";
import { publishOperationalVersion } from "../editorial/publication-publisher";
import { publicationWorkspaceRoot,developmentPublicationOnly } from "../editorial/operational-policy";
import { getPublicationArtifact } from "../editorial/publication-artifacts";

async function reservations(){
  const rows=await db.execute(sql`select count(*)::int as total from valo_publication_ai_attempts
    where role <> 'draft' and created_at >= date_trunc('day',now())`);
  return Number(rows.rows[0].total);
}
async function main(){
  developmentPublicationOnly();
  if(process.env.VALO_OPERATIONAL_PUBLICATION!=="synthetic-development-only")throw Error("EXPLICIT_FLAG_REQUIRED");
  const root=publicationWorkspaceRoot(),path=resolve(root,"generated-artifacts/valo-publication/chatgpt-provider-rights-snapshot.json");
  const snapshot=JSON.parse(await readFile(path,"utf8"));
  const permission=await loadChatGPTPermission(snapshot);
  assert.equal(permission.verified,true);
  assert.equal(permission.record.accountTerms,null);
  const before=await reservations();
  // This proof exercises the actually exhausted budget. It never spends
  // provider calls or mutates quota history to manufacture an exhausted state.
  if(before<6)throw Error("REAL_DAILY_CAP_NOT_EXHAUSTED_NO_TEST_RUN");
  const prepared=await prepareInventoryRelease(path);
  assert.equal(prepared.providerFailure,"OPERATIONAL_REVIEW_DAILY_CAP_REACHED");
  assert.equal(prepared.release.decision,"held");
  assert.equal(prepared.reviews.length,0);
  assert.equal(prepared.commercialLicenceAccepted,false);
  const after=await reservations();assert.equal(after,before);
  const [row]=await db.select().from(valoContentVersions).where(eq(valoContentVersions.id,prepared.id));
  assert.equal(row.status,"held");
  const audits=await db.select().from(valoPublicationAudit).where(eq(valoPublicationAudit.versionId,row.id));
  assert.ok(audits.some(a=>a.action==="held"&&a.reason.includes("OPERATIONAL_REVIEW_DAILY_CAP_REACHED")));
  await assert.rejects(()=>publishOperationalVersion(row.id),/VERSION_NOT_RELEASABLE/);
  for(const asset of [prepared.attestations.provenance,prepared.attestations.rights,prepared.attestations.exportReport,
    prepared.attestations.exports.docx,prepared.attestations.exports.pdf])await getPublicationArtifact(asset);
  const prior=[];
  for(const version of [4,5]){
    const report=JSON.parse(await readFile(versionedEvidencePath(root,version),"utf8"));
    prior.push({version,decision:report.release.decision,candidateHash:report.candidateHash,reviews:report.reviews});
  }
  await writeFile(versionedEvidencePath(root,prepared.version),
    JSON.stringify({executedAt:new Date().toISOString(),...prepared,scope:"Actual budget hold; zero new provider requests; not publication acceptance"},null,2)+"\n");
  const report={executedAt:new Date().toISOString(),sourceNoteCommit:"551e5580662cc305c05f3fd2c705a74b035c2c82",
    providerPermission:{verified:true,scope:permission.record.commercialUseScope,hash:permission.hash,
      sourceBinding:permission.record.sourceBinding,accountContractClassified:false,paidPlanRequired:false,
      actualRetrievedPages:permission.record.evidence.map(e=>({url:e.url,hash:e.hash,locator:e.locator}))},
    actualIndependentReviewCallsThisCheckpoint:prior.reduce((n,p)=>n+p.reviews.length,0),prior,
    quotaHold:{version:prepared.version,id:row.id,reservationsBefore:before,reservationsAfter:after,
      newProviderRequests:0,durableHeldState:true,durableAuditReason:true,heldPublisherRejected:true,
      actualPrivateArtifactsRead:5,exports:prepared.exportReport,reason:prepared.providerFailure},
    copyrightCertified:false,thirdPartyRightsCertified:false,customerLicenceAccepted:false,
    eligibleDevelopmentReleaseProved:false,withdrawalProved:false,editorial60Accepted:false,
    r1Accepted:false,r2Unlocked:false,publicLaunchEnabled:false,livePaymentsEnabled:false};
  await writeFile(resolve(root,"docs/valo/evidence/chatgpt-permission-publication-proof.json"),JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify({providerPermissionVerified:true,reviewCalls:report.actualIndependentReviewCallsThisCheckpoint,
    heldVersion:prepared.version,reservationsUnchanged:before===after,newProviderRequests:0,publisherRejectedHeld:true}));
}
main().catch(error=>{console.error(error instanceof Error?error.message:"PERMISSION_PROOF_FAILED");process.exitCode=1;}).finally(()=>pool.end());
