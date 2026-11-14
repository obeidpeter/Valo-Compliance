import { and,eq } from "drizzle-orm";
import { db,valoContentVersions,valoPublicationPolicies,valoDocuments } from "@workspace/db";
import { evaluatePublication,publicationSchema,coveragePlan } from "@workspace/valo-core";
import { developmentPublicationOnly,operationalPolicy } from "../editorial/operational-policy";
import { getPublicationArtifact,type ArtifactRef } from "../editorial/publication-artifacts";
import { createDocumentInTransaction,getDocument,ValoProblem,type WorkspaceActor } from "./valo-store";
import { documentInput } from "./valo-validation";
import { loadRightsApplicability } from "../editorial/rights-applicability";
import { paginateReleasedItems } from "./valo-catalogue";
export function releaseVisible(row:typeof valoContentVersions.$inferSelect,policyHash:string,now=new Date()){
  const parsed=publicationSchema.safeParse(row.bundle);
  return row.status==="published"&&+row.reviewBy>+now&&parsed.success&&
    parsed.data.candidate.hash===row.candidateHash&&parsed.data.policy.hash===policyHash&&
    evaluatePublication(parsed.data,now).decision==="eligible";
}
export async function liveReleasedVersions(){
  if(process.env.NODE_ENV!=="development"||process.env.REPLIT_DEPLOYMENT)return[];
  const rights=await loadRightsApplicability();
  const currentPolicy=await operationalPolicy();
  const rows=await db.select({content:valoContentVersions,policy:valoPublicationPolicies}).from(valoContentVersions)
    .innerJoin(valoPublicationPolicies,eq(valoContentVersions.policyId,valoPublicationPolicies.id))
    .where(eq(valoContentVersions.status,"published"));
  return rows.filter(r=>releaseVisible(r.content,r.policy.hash)&&(
    publicationSchema.parse(r.content.bundle).candidate.evidenceMode!=="original_operational"||
    (rights.verified&&r.policy.hash===currentPolicy.policy.hash&&
      (r.content.attestations as {rightsApplicabilityHash?:string}).rightsApplicabilityHash===rights.hash)
  )).map(r=>r.content)
    .sort((a,b)=>b.version-a.version).filter((r,i,all)=>all.findIndex(v=>v.templateId===r.templateId)===i);
}
export async function liveOperationalVersions(){
  return(await liveReleasedVersions()).filter(r=>publicationSchema.parse(r.bundle).candidate.contentClass==="general_template");
}
export async function liveCoverage(){
  return coveragePlan((await liveReleasedVersions()).map(row=>{
    const c=publicationSchema.parse(row.bundle).candidate;
    return{id:row.templateId,kind:c.contentClass==="general_template"?"template":c.coverage?.kind??"guidance",
      industrySlugs:c.coverage?.industrySlugs??[],locationIds:c.coverage?.locationIds??[],sourceCheckedAt:c.sourceCheckDate};
  }));
}
export async function releasedCatalogue(query:{q?:string;type?:string;industry?:string;page?:number}={}){
  const all=await liveOperationalVersions();
  const items=all.map(r=>{
    const document=documentInput.parse(JSON.parse(publicationSchema.parse(r.bundle).candidate.body));
    return{id:r.id,slug:r.slug,title:document.title,type:"template",industry:"All industries",
      summary:"Optional stock-movement and physical-count record. AI reviewed operational development template; not regulatory guidance."};
  });
  return {...paginateReleasedItems(items,query),heldTemplates:Math.max(0,40-all.filter(r=>/^TPL-(0[1-9]|[1-3][0-9]|40)$/.test(r.templateId)).length)};
}
export async function releasedTemplate(slug:string){
  const row=(await liveOperationalVersions()).find(r=>r.slug===slug);
  if(!row)throw new ValoProblem(404,"This template is unavailable, withdrawn or awaiting valid evidence.");
  const bundle=publicationSchema.parse(row.bundle),document=documentInput.parse(JSON.parse(bundle.candidate.body));
  return{id:row.id,templateId:row.templateId,slug:row.slug,title:document.title,
    summary:"Record stock movements and physical counts using your own information.",
    version:row.version,reviewedAt:bundle.candidate.sourceCheckDate,reviewBy:row.reviewBy.toISOString(),
    disclosure:bundle.candidate.disclosure,scope:bundle.candidate.scope,limitations:bundle.candidate.limitations,
    preview:["SAMPLE FIELD: Business name [your information]","SAMPLE FIELD: Item, unit and location [your information]",
      "SAMPLE SECTION: Receipts, issues, adjustments and physical-count differences. Full blank files require a verified account."],
    developmentOnly:true,commercialLicenceAccepted:false,formats:["docx","pdf"] as const};
}
async function lockedLiveVersion(tx:Parameters<Parameters<typeof db.transaction>[0]>[0],id:string){
  const[row]=await tx.select().from(valoContentVersions).where(eq(valoContentVersions.id,id)).for("share");
  if(!row)throw new ValoProblem(404,"Template unavailable");
  const[policy]=await tx.select().from(valoPublicationPolicies).where(eq(valoPublicationPolicies.id,row.policyId));
  if(!policy||!releaseVisible(row,policy.hash))throw new ValoProblem(404,"Template withdrawn, expired or unavailable");
  return row;
}
export async function createReleasedTemplateDraft(actor:WorkspaceActor,id:string){
  developmentPublicationOnly();
  const documentId=await db.transaction(async tx=>{
    const row=await lockedLiveVersion(tx,id);
    const document=documentInput.parse(JSON.parse(publicationSchema.parse(row.bundle).candidate.body));
    const documentId=await createDocumentInTransaction(tx,actor,document);
    await tx.update(valoDocuments).set({templateVersionId:id}).where(and(eq(valoDocuments.id,documentId),eq(valoDocuments.workspaceId,actor.workspaceId)));
    return documentId;
  });
  return getDocument(actor,documentId);
}
export async function readReleasedMaster(id:string,format:"docx"|"pdf"){
  developmentPublicationOnly();
  return db.transaction(async tx=>{
    const row=await lockedLiveVersion(tx,id);
    const a=row.attestations as {exports:Record<"docx"|"pdf",ArtifactRef>};
    return{bytes:await getPublicationArtifact(a.exports[format]),templateId:row.templateId,version:row.version};
  });
}
