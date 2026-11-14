/** Bounded publisher: no customer/draft tables, model calls, prices, money or policy writes. */
import { randomUUID } from "node:crypto";
import { and,eq,sql } from "drizzle-orm";
import { db,valoPublicationPolicies,valoContentVersions,valoPublicationAudit } from "@workspace/db";
import { digest,evaluatePublication,publicationSchema,sha256 } from "@workspace/valo-core";
import { getPublicationArtifact,type ArtifactRef } from "./publication-artifacts";
import { developmentPublicationOnly,operationalPolicy } from "./operational-policy";
import { operationalReviewSchema } from "./operational-review-contract";
import { inventoryCandidate } from "./operational-content";
import { originalFormSchema,formMarkdown } from "./operational-authoring-contract";
export type ReleaseAttestations={
  provenance:ArtifactRef;rights:ArtifactRef;reviews:ArtifactRef[];
  exports:{docx:ArtifactRef;pdf:ArtifactRef};exportReport:ArtifactRef;
};
export async function publishOperationalVersion(id:string){
  developmentPublicationOnly();
  return db.transaction(async tx=>{
    await tx.execute(sql`SET LOCAL ROLE valo_content_publisher_dev`);
    const[row]=await tx.select().from(valoContentVersions).where(eq(valoContentVersions.id,id)).for("update");
    if(!row||!["candidate","published"].includes(row.status))throw Error("VERSION_NOT_RELEASABLE");
    const bundle=publicationSchema.parse(row.bundle);
    const[policy]=await tx.select().from(valoPublicationPolicies).where(eq(valoPublicationPolicies.id,row.policyId));
    const trusted=await operationalPolicy();
    if(!policy||policy.hash!==trusted.policy.hash||digest(policy.policy)!==digest(bundle.policy)||
      bundle.policy.hash!==trusted.policy.hash||!bundle.policy.developmentOnly)throw Error("POLICY_NOT_TRUSTED");
    if(row.reviewBy.toISOString()!==bundle.candidate.reviewBy||+row.reviewBy<=Date.now())throw Error("STALE_RELEASE");
    const result=evaluatePublication(bundle);
    if(result.decision!=="eligible")throw Error(`PUBLICATION_HELD:${result.reasons.join(",")}`);
    if(bundle.candidate.id!=="TPL-07")throw Error("OPERATIONAL_FORM_NOT_IMPLEMENTED");
    const a=row.attestations as ReleaseAttestations;
    const provenance=JSON.parse((await getPublicationArtifact(a.provenance)).toString());
    if(sha256(provenance.sourceText)!==provenance.hash||sha256(provenance.note)!==provenance.noteHash||
      !provenance.note.includes(provenance.hash)||provenance.templateId!==bundle.candidate.id)
      throw Error("PROVENANCE_EVIDENCE_INVALID");
    let recorded;
    if(provenance.generation){
      const generation=JSON.parse((await getPublicationArtifact(provenance.generation)).toString());
      const output=originalFormSchema.parse(generation.output);
      if(generation.providerResponseId!==bundle.draftRun.runId||generation.model!==bundle.draftRun.model||
        JSON.stringify(output)!==provenance.sourceText)throw Error("AUTHORING_RECEIPT_INVALID");
      recorded={original:formMarkdown(output),provenance};
    }
    const original=await inventoryCandidate(row.version,new Date(bundle.candidate.sourceCheckDate),recorded);
    if(row.version!==bundle.candidate.version||bundle.candidate.body!==JSON.stringify(original.document)||
      bundle.candidate.scope!==original.scope||bundle.candidate.limitations!==original.limitations)
      throw Error("OPERATIONAL_BODY_OUTSIDE_REVIEWED_ORIGINAL");
    const rights=JSON.parse((await getPublicationArtifact(a.rights)).toString());
    if(digest(rights)!==bundle.rights.evidenceHash||bundle.rights.evidence!==JSON.stringify(rights)||
      !rights.originalOperationalOnly||rights.customerLicenceAccepted!==false||
      rights.provenanceHash!==a.provenance.hash||Date.parse(rights.validUntil)<=Date.now())
      throw Error("RIGHTS_EVIDENCE_INVALID");
    const provider=JSON.parse((await getPublicationArtifact(rights.snapshot as ArtifactRef)).toString());
    const faq=provider.pages.find((p:{url:string})=>p.url==="https://help.openai.com/en/articles/6783457-what-is-chatgpt");
    const terms=provider.pages.filter((p:{url:string})=>p.url==="https://openai.com/policies/terms-of-use/"||p.url==="https://openai.com/policies/eu-terms-of-use/");
    if(rights.authoringRoute==="recorded_server_ai"){
      const platform=provider.pages.find((p:{url:string})=>p.url==="https://replit.com/commercial-agreement");
      const api=provider.pages.find((p:{url:string})=>p.url==="https://openai.com/policies/business-terms/");
      if(!provenance.generation||platform?.truncated||api?.truncated||
        !platform?.text.includes("own the Output Content")||!api?.text.includes("owns all Output"))
        throw Error("RECORDED_PROVIDER_PERMISSION_TEXT_MISSING");
    }else if(!faq?.text.includes("regardless of whether output was generated through a free or paid plan")||
      terms.length!==2||terms.some((p:{text:string;truncated:boolean})=>p.truncated||!p.text.includes("own the Output")))
        throw Error("PROVIDER_PERMISSION_TEXT_MISSING");
    if(a.reviews.length!==2)throw Error("INDEPENDENT_REVIEWS_MISSING");
    const providerIds=new Set<string>();
    for(const ref of a.reviews){
      const record=JSON.parse((await getPublicationArtifact(ref)).toString());
      const output=operationalReviewSchema.parse(record.output);
      const bound=bundle.reviews.find(r=>r.role===record.role);
      if(!bound||record.providerResponseId!==bound.runId||!record.model||record.receivedOtherVerdict||
        output.verdict!=="pass"||output.findings.length||output.missingEvidence.length||
        record.candidateHash!==bundle.candidate.hash||record.evidenceHash!==digest(bundle.sources))
        throw Error("REVIEW_ATTESTATION_INVALID");
      providerIds.add(record.providerResponseId);
    }
    if(providerIds.size!==2)throw Error("REVIEWS_NOT_INDEPENDENT");
    const exportReport=JSON.parse((await getPublicationArtifact(a.exportReport)).toString());
    if(exportReport.candidateHash!==row.candidateHash||exportReport.passed!==true)throw Error("EXPORT_REPORT_INVALID");
    for(const format of ["docx","pdf"] as const){
      await getPublicationArtifact(a.exports[format]);
      const attested=bundle.exports.find(e=>e.format===format);
      if(attested?.fileHash!==a.exports[format].hash||exportReport.hashes[format]!==attested.fileHash)
        throw Error("EXPORT_ATTESTATION_INVALID");
    }
    if(row.status==="published")return{id,decision:"published" as const,idempotent:true};
    await tx.update(valoContentVersions).set({status:"published",publishedAt:new Date()})
      .where(and(eq(valoContentVersions.id,id),eq(valoContentVersions.status,"candidate")));
    await tx.insert(valoPublicationAudit).values({id:randomUUID(),versionId:id,
      actor:"bounded_development_publisher",action:"published",reason:`Eligible immutable manifest ${digest(bundle.manifest)}`});
    return{id,decision:"published" as const,idempotent:false};
  });
}
export async function withdrawOperationalVersion(id:string,reason:string){
  developmentPublicationOnly();if(!reason.trim())throw Error("WITHDRAWAL_REASON_REQUIRED");
  return db.transaction(async tx=>{
    await tx.execute(sql`SET LOCAL ROLE valo_content_publisher_dev`);
    const[row]=await tx.select().from(valoContentVersions).where(eq(valoContentVersions.id,id)).for("update");
    if(!row||row.status!=="published")throw Error("PUBLISHED_VERSION_REQUIRED");
    await tx.update(valoContentVersions).set({status:"withdrawn",withdrawnReason:reason}).where(eq(valoContentVersions.id,id));
    await tx.insert(valoPublicationAudit).values({id:randomUUID(),versionId:id,actor:"bounded_development_publisher",action:"withdrawn",reason});
    return{id,status:"withdrawn" as const};
  });
}
export async function recordActualPublicationHold(id:string){
  developmentPublicationOnly();
  return db.transaction(async tx=>{
    await tx.execute(sql`SET LOCAL ROLE valo_content_publisher_dev`);
    const[row]=await tx.select().from(valoContentVersions).where(eq(valoContentVersions.id,id)).for("update");
    if(!row||row.status!=="candidate")throw Error("CANDIDATE_REQUIRED");
    const decision=evaluatePublication(row.bundle);
    if(decision.decision!=="hold")throw Error("NO_FAILED_GATE_TO_RECORD");
    await tx.update(valoContentVersions).set({status:"held"}).where(eq(valoContentVersions.id,id));
    await tx.insert(valoPublicationAudit).values({id:randomUUID(),versionId:id,actor:"bounded_development_publisher",
      action:"held",reason:decision.reasons.join(",")});
    return{id,status:"held",reasons:decision.reasons};
  });
}
